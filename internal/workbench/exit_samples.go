package workbench

import (
	"fmt"
	"strings"

	"github.com/sylvinus/agent-vm/internal/diagnostics"
	"github.com/sylvinus/agent-vm/internal/usererror"
)

// All guest platforms return the same observation contract. Do not infer a
// transport failure from an unavailable sample or expose raw guest output.
func incompleteExitSamples(hostIP string, hostErr error, terminal networkObservation, terminalErr error, browser networkObservation, browserErr error) string {
	var missing []string
	for _, sample := range []struct {
		name        string
		observation networkObservation
		err         error
	}{
		{"Host", networkObservation{Status: 200, IP: hostIP}, hostErr},
		{"VM terminal", terminal, terminalErr},
		{"Browser", browser, browserErr},
	} {
		var reason string
		switch {
		case sample.err != nil:
			reason = diagnostics.Redact(usererror.Display("Reading the sample", sample.err, "Run the check again.").Error())
		case sample.observation.Status == 0:
			reason = "no response was received from the check channel"
		case sample.observation.Status != 200:
			reason = fmt.Sprintf("the check channel returned HTTP %d and no exit address was obtained", sample.observation.Status)
		case sample.observation.IP == "":
			reason = "the check channel did not return an exit address"
		}
		if reason != "" {
			missing = append(missing, sample.name+": "+reason)
		}
	}
	if len(missing) == 0 {
		return ""
	}
	return "Exit sampling is incomplete, so the configuration scope cannot be confirmed (" + strings.Join(missing, "; ") + ")"
}
