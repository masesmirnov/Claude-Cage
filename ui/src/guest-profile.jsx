import React, { useEffect, useState } from "react";
import { api } from "./api";
import { InlineSelect } from "./inline-select";
import { SafetyMessage } from "./safety-message";

const textFields = [
  ["hostname", "Host name", "Leave empty for a random PC name", 15],
  ["username", "Linux work account", "Leave empty to generate at random", 24],
  ["work_home", "Work account home folder", "Leave empty to use /home/<work account>", 69],
  ["browser_username", "Linux browser account", "Leave empty to generate at random; must differ from the work account", 24],
  ["browser_home", "Browser account home folder", "Leave empty to use /home/<browser account>", 69],
  ["extension_name", "Linux control extension name", "Leave empty to choose at random", 64],
];
const dimensions = [["display", "Linux virtual display"], ["browser", "Initial browser window"]];

const nativeFields = new Set(["hostname", "browser_width", "browser_height", "webgl", "canvas", "graphics_backend"]);
const backendSystems = { metal: "macos", d3d11: "windows-11", vulkan: "linux" };

export function guestOptionsForSystem(input, system) {
  const native = system === "macos" || system === "windows-11";
  const options = native
    ? Object.fromEntries(Object.entries(input).filter(([key]) => nativeFields.has(key)))
    : { ...input };
  const required = backendSystems[options.graphics_backend];
  if (required && required !== (native ? system : "linux")) delete options.graphics_backend;
  return options;
}

export function GuestProfileOptions({ value, onChange, disabled, system }) {
  const [saved, setSaved] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [editable, setEditable] = useState(false);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [capabilities, setCapabilities] = useState(null);
  useEffect(() => {
    let live = true;
    api("/environment/guest-profile").then(result => {
      if (!live) return;
      setSaved(result.profile); setEditable(result.editable); setLoaded(true);
      setCapabilities(result);
      if (!result.editable) onChange(null);
    }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [onChange]);
  const native = system === "macos" || system === "windows-11";
  const options = guestOptionsForSystem(saved || value || {}, system);
  const locked = disabled || !editable || generating;
  const set = (key, next) => {
    const updated = { ...(value || {}), [key]: next };
    if (key === "webgl" && next === "disabled") updated.graphics_backend = "auto";
    if (key === "gpu_backend" && next === "virgl" && updated.graphics_backend === "vulkan") updated.graphics_backend = "opengl";
    onChange(updated);
  };
  async function randomize() {
    setGenerating(true); setError("");
    try {
      const preview = await api("/environment/guest-profile/preview", { webgl: options.webgl || "native", canvas: options.canvas || "native", graphics_backend: options.graphics_backend || "auto", gpu_backend: options.gpu_backend || "default" });
      onChange(guestOptionsForSystem(preview, system));
    }
    catch (error) { setError(error.message); }
    finally { setGenerating(false); }
  }
  return <details className="guest-profile-options"><summary>Guest names and initial device configuration</summary>
    <p>Choose names that are natural, easy to remember and different from your previous environment identities. You can enter the user names, home folders, host name and sizes yourself; empty fields get a set of initial values that stay the same across restarts.</p>
    {error && <p role="alert"><SafetyMessage message={error} /></p>}
    {loaded && !editable && <p>{saved ? "The creation settings of this environment are saved, and continuing the installation reuses the settings below." : "Existing environments keep their original settings; these options are for creating a separate new environment."}</p>}
    {loaded && (editable || saved) && <fieldset disabled={locked}>
      {textFields.filter(([key]) => !native || key === "hostname").map(([key, label, placeholder, maxLength]) => <label key={key}>{label}<input value={options[key] || ""} maxLength={maxLength} placeholder={placeholder} onChange={event => set(key, event.target.value)} autoComplete="off" /></label>)}
      {dimensions.filter(([key]) => !native || key === "browser").map(([key, label]) => <label key={key}>{label}<span className="guest-profile-size">{["width", "height"].map((axis, i) => <React.Fragment key={axis}>{i > 0 && " × "}<input type="number" min={i ? 600 : 800} max={i ? 2160 : 3840} placeholder={i ? "Height (random)" : "Width (random)"} value={options[`${key}_${axis}`] || ""} onChange={event => set(`${key}_${axis}`, event.target.value === "" ? 0 : Number(event.target.value))} /></React.Fragment>)}</span></label>)}
      {!native && <label>Audio device (real model chosen automatically)<output>{options.audio_description || `Chosen at random from ${capabilities?.audio_models?.length || 12} models at creation`}</output><small>The model name and device ID stay matched; the random suffix only identifies this environment.</small></label>}
      <label>Browser identity<output>Follows the browser actually installed, keeping the UA and Client Hints consistent</output></label>
      <label>Graphics rendering backend<InlineSelect inline aria-label="Graphics rendering backend" value={options.graphics_backend || "auto"} onValueChange={value => set("graphics_backend", value)} disabled={locked || options.webgl === "disabled"}><option value="auto">Use the devices available in the guest automatically</option>{system === "macos" && <option value="metal">ANGLE / Metal</option>}{system === "windows-11" && <option value="d3d11">ANGLE / D3D11</option>}{!native && <option value="vulkan" disabled={options.gpu_backend === "virgl"}>ANGLE / Vulkan (needs driver support, not for VirGL)</option>}<option value="opengl">ANGLE / OpenGL</option><option value="software">SwiftShader software compatibility mode</option></InlineSelect></label>
      {!native && capabilities?.host_os === "linux" && !capabilities.container && <label>Virtual GPU<InlineSelect inline aria-label="Virtual GPU" value={options.gpu_backend || "default"} onValueChange={value => set("gpu_backend", value)}><option value="default">Use the existing virtual device</option><option value="virgl">QEMU VirGL + DRI3 (experimental, needs a host GPU)</option></InlineSelect></label>}
      <label>WebGL<InlineSelect inline aria-label="WebGL" value={options.webgl || "native"} onValueChange={value => set("webgl", value)}><option value="native">Use the guest's native graphics capabilities</option><option value="disabled">Turn off web 3D graphics</option></InlineSelect></label>
      <label>Canvas image reading<InlineSelect inline aria-label="Canvas image reading" value={options.canvas || "native"} onValueChange={value => set("canvas", value)}><option value="native">Allow web pages to read Canvas images</option><option value="blocked">Block web pages from reading Canvas images</option></InlineSelect></label>
      <p>The backend name shows the actual rendering path; whether hardware acceleration is used must be verified in the environment checks. Turning off WebGL or blocking Canvas reading affects some sites; these options do not replace the graphics card model reported by the real driver.</p>
      <button type="button" onClick={randomize}>{generating ? "Generating…" : "Generate names and sizes at random again"}</button>
    </fieldset>}
  </details>;
}
