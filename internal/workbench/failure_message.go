package workbench

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/sylvinus/agent-vm/internal/usererror"
)

const failureHelp = "Export a diagnostics bundle in Settings and include the action that was running when the error occurred."

// Only recognize known diagnostics. Unrecognized process output stays in the
// existing operation log and never becomes an arbitrary user-facing message.
func executionFailure(action string, err error, output string) error {
	lower := strings.ToLower(output)
	for _, rule := range []struct {
		patterns     []string
		reason, next string
	}{
		{[]string{"cage_windows_maintenance_authorization_canceled"}, "Windows administrator authorization was canceled", "Start the original operation again and confirm in the Windows authorization window."},
		{[]string{"cage_windows_maintenance_authorization"}, "the Windows administrator authorization window could not open", "Start the operation again from Cage on this computer and use a Windows account that can complete administrator authorization."},
		{[]string{"cage_windows_maintenance_validation"}, "the Windows environment binding or component manifest failed validation", "Start the original operation again. If the component package still cannot be verified, reinstall the full Cage app."},
		{[]string{"cage_windows_maintenance_host_manager"}, "the Windows system management helper installation was not completed", "Retry repairing the system helper. If it still fails, check the system service or security software logs and export a diagnostics bundle."},
		{[]string{"cage_windows_maintenance_guest_connection"}, "the Windows guest connection was not completed", "Start and sign in to the bound guest, then retry with that guest's administrator account."},
		{[]string{"cage_windows_maintenance_guest_components"}, "the Windows guest component installation was not completed", "Keep the original guest running and retry syncing the environment components. If it still fails, export a diagnostics bundle."},
		{[]string{"cage_windows_maintenance_host_relay"}, "the Windows host connection component update was not completed", "Close programs that are using the connection component, then retry syncing the environment components."},
		{[]string{"cage_windows_maintenance_package_preparation"}, "the Windows component package preparation was not completed", "Check the app directory and system drive space, then try again. When updating tools, also check the selected proxy."},
		{[]string{"cage_windows_maintenance_failed"}, "Windows maintenance was not completed", "Start the original operation again from Cage. If it still fails, export a diagnostics bundle."},
		{[]string{"desktop file service state=failed"}, "the Claude Desktop file service has exited", "Reopen Claude Desktop from Cage. If the app keeps exiting, check resource usage in Settings and export a diagnostics bundle."},
		{[]string{"curl: (7)", "connection refused"}, "the target service did not accept the connection", "Make sure the environment and the selected proxy are running. When transferring files, reopen the app that receives the file, then try again."},
		{[]string{"no space left on device", "not enough space on the disk"}, "there is not enough disk space to keep writing", "Free up space on the environment's disk and continue. Do not delete Cage's personal data directory."},
		{[]string{"could not get lock", "unable to acquire the dpkg", "another process using it"}, "another software installation or update is already running in the environment", "Wait for the current installation to finish before continuing. Do not delete the lock files manually."},
		{[]string{"temporary failure resolving", "could not resolve host", "curl: (6)"}, "the download server's domain name could not be resolved", "Check the selected node and DNS in the network and proxy settings, then continue the installation."},
		{[]string{"curl: (28)", "connection timed out", "operation timed out"}, "the download or environment connection timed out", "Check that the selected proxy is available, then continue. Saved downloads will try to resume."},
		{[]string{"curl: (60)", "certificate verify failed", "certificate verification failed"}, "the download server's certificate failed verification", "Check the computer's clock and the selected proxy. If it still fails, export a diagnostics bundle. Do not turn off certificate verification."},
		{[]string{"407 proxy authentication", "proxy authentication required"}, "the proxy server rejected the current credentials", "Update the proxy account or subscription in the network and proxy settings, then apply the node."},
		{[]string{"permission denied", "access is denied"}, "the system denied access to a file or program needed for the installation", "Check the permissions of the app and environment directories. If security software blocked Cage, review its block log first."},
		{[]string{"tried to start delayed item"}, "the environment's package downloader kept retrying and could not finish the installation", "Continue the installation with a Cage build that includes the APT fix. If it still fails, export a diagnostics bundle."},
	} {
		for _, pattern := range rule.patterns {
			if strings.Contains(lower, pattern) {
				return usererror.New(action, rule.reason, rule.next, err)
			}
		}
	}
	return usererror.Wrap(action, err, "Open \"Operation details\" to see the last error. "+failureHelp)
}

func serviceHTTPFailure(action string, status int) error {
	reason, next := fmt.Sprintf("the service returned HTTP %d without a specific cause", status), failureHelp
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		reason, next = "the service rejected the authorization for this connection", "Reconnect the current environment. If it still happens, update the environment components and try again."
	case http.StatusNotFound, http.StatusGone:
		reason, next = "the target window, file, or service endpoint no longer exists", "Reopen the target window or select the file again. If the environment is old, update the environment components first."
	case http.StatusConflict:
		reason, next = "the target state has changed, or another operation has not finished", "Check the current page and target file, then start this operation again."
	case http.StatusRequestEntityTooLarge:
		reason, next = "the file or request exceeds the size the service allows", "Reduce the file or process it in batches, then start this operation again."
	case http.StatusTooManyRequests:
		reason, next = "the service temporarily limited the request rate", "Wait a moment and try again. Avoid clicking repeatedly."
	case http.StatusBadGateway, http.StatusServiceUnavailable:
		reason, next = "the service in the environment is not ready or has stopped responding", "Make sure the environment has started. If it still cannot connect after waiting, check the component status in the environment settings."
	case http.StatusGatewayTimeout:
		reason, next = "timed out waiting for the service in the environment to respond", "Check the environment load and try again later. If it keeps timing out, export a diagnostics bundle."
	}
	return usererror.New(action, reason, next, nil)
}

func fileServiceFailure(status int, data []byte) error {
	known := map[string]string{
		"The upload window was closed. Select the file again":                                         "the upload window was closed. Click the upload button in the app again, then select the file.",
		"The original file window was closed":                                                         "the original file window was closed. Reopen the file window in the app that receives the file.",
		"Finish the open file window first":                                                           "another file window has not been handled yet. Finish or close that window, then select the file again.",
		"Each file cannot exceed 2 GB":                                                                "a single file exceeds the 2 GB limit. Reduce the file and upload it again.",
		"The project folder is not connected. Reopen the project":                                     "the project folder is not connected. Reopen the project in Cage first, then select the directory.",
		"The target did not receive the file. Click an input that supports attachments and try again": "the target did not receive the file. Click an input in the app that supports attachments, then select the file again.",
		"Upload canceled": "the upload was canceled. Select the file again to continue.",
		"The current window did not request a folder": "the current window needs a file and cannot receive a folder. Follow the app's window prompt and select again.",
		"The folder is being handed to the app":       "the folder is still being passed to the app. Wait for the current operation to finish, then select again.",
		"The file location cannot be read":            "the app receiving the file cannot read this location. Make sure the project directory is connected, then select again.",
		"Download service unavailable":                "the download service in the environment is not ready. Reopen the app. For an old environment, update the environment components first.",
		"File request too large":                      "this file request exceeds the size the service allows. Reduce the number of files passed at once.",
		"Select a project folder":                     "this operation needs a connected project folder. Open the project in Cage first, then select the directory again.",
	}
	if reason := known[strings.TrimRight(strings.TrimSpace(string(data)), ".")]; reason != "" {
		return fmt.Errorf("Passing the file failed: %s", reason)
	}
	return serviceHTTPFailure("Passing the file", status)
}

func browserOperation(path string) string {
	switch path {
	case "/navigate":
		return "Opening the web page"
	case "/reload":
		return "Reloading the web page"
	case "/audit":
		return "Reading the browser check results"
	case "/tabs":
		return "Reading the browser tabs"
	case "/paste-image":
		return "Pasting the image"
	case "/editor-restart":
		return "Opening the editor"
	case "/extensions":
		return "Reading the browser extensions"
	default:
		return "Running the browser operation"
	}
}

type failureOutput struct {
	mu   sync.Mutex
	tail []byte
}

func (b *failureOutput) Write(data []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(data)
	if len(data) > 8192 {
		data = data[len(data)-8192:]
	}
	b.tail = append(b.tail, data...)
	if len(b.tail) > 8192 {
		b.tail = b.tail[len(b.tail)-8192:]
	}
	return n, nil
}
func (b *failureOutput) String() string { b.mu.Lock(); defer b.mu.Unlock(); return string(b.tail) }
func (b *failureOutput) writer(dst io.Writer) io.Writer {
	if dst == nil {
		return b
	}
	return io.MultiWriter(dst, b)
}
