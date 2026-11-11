import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, LoaderCircle, ShieldCheck } from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import { isRemoteClient } from "./client-context.mjs";
import { MacOSAccountGate, useAccount } from "./account";
import { GuestSystemPicker, HostCloneSummary, validGuestChoice } from "./guest-system-picker";
import { InitializationStorage } from "./initialization-storage";
import { ProxySettings } from "./proxy-settings";
import { SetupProgress } from "./setup-progress";
import { DiagnosticSettings } from "./diagnostics.jsx";
import { MacOSFirstSetup } from "./macos-first-setup";
import { InitializationProjectApproval } from "./macos-project-approval";
import { InitializationChecks, InitializationDetails } from "./initialization-checks";
import { MacOSLogin } from "./macos-login";
import { Modal } from "./modal";
import { SafetyMessage } from "./safety-message";
import { bindDetectedMacOSExit } from "./safety";
import { needsProxySetup } from "./onboarding-state.mjs";
import { networkState } from "./safety-state.mjs";
import { useSSHNavigation } from "./remote-hosts";
import logo from "./logo.png";
import "./initialization.css";

const steps = [["system", "System and storage"], ["proxy", "Network proxy"], ["install", "Install and check"]];

function InitializationFrame({ children }) {
  return <main className="initialization"><header className="initialization-brand"><img src={logo} alt="" /><strong>Cage</strong><span>First-run setup</span></header>{children}</main>;
}

export function InitializationGate({ children }) {
  const { account } = useAccount();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const remote = isRemoteClient();
  useEffect(() => {
    if (remote) return;
    let live = true;
    setError("");
    (async () => {
      const next = await api("/environment/initialization");
      if (next.required && !next.tracked && !next.started && !account?.initial_mac_setup) await api("/environment/initialization", { action: "begin" });
      if (live) setState(next);
    })().catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [remote, attempt, account?.initial_mac_setup]);
  if (remote) return children;
  if (account?.initial_mac_setup) return <MacOSAccountGate><MacOSFirstSetup /></MacOSAccountGate>;
  if (error) return <InitializationFrame><section className="initialization-content"><h1>Continue preparing Cage</h1><p role="alert"><SafetyMessage message={error} /></p><button className="primary" onClick={() => retry(value => value + 1)}>Reconnect</button><DiagnosticSettings /></section></InitializationFrame>;
  if (!state) return <InitializationFrame><section className="initialization-content"><h1>Reading the environment status</h1><p role="status"><LoaderCircle size={18} className="spin" />Checking the existing configuration and installation progress…</p></section></InitializationFrame>;
  return state.required ? <MacOSAccountGate><Initialization initial={state} onComplete={() => setState({ required: false })} /></MacOSAccountGate> : children;
}

function Initialization({ initial, onComplete }) {
  const { account, refresh } = useAccount();
  const navigation = useSSHNavigation();
  const [step, setStep] = useState(initial.started || account?.guest_system ? "install" : "system");
  const [status, setStatus] = useState(null);
  const [proxy, setProxy] = useState(null);
  const [choice, setChoice] = useState(undefined);
  const [storage, setStorage] = useState(null);
  const [pending, setPending] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [git, setGit] = useState(null);
  const [details, setDetails] = useState(false);
  const [help, setHelp] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [approvalWorkspace, setApprovalWorkspace] = useState("");
  const [proxyDirty, setProxyDirty] = useState(false);
  const alive = useRef(true);
  const pollNow = useRef(null);
  const activation = useRef(false);
  const actionPending = useRef(false);
  const restored = useRef(false);
  const job = status?.job || {};
  const busy = submitting || Boolean(job.running);
  const network = networkState(status);
  const exitCandidate = status?.guest_system === "macos" && status.safety?.macos_exit_candidate?.ip;
  const needsExitRestart = status?.guest_system === "macos" && status.safety?.error === "Fixed exit saved. Restart the macOS guest, sign in, then run the checks again.";
  const ready = Boolean(status?.ready && status.vm_running && !busy && !job.error && !needsExitRestart && network.mode === "open");
  const confirm = options => new Promise(resolve => setDialog({ ...options, resolve }));
  const settleDialog = value => { dialog?.resolve(value); setDialog(null); };

  useEffect(() => {
    alive.current = true;
    let timer, polling = false;
    async function poll() {
      if (polling || !alive.current) return;
      clearTimeout(timer);
      polling = true;
      try {
        const next = await api("/status");
        if (!alive.current) return;
        setStatus(next);
        setConnectionError("");
        const results = await Promise.allSettled([
          api("/proxy"),
          account?.guest_system ? Promise.resolve(null) : api("/environment/guest-systems"),
        ]);
        if (!alive.current) return;
        if (results[0].status === "fulfilled") setProxy(results[0].value);
        else setConnectionError(results[0].reason.message);
        if (results[1].status === "fulfilled") {
          const install = results[1].value;
          setPending(install?.pending || null);
          if (!restored.current) {
            restored.current = true;
            if (initial.started && !initial.prepared && !account?.guest_system && !install?.pending && !next.job?.running && !next.job?.setup_progress && !next.ready) setStep("system");
          }
          if (install?.activate && !activation.current) {
            activation.current = true;
            setStep("install");
            try {
              await api("/environment/guest-systems/activate", {});
              await native("reconnect");
            } catch (error) {
              activation.current = false;
              if (alive.current) setError(error.message);
            }
          }
        } else setConnectionError(results[1].reason.message);
        if (next.job?.running && ["start", "guest-install", "safety"].includes(next.job.kind)) setStep("install");
      } catch (error) { if (alive.current) setConnectionError(error.message); }
      finally {
        polling = false;
        if (alive.current) timer = setTimeout(poll, 1200);
      }
    }
    pollNow.current = poll;
    poll();
    if (nativeAvailable()) native("workbenchReady").catch(() => {});
    window.cageWorkbenchAction = async action => { if (action === "quit") await native("quitNow"); };
    return () => { alive.current = false; clearTimeout(timer); pollNow.current = null; delete window.cageWorkbenchAction; };
  }, [account?.guest_system]);

  async function run(operation) {
    if (actionPending.current) return;
    actionPending.current = true;
    setSubmitting(true); setError("");
    try { await operation(); }
    catch (error) { if (alive.current) setError(error.message); }
    finally { actionPending.current = false; if (alive.current) { setSubmitting(false); pollNow.current?.(); } }
  }
  function startOptions() {
    if (account?.guest_system) return {};
    if (pending) return { guest_system: pending.system };
    if (!choice) return job.setup_progress?.system ? { guest_system: job.setup_progress.system } : {};
    return { guest_system: choice.guest_system, media: choice.media, sha256: choice.sha256, clone_key: choice.clone_key, editor_terms: choice.editor_terms };
  }
  async function install() {
    if (needsProxySetup(null, status, proxy)) { setError("Choose and apply a proxy node first."); setStep("proxy"); return; }
    await run(async () => {
      const check = await api("/host/git");
      if (!check.ready) { setGit(check); return; }
      await api("/environment/initialization", { action: "install" });
      const accepted = await api("/start", startOptions());
      if (!alive.current) return;
      setGit(null); setStep("install");
      setStatus(current => ({ ...current, job: { ...accepted, running: true, kind: accepted.kind || "start", message: accepted.message || "Preparing the guest environment…" } }));
    });
  }
  async function enableGit() {
    await run(async () => { const next = await api("/host/git", { confirm: true }); setGit(next.ready ? null : next); });
  }
  async function stop() {
    if (!await confirm({ title: "Stop the current installation?", body: "The installation progress, downloaded files and virtual disk are kept. You can continue installing from this screen.", confirm: "Stop installation" })) return;
    await run(async () => { const accepted = await api("/stop", {}); setStatus(current => ({ ...current, job: { ...accepted, running: true } })); });
  }
  async function enter() {
    await run(async () => { await api("/environment/initialization", { action: "complete" }); await refresh(); if (alive.current) onComplete(); });
  }
  async function waitForJob(accepted, kind) {
    if (!accepted.id) throw new Error("The operation did not return a task ID. Check the status and try again.");
    while (alive.current) {
      const next = await api("/status");
      if (!alive.current) break;
      setStatus(next);
      const current = next.job;
      if (current?.id !== accepted.id || current.kind !== kind) throw new Error("The operation status has changed. Check the status and try again.");
      if (current.error || current.canceled) throw new Error(current.error || "The operation was canceled. Check the status and try again.");
      if (!current.running) return next;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new Error("The setup page was closed and the operation did not continue.");
  }
  async function bindExit() {
    await run(async () => {
      const accepted = await bindDetectedMacOSExit(exitCandidate, confirm);
      if (!accepted) return;
      await waitForJob(accepted, "settings");
    });
  }
  async function restart() {
    await run(async () => {
      const running = status.vm_running;
      if (!await confirm({ title: running ? "Restart the virtual Mac and check?" : "Start the guest and check again?", body: "Save your files first. The current terminal sessions will end; browser sign-ins and project files are kept. Internet access stays off until the check passes.", confirm: running ? "Restart and check" : "Start and check" })) return;
      const current = await api("/status");
      if (!alive.current) return;
      if (current.job?.running) throw new Error("Another operation is still running. Wait for it to finish and try again.");
      if (current.vm_running) {
        const stopped = await waitForJob(await api("/stop", {}), "stop");
        if (stopped.vm_running) throw new Error("The guest has not stopped. Check the status and try again.");
      }
      if (!alive.current) return;
      const accepted = await api("/start", {});
      if (!accepted.id) throw new Error("The start request did not return a task ID. Check the status and try again.");
      setStatus(current => ({ ...current, job: { ...accepted, running: true, kind: "start", message: accepted.message || "Starting and checking the guest…" } }));
    });
  }
  async function checkNetwork() {
    await run(async () => {
      const accepted = await api("/safety/check", {});
      setStatus(current => ({ ...current, job: { ...accepted, running: true, kind: "safety", message: "Checking the proxy exit and environment isolation…" } }));
    });
  }
  async function back() {
    if (step === "proxy" && proxyDirty && !await confirm({ title: "Discard proxy changes that have not been applied?", body: "Proxies that were already saved and applied are kept; unapplied changes in the form are discarded.", confirm: "Discard changes" })) return;
    setProxyDirty(false);
    setStep(step === "install" ? "proxy" : pending || account?.guest_system ? "install" : "system");
  }
  async function nextFromSystem() {
    await run(async () => {
      const directory = storage.directory.trim();
      if (directory !== storage.location.directory) {
        const accepted = await api("/environment/storage", { directory, previous: storage.location.directory, migrate: false });
        let job;
        do {
          await new Promise(resolve => setTimeout(resolve, 300));
          if (!alive.current) return;
          const next = await api("/status");
          setStatus(next); job = next.job;
          if (job.id !== accepted.id) throw new Error("The storage operation status has changed. Check the directory and try again.");
        } while (job.running);
        if (job.error) throw new Error(job.error);
        const location = await api("/environment/storage");
        if (location.directory !== directory) throw new Error("The storage directory has not been saved. Choose it again and retry.");
        setStorage({ location, directory: location.directory });
      }
      setStep("proxy");
    });
  }
  const failed = Boolean(job.error || error);
  const networkPending = Boolean(status?.ready && status.vm_running && network.mode !== "open");
  const progress = !status?.ready && job.setup_progress ? { ...job, setup_progress: job.setup_progress } : null;
  const title = step === "system" ? "Prepare a separate environment for Cage" : step === "proxy" ? "Connect your network proxy" : ready ? "Cage is ready" : !busy && networkPending ? "Environment started, waiting for network checks" : failed ? "Finish the environment installation" : busy ? "Preparing your environment" : "Install and check the guest environment";
  const index = steps.findIndex(([key]) => key === step);
  return <InitializationFrame>
    <section className="initialization-content">
      <ol className="initialization-steps" aria-label="Setup steps">{steps.map(([key, label], position) => <li key={key} aria-current={step === key ? "step" : undefined}><span>{position < index ? <Check size={14} /> : position + 1}</span>{label}</li>)}</ol>
      <div className="initialization-title"><h1>{title}</h1><p>{step === "system" ? "Choose the guest system and storage location. Enter the workbench once setup is done." : step === "proxy" ? "This proxy is used by processes and developer tools inside the guest. The system image downloads through the host proxy and follows the system proxy or TUN settings of software such as Clash." : ready ? "The system, development components and network checks are all done. You can enter the workbench and start using it." : "Downloads, installation, required authorizations and checks all happen here. If interrupted, you can resume the original task."}</p></div>
      {connectionError && <div className="initialization-notice" role="alert"><SafetyMessage message={connectionError} /><button onClick={() => pollNow.current?.()}>Reconnect</button></div>}
      {!status ? <p role="status"><LoaderCircle size={18} className="spin" />Reading the installation status…</p> : <>
        <div className="initialization-stage" key={step}>
          {step === "system" && <>
            <GuestSystemPicker system={choice} onChange={setChoice} preserveOnUnmount deferMatch />
            <InitializationStorage value={storage} onChange={setStorage} disabled={busy} />
          </>}
          {step === "proxy" && <><div className="settings-content"><ProxySettings initializing status={status} onConfirm={confirm} onDirty={setProxyDirty} onApplied={async () => { setProxy(await api("/proxy")); pollNow.current?.(); }} /></div>{choice?.clone && !needsProxySetup(null, status, proxy) && <HostCloneSummary pending={choice.pending} onChange={setChoice} />}</>}
          {step === "install" && (ready ? <div className="initialization-ready"><ShieldCheck size={36} /><h2>Environment ready</h2><p>The separate guest is installed, and tools, files and sign-in state are kept. From now on you can open Cage and go straight to the workbench.</p></div> : <>
            {exitCandidate && <section className="initialization-notice" aria-label="Confirm fixed exit"><p>The guest terminal, browser and proxy measured the same exit. Confirm whether to bind it as the fixed exit.</p><button disabled={busy || Boolean(connectionError)} onClick={bindExit}>Bind the detected fixed exit {exitCandidate}</button></section>}
            {needsExitRestart && <section className="initialization-notice" aria-label="Fixed exit saved"><p>Fixed exit saved. Restart the guest and run the checks again before entering the workbench.</p><button className="primary" disabled={busy || Boolean(connectionError)} onClick={restart}>{status.vm_running ? "Restart the guest and check again" : "Start the guest and check again"}</button></section>}
            {progress ? <SetupProgress job={progress} onDetails={() => setDetails(true)} onStop={stop} onRetry={needsExitRestart ? restart : install} disconnected={Boolean(connectionError) || submitting} /> : (busy || status.guest_system !== "macos" || !networkPending) && <div className="initialization-operation" role="status">{busy && <LoaderCircle size={22} className="spin" />}<p>{job.message || (status.vm_running ? "Finish connecting the guest and the network checks." : "Ready to resume the original installation; existing files and the disk are kept.")}</p>{!busy && !job.error && !needsExitRestart && <button className="primary" disabled={Boolean(connectionError)} onClick={install}>{status.ready ? "Restart and check" : "Continue installation"}</button>}{busy && <button onClick={stop} disabled={submitting}>Stop installation</button>}</div>}
            {job.error && !progress && !(status.guest_system === "macos" && networkPending) && <div className="initialization-notice" role="alert"><SafetyMessage message={job.error} />{!networkPending && !needsExitRestart && <button className="primary" disabled={busy || Boolean(connectionError)} onClick={install}>Continue installation</button>}</div>}
            {status.guest_system === "macos" && status.vm_running && !status.ready && !busy && <section className="initialization-notice"><h2>Connect the virtual Mac</h2><p>{status.environment_update_error || "The guest has started but the workbench connection is not established. First check whether the guest is stuck at the sign-in screen."}</p><MacOSLogin onSessionClosed={() => pollNow.current?.()} /><button disabled={Boolean(connectionError)} onClick={install}>Reconnect and check</button></section>}
            {status.ready && network.mode !== "open" && !busy && !needsExitRestart && <>
              {status.guest_system === "macos" && <InitializationChecks status={status} busy={Boolean(connectionError)} onWorkspace={setApprovalWorkspace} onCheck={checkNetwork} onStart={install} onRestart={restart} onUpdate={() => run(() => api("/environment/update", {}))} onDiagnostics={() => setHelp(true)} />}
              <div className="initialization-network"><p>{status.safety?.error || job.error || status.network_error || "The guest is connected. Finish the network and isolation checks to enter the workbench."}</p><button disabled={Boolean(connectionError)} onClick={checkNetwork}>Run network and isolation checks</button></div>
            </>}
            {(progress?.setup_progress.phase === "image" || (failed && !networkPending)) && <p>The system image and the macOS installation components prepared on the host follow the host proxy settings. If a download fails, see the current file and retry records in the operation details. Network requests inside the guest use the Cage proxy.</p>}
            <div className="initialization-recovery"><button onClick={() => setStep("proxy")} disabled={busy}>Check the Cage proxy configuration</button>{!progress && <button onClick={() => setDetails(true)}>View operation details</button>}</div>
          </>)}
        </div>
        {git && <section className="initialization-notice" aria-label="Git protection"><h2>Protect Git on this computer before installing</h2><p>{git.message}</p>{git.can_enable && <><p>Once enabled, Git ignores bare repositories you have not explicitly specified. This changes the global settings of the current user and affects other Git tools on this computer; regular projects work as before.</p><pre>git config --global safe.bareRepository explicit</pre><button className="primary" disabled={busy} onClick={enableGit}>Enable Git protection</button></>}<button disabled={busy} onClick={install}>Check again and install</button></section>}
        {error && <p className="initialization-notice" role="alert"><SafetyMessage message={error} /></p>}
        <footer className="initialization-actions">
          {step === "system" ? <span /> : <button className="text-button" disabled={busy} onClick={back}><ChevronLeft size={16} />Back</button>}
          {step === "system" && <button className="primary" disabled={busy || !storage?.directory.trim() || choice === undefined || (!choice?.clone && !validGuestChoice(choice)) || choice?.clone && choice.guest_system === "windows-11" && !choice.editor_terms || Boolean(connectionError)} onClick={nextFromSystem}>{submitting && <LoaderCircle size={16} className="spin" />}Next: configure proxy</button>}
          {step === "proxy" && <button className="primary" disabled={busy || proxyDirty || !account?.guest_system && !pending && !validGuestChoice(choice) || needsProxySetup(null, status, proxy) || Boolean(connectionError)} onClick={install}>{submitting ? <LoaderCircle size={16} className="spin" /> : null}Start installation</button>}
          {step === "install" && ready && <button className="primary" disabled={submitting || Boolean(connectionError)} onClick={enter}>Enter the workbench</button>}
        </footer>
      </>}
      <div className="initialization-support"><button className="text-button" aria-expanded={help} onClick={() => setHelp(!help)}>Logs and diagnostics</button>{navigation && !busy && <button className="text-button" onClick={() => navigation.open()}>Connect to an SSH host only</button>}</div>
      {help && <DiagnosticSettings />}
    </section>
    {approvalWorkspace && <InitializationProjectApproval workspace={approvalWorkspace} jobRunning={Boolean(job.running)} onClose={() => { setApprovalWorkspace(""); pollNow.current?.(); }} onApproved={() => { setApprovalWorkspace(""); void checkNetwork(); }} />}
    {details && <Modal title="Setup operation details" onClose={() => setDetails(false)}><InitializationDetails status={status} /></Modal>}
    {dialog && <Modal title={dialog.title} onClose={() => settleDialog(false)} footer={<><button onClick={() => settleDialog(false)}>Cancel</button><button className="primary" onClick={() => settleDialog(true)}>{dialog.confirm}</button></>}><div className="modal-body"><p>{dialog.body}</p></div></Modal>}
  </InitializationFrame>;
}
