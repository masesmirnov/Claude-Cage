import React, { useEffect, useRef, useState } from "react";
import { Folder, ListFilter, RefreshCw, Search, Trash2 } from "lucide-react";
import { api } from "./api";
import { InlineSelect } from "./inline-select";
import "./cli-sessions.css";

export const desktopSessionRequest = (path, options = {}) => api("/cli" + path, options.body);
export const sessionsChanged = () => window.dispatchEvent(new Event("cage-cli-sessions-changed"));
const archiveDate = new Intl.DateTimeFormat("en-US", {year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false});
const projectLabel = path => path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || path;
const archiveFilters = {all:"All sessions",pinned:"Pinned",deleting:"Deletion incomplete"};

function ArchiveSelection({ items, selected, onToggle, disabled, label, children }) {
  const input = useRef(null);
  const count = items.filter(item => selected.has(item.id)).length;
  useEffect(() => { input.current.indeterminate = count > 0 && count < items.length; }, [count, items.length]);
  return <label className="archive-selection check-line">
    <input ref={input} type="checkbox" aria-label={label} checked={items.length > 0 && count === items.length}
      disabled={disabled} onChange={() => onToggle(items)} />
    {children && <span>{children}</span>}
  </label>;
}

export function useCLISessions(enabled, visible) {
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = () => { setLoading(true); setRevision(value => value + 1); };
  useEffect(() => {
    window.addEventListener("cage-cli-sessions-changed", refresh);
    return () => window.removeEventListener("cage-cli-sessions-changed", refresh);
  }, []);
  useEffect(() => {
    if (!enabled || !visible) { setLoading(false); return; }
    let live = true, timer;
    const load = async () => {
      setLoading(true);
      try {
        const result = await desktopSessionRequest("/sessions");
        if (!live) return;
        setSessions((result.sessions || []).map(session => result.notice ? { ...session, active: false, running: false } : session));
        setError(result.notice || "");
      } catch (error) {
        if (live) {
          setError(error.message);
          setSessions(previous => previous.map(session => ({ ...session, active: false, running: false })));
        }
      } finally { if (live) setLoading(false); }
      if (live) timer = setTimeout(load, 5000);
    };
    void load();
    return () => { live = false; clearTimeout(timer); };
  }, [enabled, visible, revision]);
  return { sessions, error, loading, refresh };
}

export function ArchivedSessions({ request = desktopSessionRequest, ready, onRestored }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [project, setProject] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [resultMessage, setResultMessage] = useState("");
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    let live = true, timer;
    const load = async () => {
      try {
        const result = await request("/sessions?archived=true");
        if (live) {
          const list = result.sessions || [];
          setSessions(list); setReadError(result.notice || "");
          setSelected(previous => new Set([...previous].filter(id => list.some(session => session.id === id))));
        }
      } catch (error) { if (live) setReadError(error.message); }
      if (live) timer = setTimeout(load, 5000);
    };
    if (!busy) void load();
    return () => { live = false; clearTimeout(timer); };
  }, [request, revision, busy]);
  const change = async (items, operation) => {
    if (busy) return;
    setBusy(true); setError(""); setResultMessage("");
    setProgress({done:0, total:items.length});
    const completed = new Set(), failures = [];
    try {
      for (const session of items) {
        try {
          await request("/sessions/" + session.id + "/" + operation, {body:operation === "purge" ? {confirm:true} : {}});
          completed.add(session.id);
        } catch (error) { failures.push({session, message:error.message}); }
        setProgress({done:completed.size + failures.length, total:items.length});
      }
      setSessions(list => list.filter(item => !completed.has(item.id)));
      setSelected(previous => new Set([...previous].filter(id => !completed.has(id))));
      if (completed.size) {
        setConfirming("");
        setResultMessage(`${operation === "restore" ? "Unarchived" : "Permanently deleted"} ${completed.size} ${completed.size === 1 ? "session" : "sessions"}.`);
        sessionsChanged();
      }
      setBulkConfirm(null);
      if (failures.length) setError(`${failures.length} ${failures.length === 1 ? "session" : "sessions"} could not be processed: ${failures.map(({session,message}) => `"${session.title || "New session"}": ${message}`).join("; ")}`);
      if (operation === "restore") for (const id of completed) onRestored?.(id);
    } finally { setBusy(false); setProgress(null); }
  };
  const resetSelection = (setter, value) => {
    setter(value); setSelected(new Set()); setBulkConfirm(null); setConfirming(""); setResultMessage("");
  };
  const toggleSelection = items => {
    const all = items.every(item => selected.has(item.id));
    setSelected(previous => {
      const next = new Set(previous);
      for (const item of items) { if (all) next.delete(item.id); else next.add(item.id); }
      return next;
    });
    setBulkConfirm(null); setConfirming(""); setResultMessage("");
  };
  const projects = [...new Set(sessions?.map(session => session.workspace) || [])];
  const selectedProject = projects.includes(project) ? project : "";
  const search = query.trim().toLocaleLowerCase();
  const groups = new Map();
  for (const session of sessions || []) {
    if (selectedProject && session.workspace !== selectedProject) continue;
    if (filter === "pinned" && !session.pinned || filter === "deleting" && !session.deleting) continue;
    if (search && !(session.title + " " + session.workspace).toLocaleLowerCase().includes(search)) continue;
    if (!groups.has(session.workspace)) groups.set(session.workspace, []);
    groups.get(session.workspace).push(session);
  }
  const visible = [...groups.values()].flat();
  const selectedItems = visible.filter(session => selected.has(session.id));
  const hasDeleting = selectedItems.some(session => session.deleting);
  return <section className="archived-sessions" aria-label="Archived sessions">
    <h2 className="archive-page-title">Archived sessions</h2>
    <div className="archive-toolbar">
      <div className="archive-search"><Search size={18} aria-hidden="true" />
        <input type="search" aria-label="Search archived sessions" placeholder="Search archived sessions" value={query} disabled={busy} onChange={event => resetSelection(setQuery, event.target.value)} />
      </div>
      <InlineSelect aria-label="Session filter" value={filter} disabled={busy} onValueChange={value => resetSelection(setFilter, value)}
        displayLabel={<span className="archive-filter-label"><ListFilter size={17}/><span>{archiveFilters[filter]}</span></span>}>
        {Object.entries(archiveFilters).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </InlineSelect>
      <InlineSelect aria-label="Project filter" value={selectedProject} disabled={busy} onValueChange={value => resetSelection(setProject, value)}
        displayLabel={<span className="archive-filter-label"><Folder size={17}/><span>{selectedProject ? projectLabel(selectedProject) : "All projects"}</span></span>}>
        <option value="">All projects</option>
        {projects.map(path => <option key={path} value={path}>{projects.some(other => other !== path && projectLabel(other) === projectLabel(path)) ? path : projectLabel(path)}</option>)}
      </InlineSelect>
    </div>
    {visible.length > 0 && <div className="archive-bulk-toolbar" role="group" aria-label="Bulk session actions">
      <ArchiveSelection items={visible} selected={selected} onToggle={toggleSelection} disabled={busy} label="Select all in the current filter">Select all</ArchiveSelection>
      <span className="archive-note">{selectedItems.length} {selectedItems.length === 1 ? "session" : "sessions"} selected</span>
      <div className="archived-session-actions">
        <button className="archive-button" disabled={busy || !selectedItems.length} onClick={() => resetSelection(setSelected, new Set())}>Clear selection</button>
        <button className="archive-restore" disabled={busy || !selectedItems.length || hasDeleting} onClick={() => change(selectedItems, "restore")}>Unarchive selected</button>
        <button className="archive-button archive-delete" disabled={busy || !ready || !selectedItems.length} onClick={() => { setConfirming(""); setBulkConfirm(selectedItems); }}>Delete selected</button>
      </div>
      {hasDeleting && <p className="archive-note archive-bulk-note">The selection includes sessions whose deletion is incomplete. Deselect them before unarchiving.</p>}
    </div>}
    {progress && <p role="status" className="archive-note">Processing {progress.done} / {progress.total} sessions…</p>}
    {resultMessage && <p role="status" className="archive-note">{resultMessage}</p>}
    {bulkConfirm && <div className="archive-confirm" role="group" aria-label="Confirm permanent deletion of selected sessions">
      <p>Permanently delete the {bulkConfirm.length} selected {bulkConfirm.length === 1 ? "session" : "sessions"} and their original Claude Code conversations and subagent records? This cannot be undone.</p>
      <div className="archived-session-actions"><button className="archive-button" disabled={busy} onClick={() => setBulkConfirm(null)}>Cancel</button>
        <button className="archive-button archive-delete" disabled={busy || !ready} onClick={() => change(bulkConfirm, "purge")}>Permanently delete selected sessions</button></div>
    </div>}
    {(error || readError) && <div role="alert" className="archive-error">{error || readError}
      {readError && <button className="archive-button" onClick={() => setRevision(value => value + 1)} disabled={busy}>Reload</button>}
    </div>}
    {!sessions && !readError && <p role="status">Reading…</p>}
    {sessions?.length === 0 && <p className="archive-note">No archived sessions.</p>}
    {Boolean(sessions?.length) && !groups.size && <p className="archive-note">No archived sessions match the filter.</p>}
    {[...groups].map(([path,items]) => <section className="archive-project" key={path} aria-label={"Archived sessions of " + projectLabel(path)}>
      <header className="archive-project-heading">
        <ArchiveSelection items={items} selected={selected} onToggle={toggleSelection} disabled={busy} label={`Select all in the current filter for project ${path}`} />
        <Folder size={18}/><h3 title={path}>{projectLabel(path)}</h3><span>{items.length} {items.length === 1 ? "session" : "sessions"}</span></header>
      <div className="archive-project-list">{items.map(session => {
        const date = new Date(session.updated_at);
        return <article className="archived-session" key={session.id}>
          <div className="archived-session-row">
            <ArchiveSelection items={[session]} selected={selected} onToggle={toggleSelection} disabled={busy} label={`Select session ${session.title || "New session"}`} />
            <div className="archived-session-title"><h4>{session.title || "New session"}</h4>
              {!Number.isNaN(date.valueOf()) && <time dateTime={session.updated_at}>{archiveDate.format(date)}</time>}
            </div>
            <div className="archived-session-actions">
              <button className="archive-icon-button" aria-label={session.deleting ? "Retry deletion" : "Delete session"} title={session.deleting ? "Retry deletion" : "Delete session"}
                disabled={busy || !ready} onClick={() => { setBulkConfirm(null); session.deleting ? change([session], "purge") : setConfirming(session.id); }}>
                {session.deleting ? <RefreshCw size={16}/> : <Trash2 size={16}/>}</button>
              <button className="archive-restore" disabled={busy || session.deleting} onClick={() => change([session], "restore")}>Unarchive</button>
            </div>
          </div>
          {session.deleting && <p className="archive-note">Permanent deletion is not complete. Retry once the connection is back.</p>}
          {confirming === session.id && <div className="archive-confirm" role="group" aria-label="Confirm permanent deletion of session">
            <p>Permanently delete "{session.title || "New session"}" and its original Claude Code conversation and subagent records? This cannot be undone.</p>
            <div className="archived-session-actions"><button className="archive-button" disabled={busy} onClick={() => setConfirming("")}>Cancel</button>
              <button className="archive-button archive-delete" disabled={busy || !ready} onClick={() => change([session], "purge")}>Delete permanently</button></div>
          </div>}
        </article>;
      })}</div>
    </section>)}
    {!ready && <p className="archive-note">Start the host environment to permanently delete the original Claude Code records.</p>}
  </section>;
}
