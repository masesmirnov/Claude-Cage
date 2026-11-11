package workbench

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/sylvinus/agent-vm/internal/diagnostics"
	"github.com/sylvinus/agent-vm/internal/usererror"
)

const browserResponseLimit = 1 << 20
const browserOrigin = "http://127.0.0.1:18500"

// browserClient owns host connections to the guest browser controller. Closing
// it cancels those connections; the guest browser process remains untouched.
type browserClient struct {
	ctx    context.Context
	cancel context.CancelFunc
	http   *http.Client
}

func newBrowserClient(parent context.Context) *browserClient {
	ctx, cancel := context.WithCancel(parent)
	return &browserClient{ctx: ctx, cancel: cancel, http: &http.Client{
		Transport:     &http.Transport{Proxy: nil, IdleConnTimeout: 30 * time.Second, MaxIdleConnsPerHost: 4, DialContext: (&net.Dialer{Timeout: 3 * time.Second}).DialContext},
		CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") },
	}}
}

func (c *browserClient) close() {
	c.cancel()
	c.http.CloseIdleConnections()
}

// The response owns cancellation until its body is closed. This also covers
// event subscriptions, whose lifetime extends beyond receiving HTTP headers.
func (c *browserClient) open(parent context.Context, token, method, path, contentType string, body io.Reader, length int64, timeout time.Duration) (*http.Response, error) {
	if err := c.ctx.Err(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	stop := context.AfterFunc(c.ctx, cancel)
	finish := func() { stop(); cancel() }
	if timeout > 0 {
		var cancelTimeout context.CancelFunc
		ctx, cancelTimeout = context.WithTimeout(ctx, timeout)
		finish = func() { stop(); cancelTimeout(); cancel() }
	}
	req, err := http.NewRequestWithContext(ctx, method, browserOrigin+path, body)
	if err != nil {
		finish()
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", contentType)
		req.ContentLength = length
	}
	response, err := c.http.Do(req)
	if err != nil {
		finish()
		return nil, err
	}
	response.Body = &browserResponseBody{ReadCloser: response.Body, finish: finish}
	return response, nil
}

type browserResponseBody struct {
	io.ReadCloser
	finish func()
}

func (b *browserResponseBody) Close() error {
	b.finish()
	return b.ReadCloser.Close()
}

func (c *browserClient) request(ctx context.Context, token, method, path string, body []byte) ([]byte, error) {
	timeout := 5 * time.Second
	switch path {
	case "/audit", "/paste-image", "/tailnet":
		timeout = 20 * time.Second
	case "/editor-restart":
		timeout = 30 * time.Second
	case "/extensions":
		timeout = 25 * time.Second
	}
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	response, err := c.open(ctx, token, method, path, "application/json", reader, int64(len(body)), timeout)
	if err != nil {
		diagnostics.Log("warn", "browser", fmt.Sprintf("operation=%s transport=%v", path, err))
		return nil, usererror.Wrap(browserOperation(path), err, "Make sure the environment is still running and reconnect the browser. If it keeps failing, export a diagnostics bundle in Settings.")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, browserResponseLimit+1))
	if err != nil {
		return nil, usererror.Wrap(browserOperation(path), err, "The browser result was not fully returned. Reconnect, then check whether this operation took effect.")
	}
	if len(data) > browserResponseLimit {
		return nil, errors.New(browserOperation(path) + " failed: the browser returned more than 1 MiB of data and reading was stopped. Close tabs or extensions you no longer use and try again. If it keeps happening, export a diagnostics bundle.")
	}
	if response.StatusCode != http.StatusOK {
		diagnostics.Log("warn", "browser", fmt.Sprintf("operation=%s http=%d", path, response.StatusCode))
		var result struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &result)
		known := map[string]string{
			"Tab no longer exists": "the tab was closed. Reopen the page and try again.",
			"Browser is starting":  "the browser is still starting. Wait for it to finish, then try again.",
			"Input target changed": "the page receiving the text has changed. Go back to the original page and click the input box again.",
			"Image target changed": "the page receiving the image has changed. Go back to the original page and click the input box again.",
			"Copy target changed":  "the page to copy from has changed. Go back to the original page and copy again.",
			"Image too large":      "the image exceeds the allowed size. Reduce the image and paste it again.",
			"Invalid PNG":          "the image is not a valid PNG file. Copy or export the image again.",
			"Only HTTP(S) URLs without credentials are accepted":                           "the URL contains a username or password. Use an http or https URL without sign-in credentials.",
			"Only HTTP(S) URLs and supported browser pages are accepted":                   "this URL type is not supported. Use an http or https URL.",
			"Unknown browser action":                                                       "the browser component does not support this operation. Update the environment components and try again.",
			"Split controller unavailable":                                                 "the split view component is not ready. Update the environment components and reopen split view.",
			"Editor authentication is unavailable":                                         "the local sign-in session for the editor is unavailable. Reopen the editor from Cage.",
			"The file upload page has changed. Go back to the original page and try again": "the file upload page has changed. Go back to the original page and try again.",
			"The browser component could not recover. Restart the environment":             "the browser component could not recover. Save your work and restart the environment.",
			"Tabs from different browsing sessions cannot be split":                        "the selected pages belong to different browsing sessions and cannot share a split view. Open both pages in the same session.",
			"Incognito tabs do not support two-page split view yet":                        "incognito tabs do not support two-page split view yet. Use regular tabs.",
			"Settings pages must be used in a single browser pane":                         "settings pages must be used in a single browser pane. Exit split view first.",
			"Extension ZIP cannot exceed 32 MB":                                            "the extension ZIP cannot exceed 32 MB. Reduce the extension size and import it again.",
		}
		if reason := known[strings.TrimRight(result.Error, ".")]; reason != "" {
			return nil, errors.New(browserOperation(path) + " failed: " + reason)
		}
		return nil, serviceHTTPFailure(browserOperation(path), response.StatusCode)
	}
	return data, nil
}

func (c *browserClient) events(ctx context.Context, token string) (io.ReadCloser, error) {
	response, err := c.open(ctx, token, http.MethodGet, "/events", "", nil, 0, 0)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, serviceHTTPFailure("Receiving browser state", response.StatusCode)
	}
	return response.Body, nil
}

func (c *browserClient) file(ctx context.Context, token, method, path string, body io.Reader, length int64) (*http.Response, error) {
	return c.open(ctx, token, method, path, "application/octet-stream", body, length, 30*time.Minute)
}
