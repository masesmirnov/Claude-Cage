package workbench

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sylvinus/agent-vm/internal/cage"
)

func TestNetworkStatusImmediatelyAfterManualGrant(t *testing.T) {
	for _, tc := range []struct{ failure, locationError string }{
		{"exit probe", ""},
		{"exit probe", "The exit location service is temporarily unavailable"},
		{"proxy core", "The exit location service is temporarily unavailable"},
	} {
		t.Run(tc.failure+"/location-error="+tc.locationError, func(t *testing.T) {
			s, gate := grantedToolUpdateServer(t)
			s.setJobForTest(Job{})
			if tc.locationError != "" {
				s.recordLocationProbeLocked(Location{IP: "192.0.2.1"}, errors.New(tc.locationError))
			}
			s.recordLocationProbeLocked(Location{}, errors.New("The exit IP is temporarily unavailable"))
			openBeforeFailure := gate.Status()
			client, err := s.gateClient()
			if err != nil {
				t.Fatal(err)
			}
			checkStatus := func(wantMode, wantError string) {
				t.Helper()
				response := httptest.NewRecorder()
				s.status(response, httptest.NewRequest("GET", "/api/status", nil))
				var status struct {
					NetworkError string      `json:"network_error"`
					Safety       safetyState `json:"safety"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil {
					t.Fatal(err)
				}
				errorMatches := status.NetworkError == wantError
				if wantMode == cage.GateClosed && tc.failure == "exit probe" {
					errorMatches = strings.HasPrefix(status.NetworkError, wantError+"; ") && strings.Contains(status.NetworkError, "automatic recheck")
				}
				if status.Safety.Gate == nil || status.Safety.Gate.Mode != wantMode || !errorMatches {
					t.Fatalf("expected %s and %q, got %+v", wantMode, wantError, status)
				}
				if wantMode == cage.GateOpen && status.Safety.Error != "" {
					t.Fatalf("open gate retained a safety error: %s", status.Safety.Error)
				}
			}

			issue := "The proxy exit probe timed out"
			if tc.failure == "proxy core" {
				s.checkProxyHealth() // The isolated profile has no running proxy core.
				issue = "The built-in proxy is not ready. Internet access stays off"
			} else {
				s.finishSafetyObservation(t.Context(), client, openBeforeFailure, "", issue, true)
			}
			s.publishGate(openBeforeFailure) // A delayed poll must not clear the current failure.
			checkStatus(cage.GateClosed, issue)

			checking, err := client.BeginCheck(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			s.publishGate(checking)
			checkStatus(cage.GateChecking, issue)
			report := *checking.Report
			report.ID, report.CheckID, report.CreatedAt = "manual-recheck", checking.CheckID, time.Now()
			for i := range report.Checks {
				report.Checks[i].CheckedAt = report.CreatedAt
			}
			opened, err := client.Grant(t.Context(), report)
			if err != nil {
				t.Fatal(err)
			}
			s.publishGate(opened)
			checkStatus(cage.GateOpen, tc.locationError)
		})
	}
}

func TestNetworkIntentDiagnosticLastsUntilDurableRepair(t *testing.T) {
	s, gate := grantedToolUpdateServer(t)
	path := filepath.Join(s.profile, "network-intent.json")
	if err := os.WriteFile(path, []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.restoreNetworkIntent(); err == nil {
		t.Fatal("corrupt intent was accepted")
	}
	const locationFailure = "The exit location service is temporarily unavailable"
	s.recordLocationProbeLocked(Location{IP: "192.0.2.1"}, errors.New(locationFailure))
	s.publishGate(gate.Status())
	if !s.networkPaused || s.currentNetworkErrorLocked() != s.networkIntentError || s.networkIntentError == "" {
		t.Fatal("unrelated observations masked the invalid network intent")
	}
	if err := s.pauseNetworkNow("manual pause"); err != nil {
		t.Fatal(err)
	}
	if !s.networkPaused || gate.Status().Mode != cage.GateClosed || s.currentNetworkErrorLocked() != locationFailure {
		t.Fatal("repairing the intent must clear only its diagnostic and preserve the pause")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	err := s.resumeNetworkIntentAt(s.safety.pauseVersion)
	if err == nil || !s.networkPaused || s.networkIntentError == "" {
		t.Fatal("failed persistence should keep the error and the pause")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := s.resumeNetworkIntentAt(s.safety.pauseVersion); err != nil {
		t.Fatal(err)
	}
	if s.networkPaused || s.currentNetworkErrorLocked() != locationFailure || gate.Status().Mode != cage.GateClosed {
		t.Fatal("durable resume may clear the intent error, but cannot grant network access")
	}
}
