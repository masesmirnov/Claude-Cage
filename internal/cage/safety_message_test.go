package cage

import (
	"strings"
	"testing"
	"time"
)

func TestSafetyRejectionExplainsFailedCheck(t *testing.T) {
	report := SafetyReport{Policy: SafetyPolicyVersion, ID: "test", RunID: "run", CheckID: "check", Configuration: "config", CreatedAt: time.Now()}
	for _, id := range requiredSafetyChecks {
		report.Checks = append(report.Checks, SafetyCheck{ID: id, Critical: true, State: CheckPassed, Evidence: "verified", CheckedAt: report.CreatedAt})
	}
	report.Checks[4].State = CheckFailed
	report.Checks[4].Title = "Browser time zone and locale"
	report.Checks[4].Evidence = "Browser locale does not match the settings"
	report.Checks[4].Remedy = "Update the environment components, then check again"
	err := report.Authorizes(report.RunID, report.Configuration, time.Now())
	for _, part := range []string{"Browser time zone and locale", "Browser locale does not match the settings", "Update the environment components", "Internet access stays off"} {
		if err == nil || !strings.Contains(err.Error(), part) {
			t.Fatalf("missing actionable failure %q: %v", part, err)
		}
	}
	report.Checks[4].State = CheckUnknown
	report.Checks[4].Evidence = "Could not read the browser settings"
	err = report.Authorizes(report.RunID, report.Configuration, time.Now())
	if err == nil || !strings.Contains(err.Error(), "could not be confirmed") {
		t.Fatalf("unknown was presented as a confirmed mismatch: %v", err)
	}
}
