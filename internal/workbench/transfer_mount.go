package workbench

import "github.com/sylvinus/agent-vm/internal/containerenv"

// Lima can change its base share only while stopped. Reconnecting a running
// instance must not keep serving the former project as the transfer directory.
func (s *Server) requireCurrentLinuxTransferMount() error {
	if s.macosGuest != nil || s.windowsGuest != nil || containerenv.Configured(s.profile) || !s.vmRunning() {
		return nil
	}
	if shares, _ := s.inspectVMLayout(); shares {
		return nil
	}
	failure := &projectShareError{Recovery: "environment-restart", Message: "The download folder does not match the running file share. Save your work, stop the environment and start it again; project files, sessions and sign-in state are kept."}
	s.mu.Lock()
	s.ready = false
	s.mu.Unlock()
	_ = s.closeProxyGate(failure.Message)
	return failure
}
