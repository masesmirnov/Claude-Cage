import React, { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import { useAccount } from "./account";
import { MacOSLogin } from "./macos-login";
import { DiagnosticSettings } from "./diagnostics.jsx";
import { ScreenSharingChecks } from "./macos-screen-sharing";
import { Modal } from "./modal";
import "./initialization.css";

const steps = [
  { id: "screen", label: "Screen recording", hint: "Turn on the screen recording switch for Cage Guest Window. If prompted to quit and reopen, follow the prompt." },
  { id: "input", label: "Accessibility", hint: "Turn on the accessibility switch for Cage Guest Window so Cage can control guest windows." },
  { id: "projects", label: "File system extension", hint: "Turn on both the macFUSE and macFUSE (local) switches so the guest can access the projects you choose." },
  { id: "sharing", label: "屏幕共享", hint: "在「系统设置 → 通用 → 共享」中打开「屏幕共享」，并允许当前普通客机用户访问。确认开关已打开后，点击「已开启，重新检查」。Cage 会尝试连接客机的屏幕共享服务。" },
];

export function MacOSFirstSetup() {
  const { account, refresh } = useAccount();
  const [permissionPage, setPermissionPage] = useState("screen");
  const [state, setState] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [desktopWaiting, setDesktopWaiting] = useState(false);
  const [completionFailed, setCompletionFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [details, setDetails] = useState(false);
  const current = useRef({ account, refresh });
  current.current = { account, refresh };
  const control = useRef({ active: false, inFlight: false, started: false, finished: false, measured: false, waitingSince: 0, requested: "", pending: "" });

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
      if (!next.ready || next.job?.running || credentialsPending) { setReadError(""); setDesktopWaiting(false); return; }
      let measured;
      try { measured = await request("permissions"); }
      catch (e) {
        // Right after boot the guest is still signing in its ordinary user;
        // its window helper starts with the desktop. That is progress, not a failure.
        c.waitingSince ||= Date.now();
        if (!c.measured && Date.now() - c.waitingSince < 5 * 60 * 1000) { if (c.active) { setReadError(""); setDesktopWaiting(true); } return; }
        if (c.active) setDesktopWaiting(false);
        throw e;
      }
      if (!c.active) return;
      c.measured = true;
      setDesktopWaiting(false);
      setReadError("");
      setPermissions(measured);
      const pending = steps.find(({ id }) => !measured[id]);
      const requestKey = pending?.id === "projects" ? `projects:${Boolean(measured.project_install_required)}` : pending?.id;
      if (pending && c.pending !== pending.id) {
        c.pending = pending.id;
        setPermissionPage(pending.id);
      }
      if (measured.managed_credential && pending && c.requested !== requestKey) {
        c.requested = requestKey;
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
    if (steps.some(({ id }) => id === action)) { setPermissionPage(action); c.requested = action === "projects" ? `projects:${Boolean(permissions.project_install_required)}` : action; }
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
  const projectInstallation = permissionPage === "projects" && permissions.project_install_required;
  const selectedHint = projectInstallation ? "先在客机中完成 macFUSE 官方安装器的安装与管理员授权。安装完成后，Cage 会打开文件系统扩展设置，再开启两个开关。" : selected.hint;
  const running = Boolean(state?.job?.running);
  const canOperate = Boolean(state?.vm_running && !running && !busy);
  const canFinish = Boolean(state?.ready && !account.macos_password_pending && !pending && !readError);
  const progress = !state ? "Reading the installation progress…" : running ? state.job.message || "Starting and configuring the virtual Mac…" :
    account.macos_password_pending ? "The guest password has not synced yet. Retry the sync, then continue authorization." : !state.vm_running ? "The virtual Mac is not started; you can continue from the existing disk." :
    !state.ready ? "The virtual Mac has started and is waiting for the guest connection. If it is stuck at the sign-in screen, open the guest view and finish signing in." :
    desktopWaiting ? "虚拟 Mac 正在完成首次登录并启动桌面，通常需要 1–3 分钟。桌面就绪后会自动打开第一项授权。" :
    readError ? "The permission status cannot be confirmed right now; the results shown are for reference. Checking continues once the connection is back." :
    pending ? `Confirm "${pending.label}" now. Cage checks automatically and continues when you are done.` :
    completionFailed ? "四项权限已验证，最后的设置收尾未完成。请重试完成设置。" : "四项权限已验证，正在保存设置；随后继续工作区授权和联网检查。";
  const sharingControls = <>
    <button type="button" disabled={!canOperate} onClick={() => act("sharing")}>{busy ? "正在处理…" : "打开屏幕共享设置"}</button>
    <button type="button" className="primary" disabled={!canOperate} onClick={() => act("confirm-sharing")}>{busy ? "正在检查…" : "已开启，重新检查"}</button>
  </>;
  const controls = pending?.id === "sharing" ? sharingControls : <button type="button" className="primary" disabled={!canOperate} onClick={() => act(pending?.id || permissionPage)}>
    {busy ? "正在处理…" : projectInstallation ? "打开 macFUSE 安装器" : `打开${pending?.label || selected.label}`}
  </button>;
  const failure = error || readError || (!running && state?.job?.error) || (!state?.ready && state?.environment_update_error);

  return <main className="initialization"><section className="initialization-content mac-setup-content">
    <div className="initialization-title"><p className="mac-setup-eyebrow">Install and check · macOS permissions</p><h1>Finish the virtual Mac's system authorizations</h1>
      <p>安装文件和客机磁盘已保留。下面四项授权在虚拟 Mac 内完成，每项验证通过后会自动继续。屏幕共享会检查服务是否启用且真正可连接。</p></div>
    <ol className="mac-setup-checklist" aria-label="System authorization progress">
      {steps.map(({ id, label }, index) => <li key={id} data-complete={Boolean(permissions[id])} aria-current={pending?.id === id ? "step" : undefined}>
        <span className="mac-setup-marker">{permissions[id] ? <Check size={16} aria-hidden="true" /> : index + 1}</span>
        <span>{label}</span><small>{permissions[id] ? "Verified" : pending?.id === id ? "Waiting for confirmation" : "Confirm later"}</small>
      </li>)}
    </ol>
    <section className="initialization-operation mac-setup-task" aria-label="Current setup step">
      <h2>{!state?.ready ? "Connect the virtual Mac" : pending ? `Confirm: ${pending.label}` : "Finish system setup"}</h2>
      <p role="status">{busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />} {progress}</p>
      {pending && state?.ready && <><p>{selectedHint}</p>
        {pending.id === "projects" && permissions.projects_error && <p>{permissions.projects_error}</p>}
        {pending.id === "sharing" && <ScreenSharingChecks checks={permissions.sharing_checks} summary={permissions.sharing_summary} />}
      </>}
      <div className="initialization-recovery">
        {state && !running && (!state.ready || account.macos_password_pending || state.job?.error) && <button className="primary" disabled={busy} onClick={() => act("start")}>{account.macos_password_pending ? "Retry syncing the guest password" : "Continue starting and connecting"}</button>}
        {pending && state?.ready && controls}
        {completionFailed && <button className="primary" disabled={busy || !canFinish} onClick={() => act("finish")}>Retry finishing setup</button>}
        <button disabled={busy || running} onClick={() => void check()}>Check status again</button>
      </div>
      {running && <button disabled={busy} onClick={() => act("stop")}>Stop the current operation and keep progress</button>}
      {state?.vm_running && <MacOSLogin initialSetup autoOpen={Boolean(permissions.managed_credential)} managedCredential={permissions.managed_credential} disabled={!canOperate}
        label="打开客机画面" setupActions={controls} setupHint={`${selectedHint} 系统要求管理员时，用户名填 cagesetup；选中密码框后可点击「填写授权密码」。`}
        setupStatus={failure || progress} setupError={Boolean(failure)} />}
    </section>
    {failure && <section className="initialization-notice" role="alert"><h2>This step is not completed</h2><p>{failure}</p><p>The installation progress so far is kept. You can reopen the current setup page, or check the status again and continue.</p></section>}
    <details className="mac-setup-help"><summary>Help with the administrator password and finding the settings page</summary>
      <p>When the system asks for an administrator, enter <strong>cagesetup</strong> as the username, {account.macos_password_pending ? "and the original guest password may still be needed until the password sync finishes." : account.macos_credentials_ready ? "and the password is the same as your Cage account." : "select the password field in the guest view, then click \"Fill in authorization password\"."} Continue after you confirm the authorization; this temporary administrator is disabled at the end of setup.</p>
      <p>Manual entry for the file system extension: in the guest, System Settings → General → Login Items &amp; Extensions → By Category → File System Extensions, then turn on both macFUSE and macFUSE (local).</p>
      <p>屏幕共享的手动入口：客机「系统设置 → 通用 → 共享」，打开「屏幕共享」并允许当前普通客机用户。</p>
      <div className="initialization-recovery">{steps.map(({ id, label }) => <button key={id} disabled={!canOperate} onClick={() => act(id)}>Reopen {label} settings</button>)}</div>
    </details>
    <p className="mac-setup-retention">After the system authorizations, Cage also confirms the shared workspace and network isolation. Once all checks pass you can enter the workbench.</p>
    <div className="initialization-support"><button className="text-button" onClick={() => setDetails(true)}>View operation details</button><button className="text-button" onClick={() => setDiagnostics(!diagnostics)}>Logs and diagnostics</button></div>
    {diagnostics && <DiagnosticSettings />}
    {details && <Modal title="System setup operation details" onClose={() => setDetails(false)}><div className="modal-body"><p>{progress}</p>{failure && <p role="alert">{failure}</p>}<pre className="job-log">{state?.job?.log || "The current step has no additional operation log. Export the full record from Logs and diagnostics."}</pre></div></Modal>}
  </section></main>;
}
