package hostproxy

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/lima-vm/lima/v2/pkg/lockutil"
)

// Download uses a shared, digest-specific partial file only for pinned media.
// The caller supplies a private staging target on the same volume.
func Download(ctx context.Context, address, target, name, accept, cache, digest string, out io.Writer) error {
	tr := NewTransport()
	defer tr.CloseIdleConnections()
	resolve := tr.Proxy
	tr.Proxy = func(req *http.Request) (*url.URL, error) {
		proxy, err := resolve(req)
		route := "Direct host connection"
		if err != nil {
			route = "Host proxy resolution failed"
		} else if proxy != nil {
			route = "Host proxy"
		}
		fmt.Fprintf(out, "%s: %s\n", name, route)
		return proxy, err
	}
	client := &http.Client{Transport: tr, CheckRedirect: func(req *http.Request, previous []*http.Request) error {
		if req.URL.Scheme != "https" || req.URL.User != nil || len(previous) >= 5 {
			return errors.New("Invalid download redirect.")
		}
		return nil
	}}
	if digest == "" {
		return downloadAttempts(ctx, client, address, target, name, accept, "", out)
	}
	raw, err := hex.DecodeString(digest)
	if err != nil || len(raw) != sha256.Size || !filepath.IsAbs(cache) {
		return errors.New("Invalid installer cache directory or checksum.")
	}
	digest = hex.EncodeToString(raw)
	dir := filepath.Join(cache, digest)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	for _, path := range []string{cache, dir} {
		info, err := os.Lstat(path)
		if err != nil || !info.IsDir() {
			return errors.New("Invalid installer cache directory.")
		}
	}
	return lockutil.WithDirLock(dir, func() error {
		partial := filepath.Join(dir, "partial")
		if err := downloadAttempts(ctx, client, address, partial, name, accept, digest, out); err != nil {
			return err
		}
		return os.Rename(partial, target)
	})
}

func downloadAttempts(ctx context.Context, client *http.Client, address, target, name, accept, digest string, out io.Writer) error {
	var restart bool
	for attempt := 1; attempt <= 3; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var offset int64
		info, err := os.Lstat(target)
		switch {
		case err == nil:
			if !info.Mode().IsRegular() {
				return errors.New("Invalid installer cache path.")
			}
			if digest != "" && !restart {
				offset = info.Size()
			}
		case !errors.Is(err, os.ErrNotExist):
			return err
		}
		err = downloadOnce(ctx, client, address, target, name, accept, out, 60*time.Second, offset)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		restart = errors.Is(err, errInvalidRange)
		if digest != "" && (err == nil || errors.Is(err, errRangeExhausted)) {
			// A previous run may have stopped after writing the last byte.
			// A 416 alone never establishes that the cached file is complete.
			f, openErr := os.Open(target)
			if openErr != nil {
				return openErr
			}
			sum := sha256.New()
			_, readErr := io.Copy(sum, f)
			closeErr := f.Close()
			if err := errors.Join(readErr, closeErr); err != nil {
				return err
			}
			if hex.EncodeToString(sum.Sum(nil)) == digest {
				return nil
			}
			if err = os.Remove(target); err != nil {
				return err
			}
			err = errors.New("SHA-256 verification failed")
		}
		if err == nil {
			return nil
		}
		// Only downloadOnce's sanitized errors may reach the job log.
		fmt.Fprintf(out, "%s download attempt %d/3 failed: %s\n", name, attempt, err)
		if attempt < 3 {
			fmt.Fprintf(out, "CAGE_HOST_RETRY %s %d\n", name, attempt+1)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * time.Second):
			}
		}
	}
	return fmt.Errorf("%s host download failed. Check the download methods above and the network, then continue the installation", name)
}

var errInvalidRange = errors.New("The resume range returned by the server does not match the existing progress.")
var errRangeExhausted = errors.New("The server has no more data to resume.")

func downloadOnce(parent context.Context, client *http.Client, address, target, name, accept string, out io.Writer, idle time.Duration, offset int64) error {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil || req.URL.Scheme != "https" || req.URL.User != nil {
		return errors.New("Host installation files must be downloaded over HTTPS.")
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	req.Header.Set("Accept-Encoding", "identity")
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	response, err := client.Do(req)
	if err != nil {
		return errors.New("Connection failed or timed out waiting for a response.")
	}
	defer response.Body.Close()
	flags := os.O_WRONLY | os.O_CREATE
	total := max(response.ContentLength, 0)
	switch response.StatusCode {
	case http.StatusOK:
		offset = 0
		flags |= os.O_TRUNC
	case http.StatusPartialContent:
		var start, end int64
		value := response.Header.Get("Content-Range")
		_, err := fmt.Sscanf(value, "bytes %d-%d/%d", &start, &end, &total)
		if offset == 0 || err != nil || value != fmt.Sprintf("bytes %d-%d/%d", start, end, total) ||
			start != offset || total <= start || end != total-1 ||
			(response.ContentLength >= 0 && response.ContentLength != total-start) {
			return errInvalidRange
		}
		flags |= os.O_APPEND
	case http.StatusRequestedRangeNotSatisfiable:
		if offset > 0 {
			return errRangeExhausted
		}
		fallthrough
	default:
		return fmt.Errorf("The download returned HTTP %d", response.StatusCode)
	}
	if encoding := response.Header.Get("Content-Encoding"); encoding != "" && !strings.EqualFold(encoding, "identity") {
		return errors.New("The download encoding does not support byte verification.")
	}
	file, err := os.OpenFile(target, flags, 0600)
	if err != nil {
		return errors.New("Could not write to the installer cache.")
	}
	defer file.Close()
	// Check the latest activity while holding the same lock used by the body
	// reader, so a timer already queued cannot cancel a resumed stream.
	var mu sync.Mutex
	stopped := false
	last := time.Now()
	var timer *time.Timer
	var check func()
	check = func() {
		mu.Lock()
		defer mu.Unlock()
		if stopped {
			return
		}
		if remaining := idle - time.Since(last); remaining > 0 {
			timer.Reset(remaining)
		} else {
			cancel()
		}
	}
	timer = time.AfterFunc(idle, check)
	defer func() { mu.Lock(); defer mu.Unlock(); stopped = true; timer.Stop() }()
	received := offset
	report := func() { fmt.Fprintf(out, "CAGE_HOST_BYTES %s %d %d\n", name, received, total) }
	report()
	reported := time.Now()
	buffer := make([]byte, 128<<10)
	for {
		n, readErr := response.Body.Read(buffer)
		if n > 0 {
			mu.Lock()
			last = time.Now()
			mu.Unlock()
			if _, err = file.Write(buffer[:n]); err != nil {
				return errors.New("Writing to the installer cache failed.")
			}
			received += int64(n)
		}
		if time.Since(reported) >= time.Second || readErr != nil {
			report()
			reported = time.Now()
		}
		if readErr == io.EOF {
			if total > 0 && received != total {
				return errors.New("The download did not receive all the expected bytes.")
			}
			return file.Close()
		}
		if readErr != nil {
			return errors.New("The download was interrupted or no data was received for a long time.")
		}
	}
}
