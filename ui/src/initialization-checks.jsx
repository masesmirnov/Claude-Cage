import React from "react";
import { MacOSLogin } from "./macos-login";

// Recovery codes come from the operation that failed. Project status also
// supports restoring the flow after the in-memory job has been replaced.
export function initializationRecovery(status) {
  if (status?.guest_system !== "macos") return null;
  const workspace = status.workspace || status.environment_directory;
  const failure = status.project_errors?.find(item => item.path === workspace);
  if (failure) return { ...failure, workspace };
  if (status.job?.error && status.job.recovery) return { recovery: status.job.recovery, message: status.job.error, workspace: status.job.workspace || workspace };
  return { workspace };
}

export function InitializationChecks({ status, busy, onWorkspace, onCheck, onStart, onRestart, onUpdate, onDiagnostics }) {
  const recovery = initializationRecovery(status);
  const code = recovery?.recovery;
  const workspaceChecked = !code && status.safety?.report?.checks?.some(check => check.id === "filesystem_boundary" && check.state === "passed");
  return <section className="initialization-notice" aria-label="Finish the setup checks">
    <h2>{code === "project-approval" ? "Allow the virtual Mac to access the workspace" : code === "guest-login" ? "Sign in to the virtual Mac first" : code === "filesystem-permission" ? "Turn on file sharing permission first" : "Finish the workspace and network checks"}</h2>
    <p>{recovery?.message || status.job?.error || status.safety?.error || "The system is installed. Next, confirm the shared workspace is reachable, then check the proxy exit and environment isolation."}</p>
    {recovery?.workspace && <p className="macos-approval-path">{recovery.workspace}</p>}
    {code === "project-approval" && <p>Click the button below to open the authorization window in Cage. In the window, click Use Project; once verification passes, the network checks continue.</p>}
    {code === "filesystem-permission" && <p>In the virtual Mac, turn on both the macFUSE and macFUSE (local) switches, then return here to continue.</p>}
    {code === "guest-login" && <MacOSLogin disabled={busy} onSessionClosed={onCheck} />}
    {code === "filesystem-permission" && <MacOSLogin maintenance="projects" disabled={busy} onSessionClosed={onCheck} />}
    <div className="initialization-recovery">
      {["environment-update", "environment-restart"].includes(code) ? <>
        {code === "environment-update" && <button className="primary" disabled={busy} onClick={onUpdate}>Sync environment components</button>}
        <button disabled={busy} onClick={code === "environment-restart" ? onRestart : onStart}>{code === "environment-restart" ? "Save, restart and check" : "Reconnect and check"}</button>
      </> : <button className="primary" disabled={busy || !status.ready} onClick={() => workspaceChecked ? onCheck() : onWorkspace(recovery?.workspace)}>{code === "project-approval" ? "Open workspace authorization" : workspaceChecked ? "Retry network and isolation checks" : "Connect to the workspace and continue checks"}</button>}
      {code === "project-directory" && <button disabled={busy} onClick={onDiagnostics}>View diagnostic records</button>}
    </div>
    <p className="mac-setup-retention">Until the checks pass, the guest's internet access stays off. Authorization and checks can be retried, and the existing installation and personal files are kept.</p>
  </section>;
}

export function InitializationDetails({ status }) {
  const job = status?.job || {};
  const reasons = [...new Set([job.error, status?.safety?.error, status?.network_error].filter(Boolean))];
  const checks = status?.safety?.report?.checks || [];
  const labels = { passed: "Passed", failed: "Failed", unknown: "Not completed" };
  return <div className="modal-body">
    <p>{job.running ? "Current operation" : "Last operation"}: {job.message || "Not started"}</p>
    {reasons.map(reason => <p key={reason} role="alert">{reason}</p>)}
    {checks.length > 0 && <><h3>Latest check results</h3><ol className="initialization-checks">{checks.map(check => <li key={check.id}>
      <strong>{check.title} · {labels[check.state] || "Not completed"}</strong>
      <p>{check.evidence}</p>{check.state !== "passed" && check.remedy && <p>{check.remedy}</p>}
    </li>)}</ol></>}
    <h3>Operation log</h3><pre className="job-log">{job.log || "The current operation has no additional log. The failure reason is shown above; the full record can be exported from Logs and diagnostics."}</pre>
  </div>;
}
