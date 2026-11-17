package workbench

import (
	"errors"
	"strings"
	"testing"
)

func TestPackageInstallFailureClassification(t *testing.T) {
	const cmd = "APT_FAILED exit=100 command=apt-get install -y --no-install-recommends git curl ripgrep\n"
	for _, tc := range []struct {
		name, log string
		reason    string
		pkg       string
	}{
		{"dns", "Err:1 https://deb.debian.org/debian trixie InRelease\n  Temporary failure resolving 'deb.debian.org'\n" + cmd, "cannot resolve the download server domain name", "git curl ripgrep"},
		{"timeout", "Could not connect to 10.0.2.2:7890 (10.0.2.2). - connect (110: Connection timed out)\n" + cmd, "failed or timed out connecting to the download server", "git curl ripgrep"},
		{"missing", "E: Unable to locate package ripgrep-x\n" + cmd, "Cannot find the required packages", "ripgrep-x"},
		{"candidate", "E: Package 'fd-find' has no installation candidate\nnext line\n" + cmd, "Cannot find the required packages", "fd-find"},
		{"unknown", "something odd happened\n" + cmd, "no recognizable cause", "git curl ripgrep"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := packageInstallFailure("Installing Linux base packages", errors.New("exit status 1"), "Installing base packages...\n"+tc.log)
			if err == nil {
				t.Fatal("expected failure")
			}
			for _, want := range []string{"Installing Linux base packages failed", tc.reason, "Failed command: apt-get install", "packages involved: " + tc.pkg, "end of the error output"} {
				if !strings.Contains(err.Error(), want) {
					t.Fatalf("missing %q: %v", want, err)
				}
			}
			if strings.Contains(err.Error(), "7890") || strings.Contains(err.Error(), "deb.debian.org") {
				t.Fatalf("unredacted address: %v", err)
			}
		})
	}
}

func TestPackageInstallFailureWithoutMarkerFallsBack(t *testing.T) {
	if err := packageInstallFailure("Install", errors.New("x"), "Installing base packages...\nboom"); err != nil {
		t.Fatalf("no evidence must keep the generic path: %v", err)
	}
}

func TestPackageInstallFailureBoundsAndRedacts(t *testing.T) {
	log := strings.Repeat("noise\n", 50) + "proxy=http://user:pass@127.0.0.1:7890 token=abc123 " + strings.Repeat("x", 500) + "\nAPT_FAILED exit=1 command=apt-get update\n"
	msg := packageInstallFailure("Install", errors.New("x"), log).Error()
	for _, bad := range []string{"user:pass", "127.0.0.1", "abc123"} {
		if strings.Contains(msg, bad) {
			t.Fatalf("leaked %q: %s", bad, msg)
		}
	}
	if len(msg) > 1500 || strings.Count(msg, "noise") > aptTailLines {
		t.Fatalf("not bounded: %d", len(msg))
	}
}

func TestPackageInstallFailureReadsOlderSetupOutput(t *testing.T) {
	const output = "E: Unable to locate package missing-package\n"
	const payload = "exit=100 command=apt-get install missing-package\n"
	cause := errors.New("exit status 100")
	current := packageInstallFailure("Install", cause, output+"APT_FAILED "+payload)
	older := packageInstallFailure("Install", cause, output+"CAGE_APT_FAILED "+payload)
	if current == nil || older == nil || current.Error() != older.Error() {
		t.Fatalf("old setup output lost its failure details: current=%v older=%v", current, older)
	}
}
