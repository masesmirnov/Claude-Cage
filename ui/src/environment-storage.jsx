import React, { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import { SafetyMessage } from "./safety-message";

export function EnvironmentStorage({ status, onConfirm }) {
  const [location, setLocation] = useState(null);
  const [pending, setPending] = useState(null);
  const [directory, setDirectory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const job = status.job;
  const recovery = status.storage_recovery?.required ? status.storage_recovery : location?.recovery;
  const storageJob = job?.kind === "storage" || job?.kind === "storage-recovery";
  const busy = submitting || Boolean(pending) || Boolean(job?.running);
  useEffect(() => {
    let live = true;
    if (pending && job?.id === pending.previousJob) return;
    if (storageJob && job.running) return;
    api("/environment/storage").then((next) => {
      if (!live) return;
      setLocation(next);
      if (pending) {
        setPending(null);
        if (job?.id === pending.id && job.error) setError(job.error);
        else if (job?.id === pending.id || next.directory && next.directory === pending.path) { setDirectory(""); setError(""); }
        else setError("The operation has ended. Check the current environment directory and try again.");
      }
    }).catch((e) => {
      if (live) { setError(e.message); setPending(null); }
    });
    return () => { live = false; };
  }, [pending, job?.id, job?.running, storageJob, status.storage_recovery?.required]);

  const choose = async () => {
    setError("");
    try {
      const selected = await native("chooseFolder", { purpose: "environmentStorage" });
      if (selected) setDirectory(selected);
    } catch { setError("Could not choose a folder. Enter the absolute path directly."); }
  };
  const apply = async () => {
    if (!location?.directory || busy || recovery?.required) return;
    const path = directory.trim();
    if (location.has_environment && !(await onConfirm({
      title: "Migrate the local environment?",
      body: `Save your files first. Cage will stop the environment and terminals, copy the virtual disk to ${path}, and switch locations after verifying it. The original data is kept as a backup, and you can start the environment manually once the migration finishes.`,
      confirm: "Migrate environment",
    }))) return;
    setSubmitting(true);
    setError("");
    try {
      const accepted = await api("/environment/storage", {
        directory: path, previous: location.directory, migrate: location.has_environment,
      });
      setPending({ id: accepted.id, previousJob: job?.id, path });
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };
  const recover = async (repair) => {
    if (busy) return;
    setSubmitting(true);
    setError("");
    try {
      const accepted = await api("/environment/storage/recover", { repair });
      setPending({ id: accepted.id, previousJob: job?.id });
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };
  return <section className="environment-versions environment-storage" aria-label="Local environment storage">
    <h4>Local environment storage</h4>
    {recovery?.required ? <>
      <p className="field-help">The environment storage needs recovery. Connect the disk used for the migration and try again. You can start the environment once recovery finishes.</p>
      <p role="alert" className="error-message"><SafetyMessage message={recovery.error} /></p>
      <div className="storage-actions">
        <button type="button" disabled={busy} onClick={() => recover(false)}>Retry recovery</button>
        {recovery.repair_allowed && <button type="button" disabled={busy} onClick={() => recover(true)}>Repair system management helper and recover</button>}
      </div>
      {recovery.repair_allowed && <p className="field-help storage-repair-help">Repairing the system management helper needs Windows authorization. Recovery of the original environment continues afterwards.</p>}
    </> : <>
    <p className="field-help">The system image, download cache and virtual disk can live on another local disk. Project files stay in their own project folders.</p>
    <div className="setting-summary-row"><span>Current environment directory</span><strong>{location?.directory || "Reading…"}</strong></div>
    {status.environment_identity_directory && status.environment_identity_directory !== status.environment_directory &&
      <p className="field-help">Default project files from before the upgrade are in <code>{status.environment_identity_directory}</code>, and the current default project is in <code>{status.environment_directory}</code>. To use a project from the old directory, move it outside the Cage configuration directory in the host file manager, then open it from the workbench.</p>}
    {location?.backup && <p className="field-help">The pre-migration backup is saved in <code>{location.backup}</code>. Once you have confirmed that the new environment starts normally and your files and sign-in state are intact, you can clean up the backup yourself.</p>}
    <label>New storage location
      <input value={directory} onChange={(e) => { setDirectory(e.target.value); setError(""); }} spellCheck="false"
        disabled={busy || !location?.directory} placeholder="Full path of a dedicated empty folder on a local disk" />
    </label>
    <div className="storage-actions">
      {nativeAvailable() && <button type="button" disabled={busy || !location?.directory} onClick={choose}><FolderOpen size={15} />Choose folder</button>}
      <button type="button" disabled={busy || !location?.directory || !directory.trim() || directory.trim() === location.directory} onClick={apply}>
        {location?.has_environment ? "Migrate to this location" : "Use this location"}
      </button>
    </div>
    </>}
    {storageJob && job.running && <p role="status" className="field-help">{job.message}</p>}
    {error && error !== recovery?.error && <p role="alert" className="error-message"><SafetyMessage message={error} /></p>}
  </section>;
}
