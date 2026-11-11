package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

func nativeDesktopDownloadInput(method, path string, input any) (map[string]any, error) {
	if method != "POST" || (path != "/file-open" && path != "/file-read" && path != "/file-close") {
		return nil, errors.New("The guest download operation is invalid.")
	}
	data, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	var request map[string]any
	if err = json.Unmarshal(data, &request); err != nil {
		return nil, err
	}
	request["action"] = "files-download-" + strings.TrimPrefix(path, "/file-")
	return request, nil
}

func (s *Server) nativeDesktopDownloadRequest(ctx context.Context, method, path string, input any) ([]byte, error) {
	request, err := nativeDesktopDownloadInput(method, path, input)
	if err != nil {
		return nil, err
	}
	if s.windowsGuest != nil {
		var reply map[string]any
		if err = s.windowsDesktopRequest(ctx, request["action"].(string), request, &reply); err != nil {
			return nil, windowsDesktopFileFailure(err)
		}
		return json.Marshal(reply)
	}
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	var mac macOSWindowRequest
	if err = json.Unmarshal(data, &mac); err != nil {
		return nil, err
	}
	reply, err := s.macOSDesktopFileCall(ctx, mac)
	if err != nil {
		return nil, err
	}
	return json.Marshal(reply)
}

type nativeDesktopDownload struct {
	io.ReadCloser
	connection *nativeWindowConnection
}

func (d *nativeDesktopDownload) Close() error {
	err := d.ReadCloser.Close()
	d.connection.Close()
	return err
}

// One download owns one ordered window channel. Chunk reads reuse its process
// and SSH or Hyper-V transport, while the producer retains the file identity.
func (s *Server) openNativeDesktopDownload(ctx context.Context, id string) (io.ReadCloser, int64, string, error) {
	var connection *nativeWindowConnection
	var err error
	if s.windowsGuest != nil {
		connection, err = s.windowsWindowConnection(ctx)
	} else {
		transport, cancel := context.WithCancel(ctx)
		cmd := s.sshCommand(transport, "-T", s.sshTarget(), "--", macOSWindowSocketCommand)
		connection, err = startWindowConnection(cmd, cancel)
	}
	if err != nil {
		return nil, 0, "", err
	}
	request := func(call context.Context, method, path string, input any) ([]byte, error) {
		if path == "/file-close" && ctx.Err() != nil {
			return s.nativeDesktopDownloadRequest(call, method, path, input)
		}
		if err := call.Err(); err != nil {
			return nil, err
		}
		payload, err := nativeDesktopDownloadInput(method, path, input)
		if err != nil {
			return nil, err
		}
		payload["keepAlive"] = true
		stop := context.AfterFunc(call, connection.Close)
		defer stop()
		var reply json.RawMessage
		if err = connection.request(payload, &reply); err != nil {
			var failure windowsWindowFailure
			if s.macosGuest != nil && errors.As(err, &failure) {
				return nil, macOSFileFailure(failure.code)
			}
			return nil, windowsDesktopFileFailure(err)
		}
		return reply, nil
	}
	reader, size, name, err := openNativeFileDownload(ctx, id, request)
	if err != nil {
		connection.Close()
		return nil, 0, "", err
	}
	return &nativeDesktopDownload{ReadCloser: reader, connection: connection}, size, name, nil
}

func desktopDownloadFailure(reason string) error {
	switch reason {
	case "desktop_download_incomplete":
		return errors.New("Claude Desktop has not fully saved the file. Go back to the app and download it again.")
	case "desktop_download_changed":
		return errors.New("The Claude Desktop download changed during transfer. Download it again.")
	case "desktop_download_unavailable", "desktop_download_transfer_invalid":
		return errors.New("The Claude Desktop download is no longer available. Make sure the guest is unlocked, then download it again.")
	case "desktop_download_limit":
		return errors.New("Too many Claude Desktop files are waiting to be saved. Finish the existing downloads first, then try again.")
	case "file_open_target_changed":
		return errors.New("The file or Claude window has changed. Go back to the original window and open the file again.")
	case "file_open_request_invalid", "file_open_request_unavailable":
		return errors.New("The file open request is no longer valid. Make sure the guest is unlocked, then try again.")
	case "file_open_request_limit":
		return errors.New("Too many file open requests are being processed. Try again later.")
	default:
		return nil
	}
}

func windowsDesktopFileFailure(err error) error {
	var failure windowsWindowFailure
	if errors.As(err, &failure) {
		if display := desktopDownloadFailure(failure.code); display != nil {
			return display
		}
	}
	return err
}
