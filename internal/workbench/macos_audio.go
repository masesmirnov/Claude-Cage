package workbench

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

func (s *Server) macOSAudioStatus(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	cmd := s.sshCommand(ctx, "-T", s.sshTarget(), "--", macOSWindowSocketCommand)
	cmd.Stdin = strings.NewReader("{\"action\":\"audio-status\"}\n")
	cmd.Stderr = io.Discard
	var data bytes.Buffer
	cmd.Stdout = &boundedWindowsStatusWriter{buffer: &data, remaining: 4096}
	var status struct {
		Supported bool   `json:"supported"`
		Available bool   `json:"available"`
		Reason    string `json:"reason"`
		Error     string `json:"error"`
	}
	if cmd.Run() != nil || json.Unmarshal(data.Bytes(), &status) != nil {
		http.Error(w, "The virtual Mac audio component is not connected yet. Finish updating the guest components first.", http.StatusBadGateway)
		return
	}
	if status.Reason == "" {
		status.Reason = status.Error
	}
	if !status.Supported && status.Reason != "requires_gui_login" && status.Reason != "screen_recording_permission" {
		http.Error(w, "The virtual Mac audio component is not connected yet. Finish updating the guest components first.", http.StatusBadGateway)
		return
	}
	if !status.Available {
		message := "Sign in to and unlock a regular account on the virtual Mac first."
		if status.Reason == "screen_recording_permission" {
			message = "In the virtual Mac's System Settings, allow Cage Guest Window to record the screen and system audio."
		}
		http.Error(w, message, http.StatusConflict)
		return
	}
	jsonReply(w, audioFormat)
}

func (s *Server) macOSAudioCapture(w http.ResponseWriter, r *http.Request, ctx context.Context, cancel context.CancelFunc) {
	cmd := s.sshCommand(ctx, "-T", s.sshTarget(), "--", macOSWindowSocketCommand)
	cmd.Stderr = io.Discard
	input, err := cmd.StdinPipe()
	if err != nil {
		http.Error(w, "The audio connection could not be established.", http.StatusBadGateway)
		return
	}
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		input.Close()
		http.Error(w, "The audio connection could not be established.", http.StatusBadGateway)
		return
	}
	if err = cmd.Start(); err != nil {
		input.Close()
		pipe.Close()
		http.Error(w, "The audio connection could not be established.", http.StatusBadGateway)
		return
	}
	defer func() { cancel(); input.Close(); pipe.Close(); _ = cmd.Wait() }()
	// Keep the request side open until cancellation so the guest can distinguish
	// a live, output-only subscriber from a disconnected SSH client.
	if _, err = io.WriteString(input, "{\"action\":\"audio-capture\"}\n"); err != nil {
		http.Error(w, "The audio connection could not be established.", http.StatusBadGateway)
		return
	}
	deadlineDone := make(chan struct{})
	deadline := time.AfterFunc(15*time.Second, func() { defer close(deadlineDone); cancel(); pipe.Close() })
	reader := bufio.NewReaderSize(pipe, 4096)
	err = readAudioReady(reader)
	stopped := cancelWindowsAdmissionDeadline(deadline, deadlineDone)
	if err != nil || !stopped {
		http.Error(w, "Virtual Mac audio could not start. Make sure the guest is unlocked and Cage Guest Window is allowed to record the screen and system audio.", http.StatusBadGateway)
		return
	}
	s.streamAudio(w, r.WithContext(ctx), bufferedAudio{Reader: reader, Closer: pipe})
}
