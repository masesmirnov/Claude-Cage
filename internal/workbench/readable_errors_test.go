package workbench

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWindowsMaintenanceFailureRetainsStageForBothJobs(t *testing.T) {
	cause := errors.New("synthetic maintenance process failed")
	for _, action := range []string{"Repairing the Windows system management helper", "Updating the native guest components"} {
		for _, test := range []struct {
			phase, reason, next string
		}{
			{"AUTHORIZATION_CANCELED", "Windows administrator authorization was canceled", "Windows authorization window"},
			{"AUTHORIZATION", "authorization window could not open", "Cage on this computer"},
			{"VALIDATION", "binding or component manifest", "reinstall the full Cage app"},
			{"HOST_MANAGER", "system management helper installation", "repairing the system helper"},
			{"GUEST_CONNECTION", "guest connection was not completed", "administrator account"},
			{"GUEST_COMPONENTS", "guest component installation", "syncing the environment components"},
			{"HOST_RELAY", "host connection component update", "using the connection component"},
			{"PACKAGE_PREPARATION", "component package preparation", "system drive space"},
			{"FAILED", "Windows maintenance was not completed", "export a diagnostics bundle"},
		} {
			t.Run(action+"/"+test.phase, func(t *testing.T) {
				output := "CAGE_WINDOWS_MAINTENANCE_" + test.phase + " synthetic stage\naccess is denied token=private-stage-secret"
				err := executionFailure(action, cause, output)
				for _, want := range []string{action, test.reason, test.next} {
					if !strings.Contains(err.Error(), want) {
						t.Fatalf("lost maintenance stage or next action %q: %v", want, err)
					}
				}
				if !errors.Is(err, cause) || strings.Contains(err.Error(), "private-stage-secret") {
					t.Fatal("stage handling lost the cause or exposed arbitrary process output", err)
				}
			})
		}
	}
}

func TestBrowserFailureExplainsOperationAndKnownCause(t *testing.T) {
	for _, tc := range []struct {
		status     int
		body, want string
	}{
		{400, `{"error":"Tab no longer exists"}`, "the tab was closed"},
		{401, `{"error":"private token=do-not-display"}`, "authorization"},
		{503, `{"error":"private token=do-not-display"}`, "not ready"},
		{500, `{"error":"private token=do-not-display"}`, "HTTP 500"},
	} {
		t.Run(fmt.Sprint(tc.status), func(t *testing.T) {
			guest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer guest.Close()
			client := localBrowserClient(t, context.Background(), guest)
			defer client.close()
			_, err := client.request(context.Background(), "test-token", "POST", "/navigate", []byte(`{}`))
			if err == nil || !strings.Contains(err.Error(), tc.want) || strings.Contains(err.Error(), "do-not-display") {
				t.Fatalf("wrong user failure: %v", err)
			}
		})
	}
}

func TestFileServiceRetainsKnownRejectionAndHidesUnknownBody(t *testing.T) {
	known := fileServiceFailure(400, []byte("The upload window was closed. Select the file again"))
	if !strings.Contains(known.Error(), "upload window was closed") || !strings.Contains(known.Error(), "upload button") {
		t.Fatalf("file window reason lost: %v", known)
	}
	unknown := fileServiceFailure(500, []byte("unknown response token=private-file-secret"))
	if !strings.Contains(unknown.Error(), "HTTP 500") || strings.Contains(unknown.Error(), "private-file-secret") {
		t.Fatalf("unsafe unknown response: %v", unknown)
	}
}
