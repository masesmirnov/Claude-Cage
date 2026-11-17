import React, { useState } from "react";
import { api } from "./api";
import "./environment-cache.css";

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function EnvironmentCache({ status, onConfirm }) {
  const [inventory, setInventory] = useState(null);
  const [selected, setSelected] = useState([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const disabled = working || !status.ready || status.job?.running;

  async function inspect() {
    const next = await api("/environment/cache/inventory", {});
    setInventory(next);
    setSelected([]);
  }

  async function refresh() {
    setWorking(true);
    setError("");
    setResult(null);
    try { await inspect(); }
    catch (failure) { setInventory(null); setSelected([]); setError(failure.message); }
    finally { setWorking(false); }
  }

  async function mutate(action, batch) {
    setWorking(true);
    setError("");
    try {
      const cleaning = action === "clean";
      const choices = inventory.items.filter(item => selected.includes(item.id));
      const confirmed = await onConfirm({
        title: cleaning ? "Clean the selected caches?" : "Restore this cache batch?",
        body: cleaning
          ? `Move ${choices.length} caches (${size(choices.reduce((total, item) => total + item.bytes, 0))}) into a recovery batch.\n${choices.map(item => item.title).join(", ")}.\nAccounts, sign-ins, sessions, projects and persistent disks are kept. Recovery copies still take up space, and clients may regenerate caches the next time they are used.`
          : "Only this cache batch is restored. Caches in use and data newly created in the original location are kept; restoring will not overwrite them.",
        confirm: cleaning ? "Clean caches" : "Restore caches",
      });
      if (!confirmed) return;
      const outcome = await api(`/environment/cache/${action}`, cleaning
        ? { plan_id: inventory.plan_id, items: selected }
        : { batch });
      setResult({ ...outcome, action, titles: Object.fromEntries(inventory.items.map(item => [item.id, item.title])) });
      // Refresh only as part of the explicit user operation, never on mount or a timer.
      await inspect();
    } catch (failure) {
      setInventory(null);
      setSelected([]);
      setError(failure.message);
    } finally { setWorking(false); }
  }

  return <section className="environment-cache" aria-label="Environment cleanup" aria-busy={working}>
    <h4>Environment cleanup</h4>
    <p className="field-help">Take an inventory of the current environment's caches and protected data by hand. Cleanup only moves caches on the allowlist and keeps sign-ins, sessions, projects, settings and persistent disks.</p>
    <div className="environment-version-actions">
      <button disabled={disabled} onClick={refresh}>{working ? "Processing…" : inventory ? "Take inventory again" : "Read-only inventory"}</button>
      {inventory && <button disabled={disabled || !selected.length} onClick={() => mutate("clean")}>Clean selected caches{selected.length ? ` (${selected.length})` : ""}</button>}
    </div>
    {!status.ready && <p className="field-help">Start the current environment first. This does not scan data of other apps on this computer.</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {result && <div role="status" className="cache-result">
      <strong>{result.status === "partial" ? "Some items did not finish; see the reasons" : result.action === "clean" ? "Cache cleanup finished; recovery copies were kept" : "Cache restore finished"}</strong>
      {result.outcomes.map(item => <p key={item.id}>{result.titles[item.id] || item.id}:{item.reason}</p>)}
    </div>}
    {inventory && <>
      <p className="field-help">{inventory.notice}</p>
      <div className="cache-items">
        {inventory.items.filter(item => item.state !== "absent").map(item => <label className="check-line cache-item" key={item.id}>
          <input type="checkbox" aria-label={item.title} checked={selected.includes(item.id)} disabled={disabled || item.state !== "ready"}
            onChange={event => setSelected(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} />
          <span><strong>{item.title}</strong><small>{item.location}</small><small>{item.reason}</small></span>
          <span className="cache-size">{size(item.bytes)}<small>{item.files} files</small></span>
        </label>)}
      </div>
      {!inventory.items.some(item => item.state !== "absent") && <p>No caches on the allowlist were found.</p>}
      <p className="field-help">Running clients and folders with unconfirmed owners or links are kept. Everything is checked again before cleanup, and the preview is valid for 10 minutes.</p>
      <div className="cache-protected" aria-label="Protected data">
        <strong>The following data is kept</strong>
        {inventory.protected.map(item => <p key={item.title}>{item.title}: found {item.present}{item.unknown ? `, ${item.unknown} could not be confirmed` : ""}</p>)}
        <p>System credential stores, project contents and persistent disks are not scanned or cleaned. Whether something exists cannot tell whether you are signed in; rely on what the accounts page and clients actually show.</p>
      </div>
      <div className="cache-recovery" aria-label="Cache recovery batches">
        <h4>Cache recovery batches</h4>
        <p className="field-help">Copies still take up disk space and are not deleted automatically. Restoring does not overwrite newly created data.</p>
        {!inventory.batches.length && <p className="field-help">No recovery batches yet.</p>}
        {inventory.batches.map(batch => <div className="setting-summary-row" key={batch.id}>
          <span>{new Date(batch.created_at * 1000).toLocaleString()} · {batch.count} caches</span>
          <button disabled={disabled} onClick={() => mutate("restore", batch.id)}>Restore this cache batch</button>
        </div>)}
      </div>
    </>}
    <p className="field-help">The flow of inventory, data protection and recoverable cleanup draws on claude-post-ban-cleanup and Claude-Guardian, and is implemented independently by Cage.</p>
  </section>;
}
