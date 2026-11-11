//go:build darwin && !cgo

package hostproxy

import (
	"errors"
	"net/http"
	"net/url"
)

func systemProxy(*http.Request) (*url.URL, error) {
	return nil, errors.New("This build cannot read the macOS system proxy. Use an official native build or set HTTPS_PROXY; no direct connection was used.")
}
