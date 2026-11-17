package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/sylvinus/agent-vm/internal/guestprofile"
)

type deviceObservation struct {
	UserAgent   string `json:"user_agent"`
	Platform    string `json:"platform"`
	ClientHints *struct {
		Brands []struct {
			Brand   string `json:"brand"`
			Version string `json:"version"`
		} `json:"brands"`
		Platform string `json:"platform"`
		Mobile   bool   `json:"mobile"`
	} `json:"client_hints"`
	Screen struct {
		Width      int     `json:"width"`
		Height     int     `json:"height"`
		ColorDepth int     `json:"color_depth"`
		PixelRatio float64 `json:"pixel_ratio"`
	} `json:"screen"`
	Viewport struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"viewport"`
	Canvas struct {
		State    string `json:"state"`
		Checksum string `json:"checksum,omitempty"`
	} `json:"canvas"`
	WebGL struct {
		State    string `json:"state"`
		API      string `json:"api,omitempty"`
		Vendor   string `json:"vendor"`
		Renderer string `json:"renderer"`
		Version  string `json:"version"`
	} `json:"webgl"`
	Audio struct {
		State  string   `json:"state"`
		Labels []string `json:"labels"`
	} `json:"audio"`
	WebGPU bool `json:"webgpu"`
}

type deviceSystemObservation struct {
	Hostname         string `json:"hostname"`
	Username         string `json:"username"`
	Home             string `json:"home"`
	AudioName        string `json:"audio_name"`
	AudioDescription string `json:"audio_description"`
}

type deviceCheckItem struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	State    string `json:"state"`
	Evidence string `json:"evidence"`
}
type deviceCheckReport struct {
	Target        string                   `json:"target"`
	CheckedAt     time.Time                `json:"checked_at"`
	Checks        []deviceCheckItem        `json:"checks"`
	Browser       *deviceObservation       `json:"browser,omitempty"`
	System        *deviceSystemObservation `json:"system,omitempty"`
	Application   *claudeDesktopState      `json:"application,omitempty"`
	RendererClass string                   `json:"renderer_class,omitempty"`
}

func publicDeviceText(s string, limit int) bool {
	return len(s) <= limit && !strings.ContainsAny(s, "\x00\r\n")
}
func (v *deviceObservation) valid() bool {
	if v == nil || !publicDeviceText(v.UserAgent, 1024) || !publicDeviceText(v.Platform, 128) || !publicDeviceText(v.WebGL.Renderer, 512) || !publicDeviceText(v.WebGL.Vendor, 256) || !publicDeviceText(v.WebGL.Version, 256) || len(v.Audio.Labels) > 8 {
		return false
	}
	for _, label := range v.Audio.Labels {
		if !publicDeviceText(label, 128) {
			return false
		}
	}
	if !publicDeviceText(v.WebGL.API, 16) {
		return false
	}
	if v.Canvas.State != "passed" && v.Canvas.State != "failed" && v.Canvas.State != "blocked" && v.Canvas.State != "unavailable" {
		return false
	}
	if v.WebGL.State != "passed" && v.WebGL.State != "failed" && v.WebGL.State != "unavailable" && v.WebGL.State != "readback_blocked" {
		return false
	}
	if v.Canvas.Checksum != "" && !regexp.MustCompile(`^[a-f0-9]{8}$`).MatchString(v.Canvas.Checksum) {
		return false
	}
	if v.ClientHints != nil {
		if len(v.ClientHints.Brands) > 8 || !publicDeviceText(v.ClientHints.Platform, 128) {
			return false
		}
		for _, brand := range v.ClientHints.Brands {
			if !publicDeviceText(brand.Brand, 64) || !publicDeviceText(brand.Version, 32) {
				return false
			}
		}
	}
	return v.Screen.Width >= 0 && v.Screen.Width <= 32768 && v.Screen.Height >= 0 && v.Screen.Height <= 32768 && v.Screen.PixelRatio >= 0 && v.Screen.PixelRatio <= 16 && v.Viewport.Width >= 0 && v.Viewport.Width <= 32768 && v.Viewport.Height >= 0 && v.Viewport.Height <= 32768
}

var chromeMajor = regexp.MustCompile(`(?:Chrome|Chromium|Edg)/([0-9]+)\.`)
var softwareRenderer = regexp.MustCompile(`(?i)swiftshader|llvmpipe|softpipe|software|\bwarp\b|basic render`)
var virtualRenderer = regexp.MustCompile(`(?i)virgl|paravirtual|virtio`)

func evaluateDevice(p *guestprofile.Profile, v *deviceObservation) ([]deviceCheckItem, string) {
	if !v.valid() {
		return []deviceCheckItem{{"browser-evidence", "Browser observation", "unknown", "The guest has not provided complete, valid local observation data yet; update components and check again."}}, "unobserved"
	}
	items := []deviceCheckItem{}
	add := func(id, title, state, evidence string) {
		items = append(items, deviceCheckItem{id, title, state, evidence})
	}
	ua := chromeMajor.FindStringSubmatch(v.UserAgent)
	if len(ua) == 2 && v.ClientHints != nil {
		matched := false
		inconsistent := false
		platform := ""
		switch {
		case strings.Contains(v.UserAgent, "Windows NT"):
			platform = "Windows"
		case strings.Contains(v.UserAgent, "Macintosh"):
			platform = "macOS"
		case strings.Contains(v.UserAgent, "X11; Linux"):
			platform = "Linux"
		}
		if platform != "" && v.ClientHints.Platform != "" && platform != v.ClientHints.Platform {
			inconsistent = true
		}
		for _, brand := range v.ClientHints.Brands {
			if brand.Brand == "Chromium" || brand.Brand == "Google Chrome" || brand.Brand == "Microsoft Edge" {
				matched = true
				if brand.Version != ua[1] {
					inconsistent = true
				}
			}
		}
		if inconsistent {
			add("user-agent", "Browser UA and Client Hints", "failed", "The actual browser major version or system platform does not match; restore the browser's native identity settings.")
		} else if matched {
			add("user-agent", "Browser UA and Client Hints", "passed", "The browser major version and system platform information provided match. This item does not verify where the browser was installed from.")
		} else {
			add("user-agent", "Browser UA and Client Hints", "unknown", "The browser did not provide a Chromium brand version that can be checked.")
		}
	} else {
		add("user-agent", "Browser UA and Client Hints", "unknown", "The current document does not expose Client Hints, so version consistency cannot be judged from it.")
	}
	class := "unobserved"
	if v.WebGL.Renderer != "" && v.WebGL.Renderer != "WebKit WebGL" && v.WebGL.Renderer != "WebGL" {
		class = "driver-reported"
		if softwareRenderer.MatchString(v.WebGL.Renderer) {
			class = "software"
		} else if virtualRenderer.MatchString(v.WebGL.Renderer) {
			class = "virtual-gpu"
		}
	}
	if p != nil && p.WebGL == "disabled" {
		if v.WebGL.State == "unavailable" {
			add("webgl-render", "WebGL rendering correctness", "passed", "WebGL did not create a context, which matches the saved off setting.")
		} else {
			add("webgl-render", "WebGL rendering correctness", "failed", "WebGL is saved as off, but the actual document can still create a context; restart the browser and check the components.")
		}
	} else if v.WebGL.State == "passed" {
		add("webgl-render", "WebGL rendering correctness", "passed", "Shader compilation, linking and the 4×4 pixel readback match the reference colors. This result does not prove physical GPU passthrough.")
	} else if v.WebGL.State == "failed" {
		add("webgl-render", "WebGL rendering correctness", "failed", "Shaders or the pixel readback do not match expectations; check the selected backend and driver.")
	} else {
		add("webgl-render", "WebGL rendering correctness", "unknown", "WebGL is unavailable or pixel reading is restricted, so rendering correctness was not verified.")
	}
	backend := "auto"
	if p != nil && p.GraphicsBackend != "" {
		backend = p.GraphicsBackend
	}
	if class == "software" && backend != "software" {
		state := "warning"
		if backend != "auto" {
			state = "failed"
		}
		add("graphics-backend", "Actual graphics backend", state, "Software rendering detected: "+v.WebGL.Renderer)
	} else if class == "unobserved" {
		add("graphics-backend", "Actual graphics backend", "unknown", "No renderer was observed, so hardware acceleration cannot be claimed.")
	} else {
		state := "passed"
		evidence := v.WebGL.Renderer
		if class == "virtual-gpu" {
			evidence = "Virtual GPU driver: " + evidence
		}
		if backend == "software" && class != "software" {
			state = "failed"
			evidence = "The selected software backend does not match the actual renderer: " + evidence
		}
		markers := map[string]string{"metal": "metal", "d3d11": "direct3d11", "vulkan": "vulkan", "opengl": "opengl"}
		if marker := markers[backend]; marker != "" && !strings.Contains(strings.ToLower(v.WebGL.Renderer), marker) {
			state = "unknown"
			evidence = "The driver report could not confirm the selected API: " + evidence
		}
		if p != nil && p.GPUBackend == "virgl" && !strings.Contains(strings.ToLower(v.WebGL.Renderer), "virgl") {
			state = "failed"
			evidence = "The requested VirGL renderer was not observed: " + evidence
		}
		add("graphics-backend", "Actual graphics backend", state, evidence)
	}
	if p != nil && p.Canvas == "blocked" && (v.Canvas.State == "passed" || v.Canvas.State == "failed") {
		add("canvas-render", "Canvas rendering and reading", "failed", "Canvas reading is saved as blocked, but the actual document can still read pixels back; restart the browser and check the components.")
	} else if v.Canvas.State == "passed" {
		add("canvas-render", "Canvas rendering and reading", "passed", "Known color readback completed, font sample checksum "+v.Canvas.Checksum+"; different devices are not required to produce different values.")
	} else if p != nil && p.Canvas == "blocked" && v.Canvas.State == "blocked" {
		add("canvas-render", "Canvas rendering and reading", "passed", "Image reading is restricted, which matches the saved setting.")
	} else if v.Canvas.State == "failed" {
		add("canvas-render", "Canvas rendering and reading", "failed", "Known color readback does not match expectations.")
	} else {
		add("canvas-render", "Canvas rendering and reading", "unknown", "Canvas pixels cannot be read right now, so actual image traits were not inferred.")
	}
	if len(v.Audio.Labels) == 0 {
		add("browser-audio", "Browser audio devices", "unknown", "The document has no device label permission; the check does not ask for microphone permission and does not count empty labels as a pass.")
	} else {
		add("browser-audio", "Browser audio devices", "observed", strings.Join(v.Audio.Labels, "; "))
	}
	return items, class
}

// Fixed local commands return only public fields. No process arguments,
// account files, application profiles or full PulseAudio properties leave it.
const deviceSystemProbe = `python3 - <<'CAGE_DEVICE_SYSTEM'
import json, os, pwd, socket, subprocess
account=pwd.getpwuid(os.getuid())
result={'hostname':socket.gethostname(),'username':account.pw_name,'home':account.pw_dir,'audio_name':'','audio_description':''}
try:
    text=subprocess.run(['pactl','--server=unix:/run/cage-audio/native','-f','json','list','sinks'],capture_output=True,text=True,timeout=3,check=True).stdout
    sinks=json.loads(text)
    if len(sinks)==1:
        result['audio_name']=str(sinks[0].get('name',''))[:120]
        result['audio_description']=str(sinks[0].get('description',''))[:128]
except Exception:
    pass
print(json.dumps(result))
CAGE_DEVICE_SYSTEM`

func (s *Server) deviceCheck(w http.ResponseWriter, r *http.Request) {
	if !s.hasTrustedView(r) {
		http.Error(w, "Check the guest in a trusted workbench", http.StatusForbidden)
		return
	}
	var in struct {
		Target string `json:"target"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Target != "browser" && in.Target != "desktop" {
		http.Error(w, "The check target is invalid", 400)
		return
	}
	if !s.vmRunning() {
		http.Error(w, "Start the guest first", 409)
		return
	}
	if !s.op.TryLock() {
		http.Error(w, "An environment operation is in progress; check later", 409)
		return
	}
	defer s.op.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	p, err := guestprofile.Load(s.profile)
	if err != nil {
		requestError(w, err)
		return
	}
	report := deviceCheckReport{Target: in.Target, CheckedAt: time.Now(), Checks: []deviceCheckItem{}}
	if s.macosGuest == nil && s.windowsGuest == nil {
		if data, e := s.guest(ctx, deviceSystemProbe); e == nil {
			var machine deviceSystemObservation
			if json.Unmarshal(data, &machine) == nil && publicDeviceText(machine.Hostname, 255) && publicDeviceText(machine.Username, 64) && publicDeviceText(machine.Home, 128) && publicDeviceText(machine.AudioName, 120) && publicDeviceText(machine.AudioDescription, 128) {
				report.System = &machine
			}
		}
	}
	if report.System != nil && p != nil {
		for _, item := range []struct{ id, title, observed, expected string }{{"hostname", "Guest host name", report.System.Hostname, p.Hostname}, {"username", "Work account", report.System.Username, p.Username}, {"home", "Work home folder", report.System.Home, p.WorkHomePath()}, {"audio-model", "System audio device", report.System.AudioDescription, p.AudioDescription}} {
			state := "passed"
			if item.observed == "" {
				state = "unknown"
			} else if item.observed != item.expected && !(item.id == "hostname" && strings.EqualFold(item.observed, item.expected)) {
				state = "failed"
			}
			report.Checks = append(report.Checks, deviceCheckItem{item.id, item.title, state, "Actual value: " + item.observed})
		}
	}
	if in.Target == "desktop" {
		state, err := s.deviceDesktopState(ctx)
		if err == nil {
			report.Application = state
			status := "unknown"
			evidence := "The app is not running, so its process state cannot be observed."
			if state.Running {
				status = "observed"
				evidence = "Observed the Claude Desktop running state and version " + state.Version
			}
			report.Checks = append(report.Checks, deviceCheckItem{"desktop-process", "Claude Desktop app", status, evidence})
		}
		report.Checks = append(report.Checks, deviceCheckItem{"desktop-renderer", "Claude Desktop internal renderer", "unknown", "The official app has no supported local rendering self-check interface; no sign-in data was read, no code was injected and no debugging port was opened, and browser results were not used in place of in-app observation."})
	} else {
		cfg, e := loadConfig(s.configPath)
		if e != nil {
			requestError(w, e)
			return
		}
		var observation browserObservation
		s.mu.Lock()
		token := s.credentials.Token
		s.mu.Unlock()
		body, _ := json.Marshal(map[string]any{"timezone": cfg.Timezone, "network": false, "device": true})
		data, err := s.guestAPI(ctx, token, http.MethodPost, "/audit", body)
		if err == nil {
			err = json.Unmarshal(data, &observation)
		}
		if err != nil {
			report.Checks = append(report.Checks, deviceCheckItem{"browser-evidence", "Browser observation", "unknown", "The local diagnostic document did not finish; confirm that the browser and guest components are available and check again."})
		} else {
			items, class := evaluateDevice(p, observation.Device)
			report.Checks = append(report.Checks, items...)
			report.RendererClass = class
			if observation.Device.valid() {
				report.Browser = observation.Device
			}
		}
	}
	jsonReply(w, report)
}

func (s *Server) deviceDesktopState(ctx context.Context) (*claudeDesktopState, error) {
	var state claudeDesktopState
	if s.windowsGuest != nil {
		err := s.windowsDesktopRequest(ctx, "status", nil, &state)
		return &state, err
	}
	if s.macosGuest != nil {
		data, err := s.guest(ctx, `test -d /Applications/Claude.app && printf 'installed\n'; /usr/bin/pgrep -x Claude >/dev/null && printf 'running\n'; /usr/bin/defaults read /Applications/Claude.app/Contents/Info CFBundleShortVersionString 2>/dev/null || true`)
		if err != nil {
			return nil, err
		}
		lines := strings.Fields(string(data))
		for _, line := range lines {
			if line == "installed" {
				state.Installed = true
			} else if line == "running" {
				state.Running = true
			} else if regexp.MustCompile(`^[0-9]+(?:\.[0-9]+){1,4}$`).MatchString(line) {
				state.Version = line
			}
		}
		return &state, nil
	}
	data, err := s.guestQuick(ctx, claudeDesktopSnapshot)
	if err != nil {
		return nil, err
	}
	if json.Unmarshal(data, &state) != nil {
		return nil, errors.New("The app state is invalid")
	}
	return &state, nil
}
