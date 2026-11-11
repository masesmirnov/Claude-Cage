package workbench

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestIncompleteExitSamplesIdentifyRoutesAndRedactPrivateErrors(t *testing.T) {
	good := networkObservation{Status: 200, IP: "8.8.8.8"}
	message := incompleteExitSamples("", context.DeadlineExceeded, good, nil, networkObservation{}, errors.New("Browser request failed https://user:password@private.example/secret token=private-token /Users/alice/project"))
	for _, want := range []string{"Host", "timed out", "Browser", "Exit sampling is incomplete"} {
		if !strings.Contains(message, want) {
			t.Fatalf("missing diagnostic %q: %s", want, message)
		}
	}
	for _, unwanted := range []string{"VM terminal", "private.example", "private-token", "alice", "password"} {
		if strings.Contains(message, unwanted) {
			t.Fatalf("successful route or private data included: %s", message)
		}
	}
	if message := incompleteExitSamples("8.8.8.8", nil, good, nil, good, nil); message != "" {
		t.Fatal("complete samples reported missing", message)
	}
	for _, tc := range []struct {
		observation networkObservation
		want        string
	}{
		{networkObservation{}, "no response was received from the check channel"},
		{networkObservation{Status: 503}, "HTTP 503"},
		{networkObservation{Status: 200}, "did not return an exit address"},
	} {
		message := incompleteExitSamples("8.8.8.8", nil, tc.observation, nil, good, nil)
		if !strings.Contains(message, "VM terminal: ") || !strings.Contains(message, tc.want) || strings.Contains(message, "Host: ") || strings.Contains(message, "Browser: ") {
			t.Fatalf("wrong route or failure category: %s", message)
		}
	}
}
