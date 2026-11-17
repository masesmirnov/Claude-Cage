package workbench

import (
	"context"
	_ "embed"
	"errors"
	"github.com/sylvinus/agent-vm/internal/guestos"
	"strings"
	"time"
)

//go:embed macos_extension_probe.pl
var macOSProbeFSKit string

func (s *Server) checkMacOSSetupProjects(parent context.Context) error {
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	probe := "exec /usr/bin/perl -"
	if s.macosGuest != nil && s.macosGuest.Backend == guestos.MacOSQEMU {
		probe += " server-readonly"
	}
	cmd := s.macOSSSHCommand(ctx, "-T", s.sshTarget(), "--", probe)
	cmd.Stdin = strings.NewReader(macOSProbeFSKit)
	err := cmd.Run()
	s.mu.Lock()
	if err != nil {
		s.macSetupProjectsChecked = time.Time{}
	} else {
		s.macSetupProjectsChecked = time.Now()
	}
	s.mu.Unlock()
	if err != nil {
		return errors.New("File sharing permission has not passed yet. Click \"File System Extensions\", finish the macFUSE installation as guided, and turn on both the macFUSE and macFUSE (local) switches; Cage checks automatically")
	}
	return nil
}
