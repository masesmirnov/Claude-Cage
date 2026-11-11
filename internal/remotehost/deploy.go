package remotehost

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/sylvinus/agent-vm/deploy/cloud"
	"golang.org/x/crypto/ssh"
)

func runSSH(client *ssh.Client, command string, input io.Reader) ([]byte, error) {
	session, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	defer session.Close()
	out := &limitedOutput{limit: 64 << 10}
	session.Stdout, session.Stderr, session.Stdin = out, io.Discard, input
	err = session.Run(command)
	return out.Bytes(), err
}

func lifecycleCommand(p HostProfile, action string, extra ...string) string {
	args := []string{"bash", "-c", cloud.Lifecycle, "cage-cloud", action, p.Executable, p.ConfigPath}
	args = append(args, extra...)
	for i := range args {
		args[i] = shellQuote(args[i])
	}
	return strings.Join(args, " ")
}

func deploymentError(err error) error {
	var exit *ssh.ExitError
	if errors.As(err, &exit) {
		messages := map[int]string{
			61: "A Linux x86_64 server is required. Sign in with an ordinary SSH user.",
			62: "The server is missing the user mapping, tools, FUSE, TUN or cgroup v2 required by rootless containers.",
			63: "The systemd user service of the SSH user is unavailable.",
			64: "Automatic deployment needs an absolute configuration path made of letters, digits, dots, hyphens, underscores and slashes.",
			65: "The target directory or service already belongs to another configuration. Choose an empty configuration directory, or enter the path of an installed Cage program.",
			66: "The specified Cage program was not found. For the first automatic deployment, set the program path to cage.",
			67: "Cage is being deployed on this server. Reconnect later.",
			68: "The disk holding the configuration directory needs at least 7 GiB of free space.",
			69: "The deployment package transfer verification failed. Deploy again.",
			70: "The separate container engine on the server failed to start. Check the user service log and cgroup delegation.",
			71: "The server could not load or verify the work environment image. Check the disk space.",
			72: "The server failed to prepare the work environment. Check cloud-host/setup.log in the configuration directory and try again.",
			74: "Downloading the container engine failed. Check the server network and try again.",
			75: "The server could not get the pinned Debian base image. Check the cloud network and try again.",
			76: "The server failed to install tools. Detailed logs are under cloud-host/build in the configuration directory.",
			73: "The cloud Cage user service failed to start. Check the server user service log.",
		}
		if message := messages[exit.ExitStatus()]; message != "" {
			return failure("cloud_setup_failed", message)
		}
	}
	return failure("server_entry_failed", "Cage in the cloud is not ready. Check the Cage program, configuration path and user service on the server.")
}

// SSH reads the archive as a stream. Report whole percentages without loading it into memory.
type uploadProgress struct {
	size, sent int64
	last       int
	phase      func(string)
}

func (p *uploadProgress) Write(data []byte) (int, error) {
	p.sent += int64(len(data))
	percent := int(p.sent * 100 / p.size)
	if percent != p.last {
		p.last = percent
		if percent == 100 {
			p.phase("cloud_install")
		} else {
			p.phase("cloud_upload_" + strconv.Itoa(percent))
		}
	}
	return len(data), nil
}

func cloudEntry(ctx context.Context, client *ssh.Client, p HostProfile, deploy bool, phase func(string)) ([]byte, error) {
	command, err := ServerEntryCommand(p)
	if err != nil {
		return nil, err
	}
	if out, err := runSSH(client, command, nil); err == nil {
		return out, nil
	}
	phase("cloud_detect")
	out, err := runSSH(client, lifecycleCommand(p, "probe"), nil)
	if err != nil {
		return nil, deploymentError(err)
	}
	switch string(out) {
	case "missing":
		if !deploy {
			return nil, failure("deployment_required", "Cage has not been deployed on this host yet. Deployment installs Cage and a separate container environment in the SSH user's directory.")
		}
		binary, err := os.Executable()
		if err != nil {
			return nil, err
		}
		payload := filepath.Join(filepath.Dir(binary), "cloud-linux-amd64.tar")
		sum, err := os.ReadFile(payload + ".sha256")
		digest := strings.TrimSpace(string(sum))
		if err != nil || !regexp.MustCompile("^[a-f0-9]{64}$").MatchString(digest) {
			return nil, failure("payload_missing", "This client is missing the cloud deployment package. Install a Cage that includes the deployment package.")
		}
		file, err := os.Open(payload)
		if err != nil {
			return nil, failure("payload_missing", "Could not read the cloud deployment package. Check the Cage installation.")
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return nil, failure("payload_missing", "The cloud deployment package is invalid. Check the Cage installation.")
		}
		input := io.TeeReader(file, &uploadProgress{size: info.Size(), phase: phase})
		phase("cloud_upload_0")
		if _, err = runSSH(client, lifecycleCommand(p, "install", digest), input); err != nil {
			return nil, deploymentError(err)
		}
	case "manual", "managed":
		if out, err := runSSH(client, lifecycleCommand(p, "entry"), nil); err == nil {
			return out, nil
		}
		phase("cloud_start")
		if _, err := runSSH(client, lifecycleCommand(p, "start"), nil); err != nil {
			return nil, deploymentError(err)
		}
	default:
		return out, nil
	}
	phase("server_handshake")
	for i := 0; i < 40; i++ {
		if out, err := runSSH(client, lifecycleCommand(p, "entry"), nil); err == nil {
			return out, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return nil, failure("server_start_timeout", "The cloud service was asked to start, but its connection entry is not ready yet. Check the user service log and reconnect.")
}
