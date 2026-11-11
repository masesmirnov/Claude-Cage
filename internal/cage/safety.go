package cage

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/sylvinus/agent-vm/internal/diagnostics"
	"github.com/sylvinus/agent-vm/internal/exitpolicy"
)

// SafetyPolicyVersion changes when the mandatory evidence contract changes.
// Reports authorize one running VM with one applied configuration.
const SafetyPolicyVersion = "cage-safety/3"
const SafetyReportLifetime = 24 * time.Hour

type CheckState = exitpolicy.State

const (
	CheckPassed  = exitpolicy.Passed
	CheckFailed  = exitpolicy.Failed
	CheckUnknown = exitpolicy.Unknown
)

type SafetyCheck struct {
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	State     CheckState `json:"state"`
	Critical  bool       `json:"critical"`
	Evidence  string     `json:"evidence"`
	Remedy    string     `json:"remedy,omitempty"`
	CheckedAt time.Time  `json:"checked_at"`
}

type SafetyReport struct {
	Policy        string        `json:"policy"`
	ID            string        `json:"id"`
	RunID         string        `json:"run_id"`
	CheckID       string        `json:"check_id"`
	Configuration string        `json:"configuration"`
	CreatedAt     time.Time     `json:"created_at"`
	Checks        []SafetyCheck `json:"checks"`
}

var requiredSafetyChecks = [...]string{
	"egress_policy", "proxy_transport", "dns_transport", "guest_settings",
	"browser_settings", "filesystem_boundary", "management_boundary",
	"fail_closed", "udp_policy", "ipv6_policy", "exit_consistency",
}

// Authorizes rejects missing, duplicate, unknown, stale or mismatched evidence.
// The required IDs are defined here, never supplied by the frontend or a provider.
func (r SafetyReport) Authorizes(runID, configuration string, now time.Time) error {
	if r.Policy != SafetyPolicyVersion || r.ID == "" || r.CheckID == "" || runID == "" || configuration == "" ||
		r.RunID != runID || r.Configuration != configuration {
		return errors.New("The check report does not belong to the current environment configuration. Check again.")
	}
	if r.CreatedAt.IsZero() || r.CreatedAt.After(now.Add(time.Minute)) || !now.Before(r.CreatedAt.Add(SafetyReportLifetime)) {
		return errors.New("The check report has expired. Check again.")
	}
	seen := make(map[string]SafetyCheck, len(r.Checks))
	for _, check := range r.Checks {
		if _, duplicate := seen[check.ID]; duplicate {
			return errors.New("The check report contains duplicate items.")
		}
		if check.State != CheckPassed && check.State != CheckFailed && check.State != CheckUnknown {
			return errors.New("Invalid check state.")
		}
		seen[check.ID] = check
		if check.Critical && check.State != CheckPassed {
			state := "did not pass"
			if check.State == CheckUnknown {
				state = "could not be confirmed"
			}
			title := safetyCheckTitle(check)
			evidence := strings.TrimRight(diagnostics.Redact(check.Evidence), ".;")
			if evidence == "" {
				evidence = "No check result was obtained"
			}
			next := strings.TrimRight(diagnostics.Redact(check.Remedy), ".;")
			if next == "" {
				next = "Open \"Checklist\" to see the result of this item and check again; if it still fails, export a diagnostics bundle in Settings"
			}
			return fmt.Errorf("Network check failed: %s %s. %s. %s. Internet access stays off.", title, state, evidence, next)
		}
	}
	for _, id := range requiredSafetyChecks {
		check, found := seen[id]
		if !found || !check.Critical || check.State != CheckPassed || check.Evidence == "" ||
			check.CheckedAt.Before(r.CreatedAt) || check.CheckedAt.After(now.Add(time.Minute)) {
			return fmt.Errorf("The network check lacks valid evidence: the record for %s is missing, expired or incomplete. Check again; if it still fails, export a diagnostics bundle in Settings. Internet access stays off.", safetyCheckTitle(SafetyCheck{ID: id}))
		}
	}
	return nil
}

func safetyCheckTitle(check SafetyCheck) string {
	if check.Title != "" && check.Title != check.ID {
		return check.Title
	}
	titles := map[string]string{
		"egress_policy": "Outbound limits outside the environment", "proxy_transport": "Proxy connection", "dns_transport": "DNS resolution", "guest_settings": "System time zone and locale", "browser_settings": "Browser time zone and locale", "filesystem_boundary": "Project folder sharing", "management_boundary": "Host management interface isolation", "fail_closed": "Network cut on proxy failure", "udp_policy": "UDP outbound limits", "ipv6_policy": "IPv6 outbound limits", "exit_consistency": "Exit IP and region",
	}
	if title := titles[check.ID]; title != "" {
		return title
	}
	return "Required check"
}
