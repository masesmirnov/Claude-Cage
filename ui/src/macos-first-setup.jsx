import React, { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import { useAccount } from "./account";
import { MacOSLogin } from "./macos-login";
import { DiagnosticSettings } from "./diagnostics.jsx";
import { Modal } from "./modal";
import "./initialization.css";

const steps = [
  { id: "screen", label: "Screen recording", hint: "Turn on the screen recording switch for Cage Guest Window. If prompted to quit and reopen, follow the prompt." },
  { id: "input", label: "Accessibility", hint: "Turn on the accessibility switch for Cage Guest Window so Cage can control guest windows." },
  { id: "projects", label: "File system extension", hint: "Turn on both the macFUSE and macFUSE (local) switches so the guest can access the projects you choose." },
];

export function MacOSFirstSetup() {
  const { account, refresh } = useAccount();
  const [permissionPage, setPermissionPage] = useState("screen");
  const [state, setState] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [completionFailed, setCompletionFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [details, setDetails] = useState(false);
  const current = useRef({ account, refresh });
  current.current = { account, refresh };
  const control = useRef({ active: false, inFlight: false, started: false, finished: false, requested: "", pending: "" });

  async function request(action) {
    const lifecycle = action === "start" || action === "stop";
    const signal = AbortSignal.timeout(action === "finish" ? 60000 : 30000);
    let result;
    try {
      result = await api(lifecycle ? `/${action}` : "/macos/first-setup", action === "start" ? { guest_system: "macos" } : action === "stop" ? {} : { action }, undefined, {}, { signal });
    } catch (e) {
      if (signal.aborted) throw new Error("Timed out waiting for the guest to respond. Check the status again and confirm whether the last action finished before continuing.");
      // A finish response can be lost after the server has closed this entry.
      if (e.status === 410) await current.current.refresh();
      throw e;
    }
    if (result.error) throw new Error(result.error);
    return result;
  }

  // Automatic probes, page changes and explicit retries share one operation slot.
  // A failed probe retains the previous display but cannot advance the workflow.
  async function check() {
    const c = control.current;
    if (c.inFlight || !c.active) return;
    c.inFlight = true;
    setBusy(true);
    try {
      const next = await api("/status", undefined, undefined, {}, { signal: AbortSignal.timeout(15000) });
      if (!c.active) return;
      setState(next);
      const credentialsPending = current.current.account.macos_password_pending;
      if ((!next.vm_running || credentialsPending) && !next.job?.running && !next.job?.error && !next.job?.canceled && !c.started) {
        c.started = true;
        setBusy(true);
        try { await request("start"); }
        catch (e) { if (c.active) setError(e.message); }
        return;
      }
      if (!next.ready || next.job?.running || credentialsPending) { setReadError(""); return; }
      const measured = await request("permissions");
      if (!c.active) return;
      setReadError("");
      setPermissions(measured);
      const pending = steps.find(({ id }) => !measured[id]);
      if (pending && c.pending !== pending.id) {
        c.pending = pending.id;
        setPermissionPage(pending.id);
      }
      if (measured.managed_credential && pending && c.requested !== pending.id) {
        c.requested = pending.id;
        setPermissionPage(pending.id);
        setBusy(true);
        try { await request(pending.id); setError(""); }
        catch (e) { if (c.active) setError(e.message); }
      }
      if (!pending && !c.finished) {
        c.finished = true;
        setBusy(true);
        try { await request("finish"); if (c.active) await current.current.refresh(); }
        catch (e) { if (c.active) { setCompletionFailed(true); setError(e.message); } }
      }
    } catch (e) { if (c.active) setReadError(e.name === "TimeoutError" ? "Timed out reading the guest status. Check the status again; the installation progress so far is kept." : e.message); }
    finally { c.inFlight = false; if (c.active) setBusy(false); }
  }

  useEffect(() => {
    const c = control.current;
    c.active = true;
    let timer;
    async function poll() {
      await check();
      if (c.active) timer = setTimeout(poll, 2000);
    }
    poll();
    window.cageWorkbenchAction = async command => {
      if (command === "closeTab") document.dispatchEvent(new Event("cage-close-modal"));
      if (command === "quit") await native("quitNow");
    };
    window.cageEditAction = () => false;
    if (nativeAvailable()) native("workbenchReady").catch(() => {});
    return () => { c.active = false; clearTimeout(timer); delete window.cageWorkbenchAction; delete window.cageEditAction; };
  }, []);

  async function act(action) {
    const c = control.current;
    if (c.inFlight) return;
    c.inFlight = true;
    if (action === "stop") c.started = true;
    if (steps.some(({ id }) => id === action)) { setPermissionPage(action); c.requested = action; }
    setBusy(true); setError("");
    try {
      await request(action);
      if (action === "finish") { await current.current.refresh(); setCompletionFailed(false); }
    } catch (e) {
      if (action === "finish") setCompletionFailed(true);
      setError(e.message);
    } finally { c.inFlight = false; if (c.active) { setBusy(false); void check(); } }
  }

  const pending = steps.find(({ id }) => !permissions[id]);
  const selected = steps.find(({ id }) => id === permissionPage);
  const running = Boolean(state?.job?.running);
  const canOperate = Boolean(state?.vm_running && !running && !busy);
  const canFinish = Boolean(state?.ready && !account.macos_password_pending && !pending && !readError);
  const progress = !state ? "Reading the installation progress…" : running ? state.job.message || "Starting and configuring the virtual Mac…" :
    account.macos_password_pending ? "The guest password has not synced yet. Retry the sync, then continue authorization." : !state.vm_running ? "The virtual Mac is not started; you can continue from the existing disk." :
    !state.ready ? "The virtual Mac has started and is waiting for the guest connection. If it is stuck at the sign-in screen, open the guest view and finish signing in." :
    readError ? "The permission status cannot be confirmed right now; the results shown are for reference. Checking continues once the connection is back." :
    pending ? `Confirm "${pending.label}" now. Cage checks automatically and continues when you are done.` :
    completionFailed ? "All three permissions are verified, but the final setup step was not completed. Retry finishing setup." : "All three permissions are verified and setup is being saved; workspace authorization and the network checks follow.";
  const controls = <button type="button" className="primary" disabled={!canOperate} onClick={() => act(pending?.id || permissionPage)}>
    {busy ? "Working…" : `Open ${pending?.label || selected.label} settings`}
  </button>;
  const failure = error || readError || (!running && state?.job?.error) || (!state?.ready && state?.environment_update_error);

  return <main className="initialization"><section className="initialization-content mac-setup-content">
    <div className="initialization-title"><p className="mac-setup-eyebrow">Install and check · macOS permissions</p><h1>Finish the virtual Mac's system authorizations</h1>
      <p>The installation files and guest disk are kept. The three authorizations below are completed inside the virtual Mac, and setup continues automatically after each one is verified.</p></div>
    <ol className="mac-setup-checklist" aria-label="System authorization progress">
      {steps.map(({ id, label }, index) => <li key={id} data-complete={Boolean(permissions[id])} aria-current={pending?.id === id ? "step" : undefined}>
        <span className="mac-setup-marker">{permissions[id] ? <Check size={16} aria-hidden="true" /> : index + 1}</span>
        <span>{label}</span><small>{permissions[id] ? "Verified" : pending?.id === id ? "Waiting for confirmation" : "Confirm later"}</small>
      </li>)}
    </ol>
    <section className="initialization-operation mac-setup-task" aria-label="Current setup step">
      <h2>{!state?.ready ? "Connect the virtual Mac" : pending ? `Confirm: ${pending.label}` : "Finish system setup"}</h2>
      <p role="status">{busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />} {progress}</p>
      {pending && state?.ready && <><p>{selected.hint}</p>{pending.id === "projects" && permissions.projects_error && <p>{permissions.projects_error}</p>}</>}
      <div className="initialization-recovery">
        {state && !running && (!state.ready || account.macos_password_pending || state.job?.error) && <button className="primary" disabled={busy} onClick={() => act("start")}>{account.macos_password_pending ? "Retry syncing the guest password" : "Continue starting and connecting"}</button>}
        {pending && state?.ready && controls}
        {completionFailed && <button className="primary" disabled={busy || !canFinish} onClick={() => act("finish")}>Retry finishing setup</button>}
        <button disabled={busy || running} onClick={() => void check()}>Check status again</button>
      </div>
      {running && <button disabled={busy} onClick={() => act("stop")}>Stop the current operation and keep progress</button>}
      {state?.vm_running && <MacOSLogin initialSetup autoOpen={Boolean(permissions.managed_credential)} managedCredential={permissions.managed_credential} disabled={!canOperate}
        label="Open the guest view" setupActions={controls} setupHint={`${selected.hint} When the system asks for an administrator, enter cagesetup as the username; after selecting the password field, click "Fill in authorization password".`}
        setupStatus={failure || progress} setupError={Boolean(failure)} />}
    </section>
    {failure && <section className="initialization-notice" role="alert"><h2>This step is not completed</h2><p>{failure}</p><p>The installation progress so far is kept. You can reopen the current setup page, or check the status again and continue.</p></section>}
    <details className="mac-setup-help"><summary>Help with the administrator password and finding the settings page</summary>
      <p>When the system asks for an administrator, enter <strong>cagesetup</strong> as the username, {account.macos_password_pending ? "and the original guest password may still be needed until the password sync finishes." : account.macos_credentials_ready ? "and the password is the same as your Cage account." : "select the password field in the guest view, then click \"Fill in authorization password\"."} Continue after you confirm the authorization; this temporary administrator is disabled at the end of setup.</p>
      <p>Manual entry for the file system extension: in the guest, System Settings → General → Login Items &amp; Extensions → By Category → File System Extensions, then turn on both macFUSE and macFUSE (local).</p>
      <div className="initialization-recovery">{steps.map(({ id, label }) => <button key={id} disabled={!canOperate} onClick={() => act(id)}>Reopen {label} settings</button>)}</div>
    </details>
    <p className="mac-setup-retention">After the system authorizations, Cage also confirms the shared workspace and network isolation. Once all checks pass you can enter the workbench.</p>
    <div className="initialization-support"><button className="text-button" onClick={() => setDetails(true)}>View operation details</button><button className="text-button" onClick={() => setDiagnostics(!diagnostics)}>Logs and diagnostics</button></div>
    {diagnostics && <DiagnosticSettings />}
    {details && <Modal title="System setup operation details" onClose={() => setDetails(false)}><div className="modal-body"><p>{progress}</p>{failure && <p role="alert">{failure}</p>}<pre className="job-log">{state?.job?.log || "The current step has no additional operation log. Export the full record from Logs and diagnostics."}</pre></div></Modal>}
  </section></main>;
}
