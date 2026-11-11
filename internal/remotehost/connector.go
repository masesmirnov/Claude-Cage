package remotehost

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sylvinus/agent-vm/internal/host"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

func shellQuote(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'" }

// ServerEntryCommand accepts two path fields, never an arbitrary shell command.
func ServerEntryCommand(p HostProfile) (string, error) {
	p, err := normalizeProfile(p)
	if err != nil {
		return "", err
	}
	command := shellQuote(p.Executable) + " server-entry --json"
	if p.ConfigPath != "" {
		command = "env CLAUDE_CAGE_CONFIG=" + shellQuote(p.ConfigPath) + " " + command
	}
	return "exec " + command, nil
}

// ValidateManifest limits every forwarded connection to a declared loopback
// service. Instance identity persists independently of network addresses.
func ValidateManifest(m ServerManifest) error {
	if m.APIProtocol != APIProtocol {
		return failure("protocol_incompatible", "The cloud Cage protocol is not compatible with this client. Update to a compatible version.")
	}
	if !instancePattern.MatchString(m.InstanceID) || m.Platform != "linux" || (m.Runtime != "container" && m.Runtime != "lima") || len(m.Version) > 128 || hasControl(m.Version) {
		return failure("manifest_invalid", "Invalid cloud Cage identity response.")
	}
	u, err := url.Parse(m.Origin)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") {
		return failure("origin_refused", "The cloud service must use an explicit local loopback address.")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 {
		return failure("origin_refused", "Invalid cloud service port.")
	}
	if len(m.Ticket) < 32 || len(m.Ticket) > 512 || hasControl(m.Ticket) || len(m.Capabilities) > 64 {
		return failure("manifest_invalid", "Invalid cloud Cage connection ticket.")
	}
	for key := range m.Capabilities {
		if key == "" || len(key) > 64 || hasControl(key) {
			return failure("manifest_invalid", "Invalid cloud capability declaration.")
		}
	}
	return nil
}

func authentication(ctx context.Context, p HostProfile, secrets ConnectSecrets) (ssh.AuthMethod, func(), error) {
	if p.Auth.Kind == "agent" {
		conn, err := dialAgent(ctx)
		if err != nil {
			return nil, nil, failure("agent_unavailable", "Could not connect to the local SSH agent. Start the agent or choose a key file.")
		}
		_ = conn.SetDeadline(time.Now().Add(15 * time.Second))
		stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
		signers, err := agent.NewClient(conn).Signers()
		if err != nil || len(signers) == 0 {
			stop()
			conn.Close()
			return nil, nil, failure("agent_unavailable", "The SSH agent has no usable keys.")
		}
		return ssh.PublicKeys(signers...), func() { stop(); conn.Close() }, nil
	}
	if err := host.CheckPrivateFile(p.Auth.IdentityFile); err != nil {
		return nil, nil, failure("identity_permissions", "The SSH key does not exist or its file permissions are unsafe.")
	}
	f, err := os.Open(p.Auth.IdentityFile)
	if err != nil {
		return nil, nil, failure("identity_read", "Could not read the SSH key file.")
	}
	key, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	f.Close()
	defer clear(key)
	if err != nil || len(key) > 1<<20 {
		return nil, nil, failure("identity_read", "The SSH key file is invalid or too large.")
	}
	var signer ssh.Signer
	if len(secrets.Passphrase) > 0 {
		signer, err = ssh.ParsePrivateKeyWithPassphrase(key, secrets.Passphrase)
	} else {
		signer, err = ssh.ParsePrivateKey(key)
	}
	if err != nil {
		var missing *ssh.PassphraseMissingError
		if errors.As(err, &missing) {
			return nil, nil, failure("passphrase_required", "This SSH key needs a passphrase.")
		}
		return nil, nil, failure("identity_invalid", "Invalid SSH key or passphrase.")
	}
	return ssh.PublicKeys(signer), func() {}, nil
}

type limitedOutput struct {
	bytes.Buffer
	limit int
}

func (w *limitedOutput) Write(p []byte) (int, error) {
	if w.Len()+len(p) > w.limit {
		return 0, errors.New("SSH response exceeds limit")
	}
	return w.Buffer.Write(p)
}

func connect(lifetime context.Context, p HostProfile, secrets ConnectSecrets, phase func(string)) (*Session, error) {
	p, err := normalizeProfile(p)
	if err != nil {
		return nil, err
	}
	bootstrap, cancelBootstrap := context.WithTimeout(lifetime, 45*time.Second)
	defer cancelBootstrap()
	phase("ssh_auth")
	auth, cleanup, err := authentication(bootstrap, p, secrets)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	phase("ssh_connect")
	address := net.JoinHostPort(p.Host, strconv.Itoa(p.Port))
	raw, err := (&net.Dialer{Timeout: 15 * time.Second}).DialContext(bootstrap, "tcp", address)
	if err != nil {
		return nil, failure("ssh_connect_failed", "Could not connect to the SSH host. Check the address, port and network.")
	}
	complete := false
	defer func() {
		if !complete {
			raw.Close()
		}
	}()
	_ = raw.SetDeadline(time.Now().Add(20 * time.Second))
	stopBootstrap := context.AfterFunc(bootstrap, func() { raw.Close() })
	defer stopBootstrap()
	var keyError *Error
	config := &ssh.ClientConfig{User: p.User, Auth: []ssh.AuthMethod{auth}, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		observed := &HostKey{Algorithm: key.Type(), Fingerprint: ssh.FingerprintSHA256(key)}
		if p.HostKey == nil {
			keyError = &Error{Code: "host_key_unknown", Message: "Check and confirm the SSH host key fingerprint, then reconnect.", HostKey: observed}
			return keyError
		}
		if p.HostKey.Algorithm != observed.Algorithm || p.HostKey.Fingerprint != observed.Fingerprint {
			keyError = &Error{Code: "host_key_changed", Message: "The SSH host key has changed. Verify the host identity, then update the fingerprint.", HostKey: observed}
			return keyError
		}
		return nil
	}}
	if p.HostKey != nil {
		config.HostKeyAlgorithms = []string{p.HostKey.Algorithm}
		if p.HostKey.Algorithm == ssh.KeyAlgoRSA {
			// The public-key type is ssh-rsa, while modern RSA signatures use
			// the SHA-2 negotiation names. Do not enable obsolete SHA-1 signatures.
			config.HostKeyAlgorithms = []string{ssh.KeyAlgoRSASHA512, ssh.KeyAlgoRSASHA256}
		}
	}
	sshConn, channels, requests, err := ssh.NewClientConn(raw, address, config)
	if err != nil {
		if keyError != nil {
			return nil, keyError
		}
		return nil, failure("ssh_auth_failed", "SSH authentication was not completed. Check the user name and key.")
	}
	_ = raw.SetDeadline(time.Time{})
	client := ssh.NewClient(sshConn, channels, requests)
	defer func() {
		if !complete {
			client.Close()
		}
	}()
	phase("server_handshake")
	if !stopBootstrap() || bootstrap.Err() != nil {
		return nil, failure("ssh_timeout", "SSH authentication timed out.")
	}
	timeout := 2 * time.Minute
	if secrets.Deploy {
		timeout = 90 * time.Minute
	}
	ready, cancelReady := context.WithTimeout(lifetime, timeout)
	defer cancelReady()
	stopReady := context.AfterFunc(ready, func() { client.Close() })
	defer stopReady()
	output, err := cloudEntry(ready, client, p, secrets.Deploy, phase)
	if err != nil {
		return nil, err
	}
	var manifest ServerManifest
	decoder := json.NewDecoder(bytes.NewReader(output))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&manifest) != nil {
		return nil, failure("manifest_invalid", "Cage in the cloud did not return valid connection information.")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil, failure("manifest_invalid", "Cage in the cloud returned extra connection information.")
	}
	if err = ValidateManifest(manifest); err != nil {
		return nil, err
	}
	origin, _ := url.Parse(manifest.Origin)
	targetHost := origin.Hostname()
	if targetHost == "localhost" {
		targetHost = "127.0.0.1"
	}
	target := net.JoinHostPort(targetHost, origin.Port())
	life, cancelLife := context.WithCancel(lifetime)
	transport := &http.Transport{Proxy: nil, ForceAttemptHTTP2: false, MaxIdleConns: 32, MaxIdleConnsPerHost: 16, IdleConnTimeout: 60 * time.Second, ResponseHeaderTimeout: 30 * time.Second, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		if network != "tcp" || address != origin.Host {
			return nil, failure("origin_refused", "Access to services not declared by the cloud is refused.")
		}
		return client.DialContext(ctx, "tcp", target)
	}}
	jar, _ := cookiejar.New(nil)
	bound := &sessionTransport{base: transport, jar: jar, origin: manifest.Origin, ctx: life}
	var once sync.Once
	s := &Session{Manifest: manifest.Public(), Transport: bound, Context: life, Origin: manifest.Origin}
	s.close = func() error {
		once.Do(func() { cancelLife(); transport.CloseIdleConnections(); client.Close() })
		return nil
	}
	bound.invalidate = s.Close
	s.Client = &http.Client{Transport: bound, CheckRedirect: func(*http.Request, []*http.Request) error {
		return failure("redirect_refused", "The cloud service redirect was refused.")
	}}
	body, _ := json.Marshal(map[string]string{"token": manifest.Ticket})
	manifest.Ticket = ""
	req, _ := http.NewRequestWithContext(ready, "POST", s.Origin+"/api/session", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response, err := s.Client.Do(req)
	clear(body)
	if err != nil {
		s.Close()
		return nil, failure("server_session_failed", "Could not establish a cloud Cage session.")
	}
	io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	response.Body.Close()
	if response.StatusCode != http.StatusOK || len(jar.Cookies(origin)) == 0 {
		s.Close()
		return nil, failure("server_session_failed", "Cage in the cloud did not accept the connection ticket.")
	}
	if ready.Err() != nil {
		s.Close()
		return nil, failure("connection_cancelled", "The remote connection was canceled.")
	}
	stopReady()
	complete = true
	go func() { _ = client.Wait(); s.Close() }()
	context.AfterFunc(life, func() { s.Close() })
	return s, nil
}

type sessionTransport struct {
	base       *http.Transport
	jar        http.CookieJar
	origin     string
	ctx        context.Context
	invalidate func() error
}

func (t *sessionTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Scheme+"://"+request.URL.Host != t.origin || request.URL.User != nil {
		return nil, failure("origin_refused", "Access to services not declared by the cloud is refused.")
	}
	if err := t.ctx.Err(); err != nil {
		return nil, failure("connection_changed", "The remote connection was disconnected.")
	}
	ctx, cancel := context.WithCancel(request.Context())
	stop := context.AfterFunc(t.ctx, cancel)
	finish := func() { stop(); cancel() }
	req := request.Clone(ctx)
	req.Header = request.Header.Clone()
	req.Host = req.URL.Host
	req.Header.Del("Cookie")
	req.Header.Del("Authorization")
	req.Header.Del("Proxy-Authorization")
	req.Header.Del("Idempotency-Key")
	req.Header.Del("X-Idempotency-Key")
	req.GetBody = nil
	req.Header.Set("Origin", t.origin)
	for _, cookie := range t.jar.Cookies(req.URL) {
		req.AddCookie(cookie)
	}
	response, err := t.base.RoundTrip(req)
	if err != nil {
		finish()
		return nil, failure("remote_request_failed", "The remote request was interrupted. Check the connection; operations already submitted are not resent automatically.")
	}
	if response.StatusCode == http.StatusUnauthorized {
		response.Body.Close()
		finish()
		if t.invalidate != nil {
			_ = t.invalidate()
		}
		return nil, failure("remote_session_expired", "The cloud session is no longer valid. Reconnect and check the cloud tasks.")
	}
	t.jar.SetCookies(req.URL, response.Cookies())
	response.Header.Del("Set-Cookie")
	if response.StatusCode >= 300 && response.StatusCode < 400 && response.Header.Get("Location") != "" {
		response.Body.Close()
		finish()
		return nil, failure("redirect_refused", "The cloud service redirect was refused.")
	}
	if rw, ok := response.Body.(io.ReadWriteCloser); ok {
		response.Body = &cancelReadWriteCloser{ReadWriteCloser: rw, finish: finish}
	} else {
		response.Body = &cancelReadCloser{ReadCloser: response.Body, finish: finish}
	}
	return response, nil
}

type cancelReadCloser struct {
	io.ReadCloser
	finish func()
	once   sync.Once
}

func (b *cancelReadCloser) Read(p []byte) (int, error) {
	n, e := b.ReadCloser.Read(p)
	if e != nil {
		b.once.Do(b.finish)
	}
	return n, e
}
func (b *cancelReadCloser) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(b.finish)
	return err
}

type cancelReadWriteCloser struct {
	io.ReadWriteCloser
	finish func()
	once   sync.Once
}

func (b *cancelReadWriteCloser) Read(p []byte) (int, error) {
	n, e := b.ReadWriteCloser.Read(p)
	if e != nil {
		b.once.Do(b.finish)
	}
	return n, e
}
func (b *cancelReadWriteCloser) Close() error {
	err := b.ReadWriteCloser.Close()
	b.once.Do(b.finish)
	return err
}
