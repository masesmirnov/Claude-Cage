import React, { useEffect, useRef, useState } from "react";
import { api, native } from "./api";
import { InlineSelect } from "./inline-select";
import "./guest-system-picker.css";

const names = { "debian-12": "Debian 12", "debian-13": "Debian 13", "ubuntu-22.04": "Ubuntu 22.04", "ubuntu-24.04": "Ubuntu 24.04", macos: "macOS", "windows-11": "Windows 11" };
const editions = { Professional: "Pro", ProfessionalN: "Pro N", Enterprise: "Enterprise", EnterpriseN: "Enterprise N", Education: "Education", EducationN: "Education N", Core: "Home", CoreSingleLanguage: "Home Single Language" };
const languages = { "zh-CN": "Chinese (Simplified)", "zh-TW": "Chinese (Traditional)", "en-US": "English (US)" };

export function HostCloneSummary({ pending, onChange }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    api("/environment/guest-systems/clone").then((next) => {
      if (!active) return;
      setResult(next);
      onChange((current) => current?.clone ? { ...current, clone_key: next.key, clone_ready: next.enough_space } : current);
    }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [attempt, onChange]);
  if (error) return <div className="guest-install-fields" role="alert"><small>{error}</small>
    <button type="button" onClick={() => { setError(""); retry((value) => value + 1); }}>Detect and match again</button></div>;
  if (!result) return <small className="guest-install-fields" role="status">Detecting this computer's system version and matching an official image…</small>;
  const plan = result.plan;
  const host = plan.host;
  const download = result.download_bytes > 0 ? `${(result.download_bytes / 1e9).toFixed(2)} GB` : "";
  const source = host.system === "macos" ? "Apple" : host.system === "windows-11" ? "Microsoft" : "the distribution's official source";
  const cached = Boolean(plan.path || result.download_bytes === 0 && plan.bytes > 0);
  return <div className="guest-install-fields host-clone-summary" aria-live="polite">
    <strong>Will install: {names[host.system]} {host.system === "windows-11" ? `${host.version} · ${editions[host.edition] || host.edition} · ${languages[host.language] || host.language}` : host.system === "macos" ? host.version : ""}</strong>
    <small>{pending ? "Keeping the system image chosen first and continuing to install the separate guest." : "Matches an official image to this computer's system version and installs it in a separate guest."}</small>
    {host.build && <small>{pending ? "Local build detected first" : "Local build"} {host.build} · Image build {plan.build}</small>}
    {host.system === "windows-11" && host.build !== plan.build && <small>The Windows release, edition and language match this computer; the patch level differs.</small>}
    <small>Apps, personal files and sign-in state on this computer are not copied; tools, accounts and files in the guest are kept.</small>
    <small>{cached ? "A matching local image was found. It is verified and used directly, with no need to download the system image again." : `Downloads the official system image from ${source}; ${download ? `about ${download} still to download` : "the download size shows once connected"}.`}</small>
    <small>{result.installation_started ? "Keeps using the original virtual disk and the installation progress so far." : `Needs at least ${result.minimum_free_gib} GiB of free space; the virtual disk grows with actual use.`} Workbench components such as the browser and editor download on demand.</small>
    {!result.enough_space && <small role="alert">Only {result.free_gib} GiB is free. Choose a location with enough space in storage settings, then check again.</small>}
    {!pending && <button type="button" onClick={() => {
      setResult(null);
      onChange((current) => current?.clone ? { ...current, clone_key: "", clone_ready: false } : current);
      retry((value) => value + 1);
    }}>Detect and match again</button>}
  </div>;
}

export function GuestSystemPicker({ system, onChange, preserveOnUnmount = false, deferMatch = false }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const activated = useRef(false);
  useEffect(() => {
    if (!system?.activate || activated.current) return;
    activated.current = true;
    api("/environment/guest-systems/activate",{}).then(() => native("reconnect")).catch(e => setError(e.message));
  }, [system?.activate]);
  useEffect(() => {
    let active = true;
    setError("");
    api("/environment/guest-systems").then((next) => {
      if (!active) return;
      setView(next);
      if (next.fresh || next.pending) {
        onChange(current => !next.pending && current && !current.pending ? current : ({ guest_system: next.pending?.system || "debian-13", media: next.pending?.media || "",
          sha256: next.pending?.sha256 || "", editor_terms: Boolean(next.pending?.editor_terms),
          clone: Boolean(next.pending?.source && !next.pending?.source_kind), clone_key: "", clone_ready: false,
          activate: next.activate, pending: Boolean(next.pending) }));
      } else onChange(null);
    }).catch((e) => {
      if (!active) return;
      if (e.status === 403 || e.status === 404) onChange(null);
      else setError(e.message);
    });
    return () => { active = false; if (!preserveOnUnmount) onChange(undefined); };
  }, [onChange, attempt, preserveOnUnmount]);
  if (!view || !system) return error ? <div className="guest-system-picker"><span role="alert">{error}</span>
    <button type="button" onClick={() => retry((n) => n + 1)}>Check install options again</button></div> : null;
  const os = system.guest_system;
  const change = (changes) => onChange((current) => current?.guest_system === os ? { ...current, ...changes } : current);
  async function choose() {
    try {
      const path = await native("chooseGuestMedia");
      if (path) change({ media: path });
    } catch (e) { setError(e.message); }
  }
  async function reference(kind) {
    try { await native("guestInstallReference", { kind }); }
    catch (e) { setError(e.message); }
  }
  return (
    <div className="guest-system-picker">
      <span>Guest system</span>
      <InlineSelect aria-label="Guest system" value={system.clone ? "host" : os} disabled={system.pending}
        onValueChange={(value) => onChange({ guest_system: value === "host" ? view.system : value, clone: value === "host", clone_key: "", clone_ready: false, media: "", sha256: "", editor_terms: false })}>
        {Boolean(view.system) && <option value="host" disabled={!view.available}>Match this computer's system version automatically{view.available ? "" : " (unavailable)"}</option>}
        <option value="debian-13">Debian 13</option>
        <option value="ubuntu-22.04" disabled={!view.linux_systems?.includes("ubuntu-22.04")}>Ubuntu 22.04{view.linux_systems?.includes("ubuntu-22.04") ? "" : " (unavailable in this build)"}</option>
        <option value="macos" disabled={view.system !== "macos" || !view.available}>macOS{view.system === "macos" ? view.available ? "" : " (unavailable)" : " (requires an Apple Silicon Mac)"}</option>
        <option value="windows-11" disabled={view.system !== "windows-11" || !view.available}>Windows 11{view.system === "windows-11" ? view.available ? "" : " (unavailable)" : " (requires Windows 11 and Hyper-V)"}</option>
      </InlineSelect>
      {system.clone && !system.activate && (deferMatch ? <small className="guest-install-fields">Cage will detect this computer's system version and show the matching official image, download size and space requirements in the next step.</small> : <HostCloneSummary pending={system.pending} onChange={onChange} />)}
      {!system.activate && <small className="guest-install-fields">The system image downloads over the host network and follows the host's system proxy or TUN settings, not the Cage guest proxy. If you use software such as Clash, turn on the system proxy or TUN first; its proxy rules decide the actual exit for the image site.</small>}
      {!system.clone && os !== "debian-13" && !system.activate && <div className="guest-install-fields">
        {os === "ubuntu-22.04" ? <>
          <small>Downloads the Ubuntu 22.04 LTS image from Ubuntu's official source and verifies its SHA-256. Cage picks ARM64 or x86_64 to match the host architecture.</small>
          <small>Development tools, the browser and the editor are installed automatically. The guest account, files and sign-in state are kept on a separate persistent virtual disk.</small>
          <small>Needs at least 17 GiB of free space. After a failure you can resume the original installation; it never switches to another system or overwrites an existing environment.</small>
        </> : os === "macos" ? <>
          <small>{system.media || "Downloads macOS 26.5.2 (19.77 GB) from Apple and creates a 64 GiB sparse virtual disk."}</small>
          {!system.pending && <div>
            <button type="button" onClick={choose}>Choose a local IPSW</button>
            {system.media && <button type="button" onClick={() => change({ media: "" })}>Download instead</button>}
          </div>}
          <small>Cage prepares the guest account and a separate password automatically, stores them encrypted, and signs in automatically at startup.</small>
        </> : <>
          <small>Windows 11 x64 needs Hyper-V and at least 64 GiB of free disk space. Before installing, set the guest's local administrator in the authorization window, and Cage generates an offline account answer file. Once you reach the guest desktop, return to Cage and continue, using that account to confirm the component installation. Cage then creates a dedicated standard account and restarts the guest.</small>
          {!system.pending && <div>
            <button type="button" onClick={() => reference("windows-media")}>Download the ISO from Microsoft</button>
            <button type="button" onClick={choose}>Choose a local ISO</button>
          </div>}
          {system.media && <small>{system.media}</small>}
          <label>ISO SHA-256<input value={system.sha256} readOnly={system.pending} spellCheck={false}
            onChange={(e) => change({ sha256: e.target.value.trim() })} placeholder="The 64-digit hex digest published by Microsoft" /></label>
          <button type="button" onClick={() => reference("editor-license")}>Read the Microsoft VS Code Server license terms</button>
          <label><input type="checkbox" checked={system.editor_terms} disabled={system.pending}
            onChange={(e) => change({ editor_terms: e.target.checked })} />I accept the editor license terms above</label>
        </>}
      </div>}
      {system.clone && os === "windows-11" && <div className="guest-install-fields">
        <small>You will need to confirm Windows administrator authorization during installation. Cage then installs the system automatically and creates a separate guest account.</small>
        <button type="button" onClick={() => reference("editor-license")}>Read the Microsoft VS Code Server license terms</button>
        <label><input type="checkbox" checked={system.editor_terms} disabled={system.pending}
          onChange={(e) => change({ editor_terms: e.target.checked })} />I accept the editor license terms above</label>
      </div>}
      {view.reason && !view.available && <small className="guest-install-fields">{view.reason}</small>}
      {view.reselect && <button type="button" className="guest-install-fields" onClick={async () => {
        try {
          await api("/environment/guest-systems", { id: view.pending.id }, "DELETE");
          setView(await api("/environment/guest-systems"));
          onChange({ guest_system: "debian-13", media: "", sha256: "", editor_terms: false });
        } catch (e) { setError(e.message); }
      }}>Choose a different system or image</button>}
      {system.activate && <small className="guest-install-fields">The guest is installed and the workbench can be opened.</small>}
      {error && <p role="alert" className="guest-install-fields">{error}</p>}
    </div>
  );
}

export function validGuestChoice(value) {
  if (value?.clone && !value.activate) return Boolean(value.clone_key && value.clone_ready && (value.guest_system !== "windows-11" || value.editor_terms));
  if (!value || value.activate || value.guest_system === "debian-13" || value.guest_system === "ubuntu-22.04") return true;
  if (value.guest_system === "macos") return true;
  return value.media && /^[a-f\d]{64}$/i.test(value.sha256) && value.editor_terms;
}
