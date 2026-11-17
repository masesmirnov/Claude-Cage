package guestprofile

import (
	"errors"
	"regexp"
	"strings"
)

var homePattern = regexp.MustCompile(`^/home/[A-Za-z][A-Za-z0-9_.-]{0,62}$`)

func validateHardwareOptions(o Options) error {
	for _, home := range []string{o.WorkHome, o.BrowserHome} {
		if home != "" && !homePattern.MatchString(home) {
			return errors.New("The home folder must be a separate single-level folder under /home/ containing only letters, digits, dots, hyphens or underscores")
		}
		if home == "/home/cage" || home == "/home/cage-browser" {
			return errors.New("The home folder cannot use a reserved account folder of the base image")
		}
	}
	if o.WorkHome != "" && o.WorkHome == o.BrowserHome {
		return errors.New("Two accounts cannot share a home folder")
	}
	switch o.GraphicsBackend {
	case "", "auto", "metal", "d3d11", "vulkan", "opengl", "software":
	default:
		return errors.New("The graphics rendering backend is invalid")
	}
	switch o.GPUBackend {
	case "", "default", "virgl":
	default:
		return errors.New("The virtual GPU backend is invalid")
	}
	if o.WebGL == "disabled" && o.GraphicsBackend != "" && o.GraphicsBackend != "auto" {
		return errors.New("A specific 3D rendering backend cannot be required when WebGL is off")
	}
	if o.GPUBackend == "virgl" && o.GraphicsBackend == "vulkan" {
		return errors.New("The current VirGL path only provides OpenGL; Vulkan needs separate Venus/Gfxstream support")
	}
	if o.AudioModel != "" {
		m, ok := findAudioModel(o.AudioModel)
		if !ok {
			return errors.New("The audio model does not exist")
		}
		if o.AudioDescription != "" && o.AudioDescription != m.Label {
			return errors.New("The audio description must match the selected model")
		}
		if o.AudioName != "" && !strings.HasPrefix(o.AudioName, "alsa_output.usb-"+m.Stem+"_") {
			return errors.New("The audio device name does not match the selected model")
		}
	}
	return nil
}

func (p *Profile) WorkHomePath() string {
	if p == nil {
		return "/home/cage"
	}
	if p.WorkHome != "" {
		return p.WorkHome
	}
	return "/home/" + p.Username
}
func (p *Profile) BrowserHomePath() string {
	if p == nil {
		return "/home/cage-browser"
	}
	if p.BrowserHome != "" {
		return p.BrowserHome
	}
	return "/home/" + p.BrowserUsername
}

// Platform refers to the guest OS, not the host. No renderer names are spoofed.
func (o Options) ValidatePlatform(platform string) error {
	if o.GraphicsBackend == "metal" && platform != "darwin" {
		return errors.New("The Metal backend only supports macOS guests")
	}
	if o.GraphicsBackend == "d3d11" && platform != "windows" {
		return errors.New("The D3D11 backend only supports Windows guests")
	}
	if o.GraphicsBackend == "vulkan" && platform != "linux" {
		return errors.New("The Vulkan backend currently only supports Linux guests")
	}
	if o.GPUBackend == "virgl" && platform != "linux" {
		return errors.New("The VirGL backend currently only supports Linux QEMU guests")
	}
	return nil
}

func (p *Profile) GraphicsFlags() []string {
	if p == nil {
		return nil
	}
	switch p.GraphicsBackend {
	case "metal", "d3d11", "vulkan":
		return []string{"--use-gl=angle", "--use-angle=" + p.GraphicsBackend, "--enable-zero-copy"}
	case "opengl":
		return []string{"--use-gl=angle", "--use-angle=gl", "--enable-zero-copy"}
	case "software":
		return []string{"--use-gl=angle", "--use-angle=swiftshader"}
	}
	return nil
}
