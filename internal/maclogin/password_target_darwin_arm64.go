//go:build darwin && arm64 && cgo && !no_vz

package maclogin

/*
#include "bridge.h"
*/
import "C"

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"time"

	"github.com/sylvinus/agent-vm/internal/guestos"
)

type passwordProbe struct {
	command *exec.Cmd
	input   io.WriteCloser
	output  io.ReadCloser
	scanner *bufio.Scanner
	cancel  context.CancelFunc
	user    string
}

func (s *loginSession) openPasswordProbe() (*passwordProbe, error) {
	bound, err := guestos.LoadMacOSProfile(s.profile)
	if err != nil || bound == nil || bound.SetupID == "" {
		return nil, errors.New("The first-time setup identity has changed. Reopen the authorization screen.")
	}
	administrator, err := guestos.MacOSProvisionUser(s.profile)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	command, err := guestGUIProbeCommand(ctx, s.profile, administrator, bound.User, "--setup-password-probe")
	if err != nil {
		cancel()
		return nil, err
	}
	input, err := command.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	output, err := command.StdoutPipe()
	if err != nil {
		input.Close()
		cancel()
		return nil, err
	}
	if err = command.Start(); err != nil {
		input.Close()
		output.Close()
		cancel()
		return nil, err
	}
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 32<<10)
	return &passwordProbe{command: command, input: input, output: output, scanner: scanner, cancel: cancel, user: bound.User}, nil
}

func (probe *passwordProbe) close() {
	probe.input.Close()
	probe.output.Close()
	probe.cancel()
	_ = probe.command.Wait()
}

func (probe *passwordProbe) target() (passwordTarget, error) {
	var target passwordTarget
	if _, err := io.WriteString(probe.input, "{\"action\":\"probe\"}\n"); err != nil {
		return target, err
	}
	if !probe.scanner.Scan() {
		return target, errors.New("Could not confirm the system authorization window. Reopen the authorization screen.")
	}
	if json.Unmarshal(probe.scanner.Bytes(), &target) != nil || !target.valid(probe.user) {
		return target, errors.New("Open the Apple system authorization window, then select the password field to fill in.")
	}
	return target, nil
}

func (s *loginSession) selectPasswordPosition(x, y int) {
	s.passwordSelection = passwordSelection{}
	probe, err := s.openPasswordProbe()
	if err != nil {
		return
	}
	defer probe.close()
	target, err := probe.target()
	if err == nil && target.SelectionRequired && target.contains(x, y) {
		s.passwordSelection = passwordSelection{Geometry: target.geometry(), X: x, Y: y, Clicked: time.Now()}
	}
}

func (s *loginSession) fillSetupPassword(password string) error {
	selection := s.passwordSelection
	s.passwordSelection = passwordSelection{}
	sequence, valid := passwordKeys(password)
	if !s.setup || !valid {
		return errors.New("The first-time setup credentials are unavailable. Reopen the authorization screen.")
	}
	probe, err := s.openPasswordProbe()
	if err != nil {
		return err
	}
	defer probe.close()
	target, err := probe.target()
	if err != nil {
		return err
	}
	if !selection.permits(target, probe.user, time.Now()) {
		return errors.New("Select the password field of the system authorization window first, then click to fill in the authorization password.")
	}
	if !target.Accessibility && !bool(C.cageLoginClick(C.int(selection.X), C.int(selection.Y))) {
		return errors.New("The selected password field has changed. Select it again.")
	}
	geometry := target.geometry()
	check := func() error {
		current, err := probe.target()
		if err != nil {
			return err
		}
		if current.geometry() != geometry || !selection.permits(current, probe.user, time.Now()) {
			return errors.New("The system authorization window or password field has changed. Filling stopped. Select it again.")
		}
		return nil
	}
	if err = check(); err != nil {
		return err
	}
	if !bool(C.cageLoginSelectAll()) {
		return errors.New("The system password field is not ready yet. Try again.")
	}
	for _, key := range sequence {
		if err = check(); err != nil {
			return err
		}
		if !bool(C.cageLoginKey(C.int(key.code), C.bool(key.shift))) {
			return errors.New("The authorization password could not be filled in. Select the password field again and try again.")
		}
	}
	return nil
}
