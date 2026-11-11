import React from "react";
import { SafetyMessage } from "./safety-message";
import { ArrowDownToLine, Box, Layers3, PackageOpen, SlidersHorizontal } from "lucide-react";
import "./setup-progress.css";

const stages = [
  ["image", "System image", ArrowDownToLine],
  ["packages", "System software", Layers3],
  ["tools", "Developer tools", PackageOpen],
  ["services", "Environment services", SlidersHorizontal],
];

function bytes(value) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${Number(value.toFixed(unit && value < 100 ? 1 : 0))} ${units[unit]}`;
}

export function SetupProgress({ job, onDetails, onStop, onRetry, disconnected }) {
  const { phase, label, received, total, bytes_per_second, operation } = job.setup_progress;
  const native = job.kind === "guest-install";
  const windows = native && job.setup_progress.system === "windows-11";
  const stage = stages.find(([key]) => key === phase);
  const Icon = stage?.[2] || Box;
  const hasBytes = Number.isFinite(received) && received >= 0;
  const knownSize = hasBytes && Number.isFinite(total) && total > 0 && received <= total;
  const percent = knownSize ? Math.floor(received / total * 100) : null;
  const failed = Boolean(job.error);
  const waitingForWindows = windows && operation === "oobe";
  const canContinue = failed || (waitingForWindows && !job.running);
  const meter = knownSize ? `${bytes(received)} / ${bytes(total)}` : hasBytes ? `Received ${bytes(received)}` : "";
  return <section className={`setup-progress${failed ? " setup-progress-failed" : ""}`} aria-label="Environment installation progress">
    <ol className="setup-stages" aria-label="Installation stages">
      {stages.map(([key, name]) => <li key={key} aria-current={key === phase ? "step" : undefined}>{native && key === "image" ? "Installation media" : native && key === "packages" ? "System installation" : name}</li>)}
    </ol>
    <div className="setup-transfer">
      <div className="setup-transfer-heading">
        <span className="setup-transfer-icon"><Icon size={19} aria-hidden="true" /></span>
        <div className="setup-transfer-description">
          <h2>{label || stage?.[1] || "Preparing the environment"}</h2>
          {meter && <span className="setup-transfer-bytes">{meter}</span>}
          {hasBytes && operation !== "verify" && Number.isFinite(bytes_per_second) && bytes_per_second > 0 && <span className="setup-transfer-bytes"> · {bytes(bytes_per_second)}/s</span>}
        </div>
        {knownSize && <strong className="setup-transfer-number">{percent}<small>%</small></strong>}
      </div>
      {!failed && !waitingForWindows && <div role="progressbar" aria-label={label || stage?.[1] || "Current operation"}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}
        aria-valuetext={knownSize ? `${percent}%, ${meter}` : meter || undefined}
        className={knownSize ? "setup-meter" : "setup-meter setup-meter-active"}>
        <span style={knownSize ? { width: `${received / total * 100}%` } : undefined} />
      </div>}
      {windows && operation === "account" && <p className="setup-transfer-hint">Set a new local administrator name and password for the virtual Windows. After installation, sign in to the guest with this account and enter it again when you continue the installation.</p>}
      {waitingForWindows && <p className="setup-transfer-hint">In the virtual machine connection (VMConnect) window, choose the Windows edition, disk and region, sign in to the desktop with the local administrator you set before installing, then return to Cage to continue. This round's PowerShell window closes automatically.</p>}
      {windows && operation === "credentials" && <p className="setup-transfer-hint">Confirm the guest is signed in to the desktop, then enter the guest administrator account in the PowerShell installation window. Keep that window open and wait for the component installation to finish.</p>}
      {windows && ["media", "tools", "services"].includes(operation) && <p className="setup-transfer-hint">Keep the PowerShell installation window open; Cage closes it automatically once the components are installed.</p>}
      {failed && <>
        <p className="setup-transfer-error" role="alert"><SafetyMessage message={job.error} /></p>
        <p className="setup-transfer-hint">You can continue the installation manually; saved downloads will try to resume.</p>
      </>}
    </div>
    <div className="setup-transfer-actions">
      <button className="text-button" type="button" onClick={onDetails}>Operation details</button>
      {canContinue
        ? <button type="button" className="primary" onClick={onRetry} disabled={disconnected}>{waitingForWindows && !failed ? "At the desktop, continue installation" : "Continue installation"}</button>
        : <button type="button" onClick={onStop} disabled={disconnected}>Stop installation</button>}
    </div>
  </section>;
}
