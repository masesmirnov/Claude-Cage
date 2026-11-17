// Package appupdate checks and downloads releases using host networking first,
// with the selected managed egress as a fallback for connection failures.
// Signature verification and application replacement belong to the native app.
package appupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/sylvinus/agent-vm/internal/appupdate/catalog"
	"github.com/sylvinus/agent-vm/internal/cage"
	"github.com/sylvinus/agent-vm/internal/diagnostics"
	"github.com/sylvinus/agent-vm/internal/host"
	"github.com/sylvinus/agent-vm/internal/managedproxy"
	"github.com/sylvinus/agent-vm/internal/usererror"
	"github.com/sylvinus/agent-vm/internal/version"
)

const repository = catalog.Repository
const releasesURL = catalog.ReleasesURL
const maxArchive = catalog.MaxArchive
const metadataTimeout = 2 * time.Minute

var (
	downloadAttempts = 6
	downloadStall    = 60 * time.Second
	downloadBackoff  = 3 * time.Second
)

const maxMetadata = 4 << 20

type asset = catalog.Asset
type release = catalog.Release
type candidate = catalog.Candidate

// State is one line of the native launcher's private update process protocol.
// ArchivePath is returned only to the native launcher, never as a download URL.
type State struct {
	Phase          string `json:"phase"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion,omitempty"`
	ReceivedBytes  int64  `json:"receivedBytes,omitempty"`
	TotalBytes     int64  `json:"totalBytes,omitempty"`
	Message        string `json:"message,omitempty"`
	Retryable      bool   `json:"retryable,omitempty"`
	RetryAt        string `json:"retryAt"`
	ArchivePath    string `json:"archivePath,omitempty"`
	SHA256         string `json:"sha256,omitempty"`
}

type proxyUnavailableError struct{ message string }

func (e *proxyUnavailableError) Error() string { return e.message }

// Run only accepts fixed operations. URLs and destinations come from the
// verified repository response and the current private profile.
func Run(configPath string, args []string, output io.Writer) int {
	enc := json.NewEncoder(output)
	state := State{CurrentVersion: version.Version}
	emit := func() { _ = enc.Encode(state) }
	fail := func(err error) int {
		var unavailable *proxyUnavailableError
		if len(args) == 1 && args[0] == "check" && errors.As(err, &unavailable) {
			state.Phase, state.Message, state.Retryable = "waiting", err.Error(), true
			emit()
			return 0
		}
		_ = diagnostics.New(filepath.Dir(configPath)).Record("warn", "app-update", fmt.Sprintf("%v; cause=%v", err, errors.Unwrap(err)))
		state.fail(err)
		emit()
		return 1
	}
	if len(args) != 1 || (args[0] != "check" && args[0] != "download") {
		return fail(errors.New("Invalid update action."))
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	client := updateClient(configPath)
	defer client.CloseIdleConnections()
	state.Phase, state.Message = "checking", "Checking for updates"
	emit()
	metadata, finished := context.WithTimeout(ctx, metadataTimeout)
	defer finished()
	c, err := findRelease(metadata, client, version.Version)
	if err != nil {
		return fail(err)
	}
	if c == nil {
		state.Phase, state.Message = "current", "Already on the latest version of this update channel"
		emit()
		return 0
	}
	state.LatestVersion = c.Version
	if args[0] == "check" {
		state.Phase, state.Message = "available", "A new version is available to download"
		emit()
		return 0
	}
	if runtime.GOOS == "linux" {
		return fail(errors.New("The Linux version is updated with the system package; download the new .deb from the releases page"))
	}
	digest, err := releaseDigest(metadata, client, *c)
	if err != nil {
		return fail(err)
	}
	directory := filepath.Join(filepath.Dir(configPath), "updates")
	if err = host.EnsurePrivateDir(directory); err != nil {
		return fail(errors.New("Could not create the private update directory."))
	}
	if st, e := os.Lstat(directory); e != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
		return fail(errors.New("The update directory must be a private regular directory."))
	}

	// One stable task directory lets an interrupted transfer continue after a
	// retry or an App restart. The native App removes it after verification.
	job := filepath.Join(directory, "download-resume")
	if err = host.EnsurePrivateDir(job); err != nil {
		return fail(errors.New("Could not create the update download task."))
	}
	if st, e := os.Lstat(job); e != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
		return fail(errors.New("The update download job must be a private regular folder"))
	}
	localName := "Cage.dmg"
	if runtime.GOOS == "windows" {
		localName = "Cage-setup.exe"
	}
	archive := filepath.Join(job, localName)
	state.Phase, state.Message, state.TotalBytes = "downloading", "Downloading update", c.Archive.Size
	emit()
	err = download(ctx, client, c.Archive, digest, archive, func(n int64) {
		state.ReceivedBytes, state.Message = n, "Downloading the update"
		emit()
	}, func() {
		state.Message = "Connection interrupted, resuming from the downloaded position"
		emit()
	})
	if err != nil {
		return fail(err)
	}
	state.Phase, state.Message, state.ArchivePath, state.SHA256 = "downloaded", "Download digest verified, verifying the app", archive, digest
	emit()
	return 0
}

func managedClient(ctx context.Context, configPath string) (*http.Client, error) {
	cfg, err := cage.Load(configPath)
	if err != nil {
		return nil, errors.New("Cage's selected proxy is not configured yet")
	}
	profile := filepath.Dir(configPath)
	p, err := managedproxy.Applied(profile, cfg.ProxyURL, cfg.ProxyRevision)
	if err != nil {
		return nil, &proxyUnavailableError{"Cage's selected proxy is not applied yet"}
	}
	if !managedproxy.Running(ctx, profile, p) {
		return nil, &proxyUnavailableError{"Cage's selected proxy is not running"}
	}
	egress, err := cage.NewEgress(cfg)
	if err != nil {
		return nil, errors.New("Invalid update proxy configuration.")
	}
	return updateHTTPClient(&http.Transport{Proxy: nil, DialContext: egress.DialContext, ForceAttemptHTTP2: true, TLSHandshakeTimeout: 15 * time.Second, ResponseHeaderTimeout: 30 * time.Second, IdleConnTimeout: 10 * time.Second}), nil
}

func allowedURL(u *url.URL, redirect bool) bool {
	if u == nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") {
		return false
	}
	switch u.Hostname() {
	case "api.github.com":
		path := strings.TrimPrefix(u.Path, "/repos/"+repository+"/")
		if path == u.Path {
			return false
		}
		if path == "releases" || path == "commits/main" {
			return true
		}
		if comparison, ok := strings.CutPrefix(path, "compare/"); ok {
			base, head, found := strings.Cut(comparison, "...")
			return found && validCommit(base) && validCommit(head)
		}
		return false
	case "github.com":
		return strings.HasPrefix(u.Path, "/"+repository+"/releases/download/") && !strings.Contains(u.Path, "/../")
	case "release-assets.githubusercontent.com", "objects.githubusercontent.com":
		return redirect
	}
	return false
}

// transientError marks failures that a later attempt can continue from.
type transientError struct{ error }

func (e *transientError) Unwrap() error { return e.error }

func request(ctx context.Context, client *http.Client, raw string) (*http.Response, error) {
	return requestFrom(ctx, client, raw, 0)
}

// requestFrom asks for the bytes after offset. A source that ignores the range
// answers 200 with the whole file, which the caller must handle.
func requestFrom(ctx context.Context, client *http.Client, raw string, offset int64) (*http.Response, error) {
	u, err := url.Parse(raw)
	if err != nil || !allowedURL(u, false) {
		return nil, errors.New("The update address is not a trusted Cage release source.")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", raw, nil)
	if err != nil {
		return nil, errors.New("Invalid update request.")
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if u.Hostname() == "api.github.com" {
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	}
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return nil, errors.New("The update download was canceled.")
		}
		var unavailable *networkUnavailableError
		if errors.As(err, &unavailable) {
			return nil, &transientError{unavailable}
		}
		return nil, &transientError{usererror.Wrap("Connect to the app update source", errors.Join(ctx.Err(), err), "Check the host network and system proxy; when the host connection fails, Cage's selected proxy is also tried. You can check for updates again once the network is back.")}
	}
	if resp.StatusCode != http.StatusOK && !(offset > 0 && resp.StatusCode == http.StatusPartialContent) {
		resp.Body.Close()
		switch resp.StatusCode {
		case 404:
			if strings.Contains(u.Path, "/compare/") {
				return nil, errors.New("The current build commit is not in the source repository, so the commit relationship cannot be checked")
			}
			return nil, errors.New("The update source could not find the requested version or installer (HTTP 404). Check for updates later; to install manually, find the file for your platform on the Cage releases page.")
		case 403, 429:
			return nil, updateSourceError(resp, time.Now())
		default:
			err := fmt.Errorf("The update source returned HTTP %d, please try again later", resp.StatusCode)
			if resp.StatusCode >= 500 {
				return nil, &transientError{err}
			}
			return nil, err
		}
	}
	return resp, nil
}

func limitedBody(resp *http.Response, limit int64) ([]byte, error) {
	defer resp.Body.Close()
	if resp.ContentLength > limit {
		return nil, errors.New("The update information exceeds the allowed size.")
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, errors.New("The update information download was interrupted or exceeds the allowed size.")
	}
	return b, nil
}

func findRelease(ctx context.Context, client *http.Client, current string) (*candidate, error) {
	resp, err := request(ctx, client, releasesURL)
	if err != nil {
		return nil, err
	}
	b, err := limitedBody(resp, maxMetadata)
	if err != nil {
		return nil, err
	}
	var releases []release
	if json.Unmarshal(b, &releases) != nil {
		return nil, errors.New("The update source returned invalid version information.")
	}
	return catalog.Select(releases, current, runtime.GOOS, runtime.GOARCH)
}

func releaseDigest(ctx context.Context, client *http.Client, c candidate) (string, error) {
	if c.Checksums.URL == "" {
		return c.SHA256(nil)
	}
	u, err := url.Parse(c.Checksums.URL)
	if err != nil || u.Hostname() != "github.com" || !strings.HasPrefix(u.Path, "/"+repository+"/releases/download/v"+c.Version+"/") {
		return "", errors.New("The checksum manifest does not belong to the same release version.")
	}
	resp, err := request(ctx, client, c.Checksums.URL)
	if err != nil {
		return "", err
	}
	b, err := limitedBody(resp, 64<<10)
	if err != nil {
		return "", err
	}
	return c.SHA256(b)
}

// download continues a partial file of the same digest and retries dropped
// connections from the bytes already stored. Only a complete file whose size
// and SHA-256 match is moved to path.
func download(ctx context.Context, client *http.Client, a asset, digest, path string, progress func(int64), retrying func()) error {
	if a.Size <= 0 || a.Size > maxArchive {
		return errors.New("The release size is invalid or larger than 2 GiB")
	}
	if _, err := catalog.DigestValue("sha256:" + digest); err != nil {
		return err
	}
	partial := path + "." + digest[:16] + ".part"
	if entries, err := os.ReadDir(filepath.Dir(path)); err == nil {
		for _, entry := range entries {
			other := filepath.Join(filepath.Dir(path), entry.Name())
			if strings.HasSuffix(other, ".part") && other != partial {
				_ = os.Remove(other)
			}
		}
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return errors.New("The previously downloaded installer is still in use, please try again later")
	}
	hash := sha256.New()
	var f *os.File
	var offset int64
	if st, err := os.Lstat(partial); err == nil && st.Mode().IsRegular() && st.Size() <= a.Size {
		if f, err = os.OpenFile(partial, os.O_RDWR, 0600); err == nil {
			if offset, err = io.Copy(hash, f); err != nil || offset != st.Size() {
				f.Close()
				f = nil
			}
		}
	}
	if f == nil {
		_ = os.Remove(partial)
		var err error
		if f, err = os.OpenFile(partial, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600); err != nil {
			return errors.New("Cannot create a private update file")
		}
		offset = 0
		hash.Reset()
	}
	discard := false
	defer func() {
		f.Close()
		if discard {
			os.Remove(partial)
		}
	}()
	if err := host.ProtectFile(partial); err != nil {
		discard = true
		return errors.New("Could not protect the update file.")
	}
	restart := func() error {
		offset = 0
		hash.Reset()
		if err := f.Truncate(0); err != nil {
			return err
		}
		_, err := f.Seek(0, io.SeekStart)
		return err
	}
	if offset > 0 {
		progress(offset)
	}
	var last error
	for attempt := 0; offset < a.Size; attempt++ {
		if attempt >= downloadAttempts {
			return last
		}
		if attempt > 0 {
			retrying()
			select {
			case <-ctx.Done():
				return errors.New("The update download was canceled")
			case <-time.After(downloadBackoff):
			}
		}
		// The watchdog bounds silence, not the transfer: a slow but moving
		// download may take as long as it needs.
		attemptCtx, cancel := context.WithCancel(ctx)
		watchdog := time.AfterFunc(downloadStall, cancel)
		resp, err := requestFrom(attemptCtx, client, a.URL, offset)
		if err == nil {
			expected := a.Size
			if resp.StatusCode == http.StatusPartialContent {
				expected = a.Size - offset
				if !strings.HasPrefix(resp.Header.Get("Content-Range"), fmt.Sprintf("bytes %d-", offset)) {
					err = errors.New("The update source returned a wrong resume position")
				}
			} else if offset > 0 {
				err = restart()
			}
			if err == nil && resp.ContentLength > 0 && resp.ContentLength != expected {
				err = errors.New("The release size does not match the release information")
			}
			if err != nil {
				resp.Body.Close()
				watchdog.Stop()
				cancel()
				discard = true
				return err
			}
			w := &progressWriter{writer: io.MultiWriter(f, hash), total: offset, notify: func(n int64) {
				watchdog.Reset(downloadStall)
				progress(n)
			}}
			var n int64
			n, err = io.Copy(w, io.LimitReader(resp.Body, a.Size-offset+1))
			resp.Body.Close()
			offset += n
			if err != nil || offset < a.Size {
				err = &transientError{errors.New("The release download was interrupted or its actual size does not match")}
			}
		}
		stalled := attemptCtx.Err() != nil
		watchdog.Stop()
		cancel()
		if ctx.Err() != nil {
			return errors.New("The update download was canceled")
		}
		if offset > a.Size {
			discard = true
			return errors.New("The release download was interrupted or its actual size does not match")
		}
		var transient *transientError
		if err != nil && !stalled && !errors.As(err, &transient) {
			return err
		}
		if stalled && err != nil {
			err = errors.New("The update download received no data for a long time; the downloaded part was kept and you can continue later")
		}
		last = err
	}
	if offset != a.Size || hex.EncodeToString(hash.Sum(nil)) != digest {
		discard = true
		return errors.New("The release package SHA-256 check failed. Download it again.")
	}
	if err := f.Sync(); err != nil {
		return errors.New("Could not save the update file.")
	}
	if err := f.Close(); err != nil {
		return errors.New("Could not save the update file.")
	}
	if err := os.Rename(partial, path); err != nil {
		return errors.New("Could not save the update file.")
	}
	progress(offset)
	return nil
}

type progressWriter struct {
	writer io.Writer
	notify func(int64)
	total  int64
	last   time.Time
}

func (w *progressWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	w.total += int64(n)
	if n > 0 && time.Since(w.last) >= 250*time.Millisecond {
		w.last = time.Now()
		w.notify(w.total)
	}
	return n, err
}
