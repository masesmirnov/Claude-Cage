import React, { useEffect, useState } from "react";
import { api } from "./api";
import { SafetyMessage } from "./safety-message";

const gib = (bytes) => `${(bytes / 1073741824).toFixed(1)} GiB`;
const allocationFrom = (data) => ({ automatic: data.automatic, memory_gib: data.memory_gib, cpus: data.cpus });

export function ResourceSettings({ status, onConfirm, onDirtyChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [starting, setStarting] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data && data.runtime !== "container") setDraft((current) => current || allocationFrom(data));
  }, [data]);
  const save = async (event) => {
    event.preventDefault();
    setStarting(true);
    setSaved(false);
    try {
      await api("/environment/resources", { allocation: draft });
      const next = await api("/environment/resources");
      setData(next);
      setDraft(allocationFrom(next));
      setSaved(true);
      setError("");
    } catch (e) { setError(e.message); }
    finally { setStarting(false); }
  };
  useEffect(() => {
    let live = true;
    let timer;
    const refresh = async () => {
      try {
        const next = await api("/environment/resources");
        if (live) { setData(next); setReadError(""); }
      } catch (e) { if (live) setReadError(e.message); }
      if (live) timer = setTimeout(refresh, 4000);
    };
    refresh();
    return () => { live = false; clearTimeout(timer); };
  }, [status.vm_running, status.job?.running]);
  const apply = async () => {
    if (!(await onConfirm({
      title: "Restart and apply the saved resource settings?",
      body: "Running commands will end, and the browser and editor will restart. Save your work first; project files and sign-in data are kept. Manually paused internet access stays paused.",
      confirm: "Restart and apply",
    }))) return;
    setStarting(true);
    try { await api("/environment/resources", {}); setError(""); }
    catch (e) { setError(e.message); }
    finally { setStarting(false); }
  };
  const observation = data?.observation;
  const guest = observation?.guest;
  const macOS = data?.runtime === "vz-macos";
  const fresh = observation && Date.now() - Date.parse(observation.observed_at) < 10000;
  const resourceError = error || readError || data?.resource_error;
  const resourcesVerified = data?.resources_verified === true && !resourceError;
  const busy = starting || status.job?.running;
  const dirty = draft && data && (draft.automatic !== data.automatic || (!draft.automatic && (draft.memory_gib !== data.memory_gib || draft.cpus !== data.cpus)));
  useEffect(() => {
    onDirtyChange?.(Boolean(dirty));
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const edit = (key, value) => {
    setDraft((current) => ({ ...current, automatic: false, [key]: value === "" ? "" : Number(value) }));
    setSaved(false);
  };
  const reset = () => {
    setDraft({ automatic: true, memory_gib: data.recommended_memory_bytes / 1073741824, cpus: data.recommended_cpus });
    setSaved(false);
    setError("");
  };
  if (data?.runtime === "container") return <section className="environment-versions" aria-label="Compute resources">
    <h4>Server container resource limits</h4>
    <p className="field-help">CPU, memory and process counts are limited by the container's resource group on the server.</p>
    <div className="setting-summary-row"><span>Resource limit verification</span><strong>{data.running ? resourcesVerified ? "Verified" : "Failed verification" : "Environment not running"}</strong></div>
    <div className="setting-summary-row"><span>Container memory limit</span><strong>{data.running ? resourcesVerified ? gib(data.configured_memory_bytes) : "Not verified" : gib(data.recommended_memory_bytes)}</strong></div>
    <div className="setting-summary-row"><span>Container CPU limit</span><strong>{data.running ? resourcesVerified ? `${data.configured_cpus} logical cores` : "Not verified" : `${data.recommended_cpus} logical cores`}</strong></div>
    <div className="setting-summary-row"><span>Total process and thread limit</span><strong>{data.running ? resourcesVerified ? data.pids_limit : "Not verified" : "Verified after start"}</strong></div>
    <p className="field-help">{data.running ? resourcesVerified ? "The actual limits of the container's resource group were verified on the server. Live memory and CPU usage are not available yet." : "The actual resource limits of the running container cannot be confirmed. See the error below or wait for the next verification." : "The environment is not running, so the resource limits from the deployment configuration are shown."}</p>
    {resourceError && <p role="alert" className="error-message"><SafetyMessage message={resourceError} /></p>}
  </section>;
  return <section className="environment-versions resource-settings" aria-label="Compute resources">
    <h4>Compute resources</h4>
    <p className="field-help resource-intro">Half of the host's resources are used by default; adjust them below. {macOS ? "The macOS guest uses a fixed startup memory size." : "Memory is used on demand and gradually returned to the host after staying idle."} CPU is used as tasks need it.</p>
    {draft ? <form className="resource-allocation" onSubmit={save}>
      <fieldset disabled={busy} className="resource-fields">
        <legend className="sr-only">Resource settings</legend>
        <label><span>Memory {macOS ? "size" : "limit"}</span>
          <span className="resource-input"><input aria-label="Memory limit (GiB)" aria-describedby="resource-memory-help" type="number" min={data.min_memory_gib || 2} max={data.max_memory_gib} step="1" required value={draft.memory_gib} onChange={(e) => edit("memory_gib", e.target.value)} /><span aria-hidden="true">GiB</span></span>
          <small id="resource-memory-help">Default {gib(data.recommended_memory_bytes)} · Adjustable {data.min_memory_gib || 2}–{data.max_memory_gib} GiB</small>
        </label>
        <label><span>CPU limit</span>
          <span className="resource-input"><input aria-label="Number of CPU logical cores" aria-describedby="resource-cpu-help" type="number" min={data.min_cpus || 1} max={data.max_cpus} step="1" required value={draft.cpus} onChange={(e) => edit("cpus", e.target.value)} /><span aria-hidden="true">logical cores</span></span>
          <small id="resource-cpu-help">Default {data.recommended_cpus} · Adjustable {data.min_cpus || 1}–{data.max_cpus}</small>
        </label>
      </fieldset>
      <div className="resource-actions">
        <span className="resource-mode">{draft.automatic ? "Default settings" : "Custom settings"}{dirty ? " · Unsaved" : ""}</span>
        <button className="text-button" type="button" disabled={busy || draft.automatic} onClick={reset}>Restore default</button>
        <button type="submit" disabled={busy || !dirty}>{starting ? "Saving…" : "Save resource settings"}</button>
      </div>
      <p role={saved ? "status" : undefined} className="field-help resource-save-note">{saved ? "Saved; " : "Once saved, "}{data.running ? "it takes effect after the environment restarts." : "it takes effect the next time the environment starts."}</p>
    </form> : !resourceError && <p role="status" className="field-help">Reading the resource settings…</p>}
    {macOS && data.minimum_requirements?.source === "existing-configuration" && <p className="field-help resource-minimum-note">The current minimum carries over from the existing startup configuration. Apple's minimum requirements have not been read back from the original recovery image yet.</p>}
    {data?.running && <div className="resource-runtime">
      <div className="resource-runtime-heading"><h5>Currently running</h5>{data.restart_required && <button className="text-button" disabled={busy} onClick={apply}>Restart and apply the saved settings</button>}</div>
      <div className="setting-summary-row"><span>Memory limit for this start</span><strong>{gib(data.configured_memory_bytes)}</strong></div>
      <div className="setting-summary-row"><span>CPU limit for this start</span><strong>{data.configured_cpus} logical cores</strong></div>
      <div className="setting-summary-row"><span>{macOS ? "Environment memory usage (estimated)" : "Environment memory usage"}</span><strong>{fresh && guest ? gib(guest.total_bytes - guest.available_bytes) : "Waiting for a sample"}</strong></div>
      <div className="setting-summary-row"><span>{macOS ? "Guest physical memory size" : "Total memory currently available to the environment"}</span><strong>{fresh && guest ? gib(guest.total_bytes) : "—"}</strong></div>
      <div className="setting-summary-row"><span>CPU usage</span><strong>{fresh && Number.isFinite(observation.cpu_percent) ? `${observation.cpu_percent.toFixed(0)}% / ${observation.cpus} cores` : "Waiting for a sample"}</strong></div>
      {fresh && guest?.oom_kills > 0 && <p className="field-help" role="status">Since this environment started, the system has killed {guest.oom_kills} {guest.oom_kills === 1 ? "process" : "processes"} for lack of memory. Run fewer heavy tasks in parallel, or use a host with more memory.</p>}
      {(observation?.pressure || observation?.host_pressure) && <p className="field-help" role="status">{macOS ? "Guest memory pressure is high. Run fewer parallel tasks, or save your work, raise the memory limit and restart." : observation.host_pressure ? "Host memory is tight, so further allocation is on hold." : "Environment memory is tight, and available memory is being increased within the limit. Once the limit is reached, run fewer tasks at the same time."}</p>}
    </div>}
    {(resourceError || observation?.error) && <p role="alert" className="error-message"><SafetyMessage message={resourceError || observation.error} /></p>}
    {data?.running && <details className="resource-observation-note"><summary>About the resource statistics</summary><p className="field-help">{macOS ? "The memory estimate is the guest's physical size minus free and inactive pages, with compressed pages counted as used. CPU comes from two consecutive Mach counter samples. OOM kill counts are not available yet. The host system monitor also counts virtualization overhead." : data.runtime === "hyperv" ? "Memory and CPU usage come from system observations of the Windows guest. Hyper-V allocates and reclaims memory between the configured lower and upper limits; the host system monitor also counts virtualization overhead." : "Memory usage excludes reclaimable cache; these values reflect the state inside the environment, and the host system monitor also counts virtualization overhead."}</p></details>}
  </section>;
}
