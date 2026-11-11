import { isWindows, isMac } from "./platform.mjs";
import React, { useEffect, useState } from "react";
import { FolderOpen, LoaderCircle, Plus } from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import { SafetyMessage } from "./safety-message";
import { Modal } from "./views";
import { MacOSProjectApproval } from "./macos-project-approval";
import { ProjectRecovery } from "./project-recovery";
import { projectName, rememberClientProjectName } from "./workspace-state.mjs";
import { getClientContext, isRemoteClient } from "./client-context.mjs";

export function ProjectDialog({
  status,
  initialPath = "",
  activate = true,
  onClose,
  onOpened,
  onRemoved,
  onSettings,
}) {
  const projects = status.projects || [];
  const [adding, setAdding] = useState(Boolean(initialPath) || projects.length === 0);
  const [path, setPath] = useState(initialPath || status.workspace || projects[0] || "");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState("");
  const [pending, setPending] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState("");
  const [removed, setRemoved] = useState([]);
  const [directories, setDirectories] = useState(null);
  const [browsing, setBrowsing] = useState(false);
  const remote = isRemoteClient();
  const context = getClientContext();
  const canShare = remote && nativeAvailable() && context.connection?.manifest?.capabilities?.client_project_share === true;
  const [shares, setShares] = useState([]);
  const [writeAccess, setWriteAccess] = useState(false);
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    if (!canShare) return;
    let current = true;
    api("/client/project-shares").then(({ shares }) => {
      if (current) {
        (shares || []).forEach(rememberClientProjectName);
        setShares(shares || []);
      }
    }).catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [canShare, context.connection_id]);
  const share = async () => {
    setSubmitting(true); setError("");
    try {
      const item = await native("shareLocalProject", { mode: writeAccess ? "write" : "read" });
      if (item.canceled) return;
      rememberClientProjectName(item);
      setShares((old) => [...old.filter((s) => s.id !== item.id), item]);
      setPath(item.guest_path); setAdding(false); setSharing(false);
      const result = await api("/projects/open", { workspace: item.guest_path, add: false, activate });
      await onOpened(result.workspace);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };
  const revoke = async (item) => {
    setSubmitting(true); setError("");
    try {
      await api("/client/project-shares/" + item.id, undefined, "DELETE");
      setShares((old) => old.filter((s) => s.id !== item.id));
      if (path === item.guest_path) setPath(status.environment_directory || "");
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };
  const projectList = [...new Set([...projects, ...shares.map((s) => s.guest_path)])].filter(project => !removed.includes(project));
  const selectedShare = shares.find((item) => item.guest_path === path);
  const busy = submitting || Boolean(status.job?.running);
  const remove = async () => {
    if (busy || !removeTarget) return;
    setSubmitting(true); setError("");
    try {
      const result = await api("/projects/remove", { workspace: removeTarget });
      setRemoved(previous => [...previous, removeTarget]);
      setPath(result.workspace || status.environment_directory || "");
      setRemoveTarget("");
      await onRemoved?.(removeTarget, result.workspace);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };
  const browse = async (directory = path.trim()) => {
    setBrowsing(true); setError("");
    try { setDirectories(await api(`/projects/directories?${new URLSearchParams({ path: directory })}`)); }
    catch (e) { setError(e.message); }
    finally { setBrowsing(false); }
  };
  const choose = async () => {
    if (remote) { await browse(); return; }
    try {
      const selected = await native("chooseFolder");
      if (selected) {
        setPath(selected);
        setError("");
      }
    } catch {
      setError("Could not choose a folder. Enter the path directly.");
    }
  };
  const add = () => {
    setAdding(true);
    setPath("");
    setError("");
    if (remote) void browse("");
    else if (nativeAvailable()) void choose();
  };
  const open = async (event) => {
    event?.preventDefault();
    if (busy || sharing || removeTarget || !status.ready || !path.trim()) return;
    setSubmitting(true);
    setError("");
    setRecovery("");
    try {
      const result = await api("/projects/open", {
        workspace: path.trim(),
        add: adding,
        activate,
      });
      if (result.approval) setPending({ workspace: result.workspace, grant: result.approval });
      else await onOpened(result.workspace);
    } catch (e) {
      setError(e.message);
      setRecovery(e.recovery || "");
    } finally {
      setSubmitting(false);
    }
  };
  if (pending) return <MacOSProjectApproval pending={pending} onClose={onClose} onSettings={onSettings} onCheck={async () => {
    const result = await api("/projects/open", { workspace: pending.workspace, add: adding, activate });
    if (result.approval) {
      setPending({workspace: result.workspace, grant: result.approval});
      return;
    }
    await onOpened(result.workspace);
  }} />;
  return (
    <Modal
      title={activate ? "Open project" : "Choose a working project"}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <span className="save-note">
            {busy
              ? submitting ? removeTarget ? "Removing the project…" : "Connecting to the project…" : status.job?.message
              : adding ? "Add to the Cage project list" : "Use an authorized Cage project"}
          </span>
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            form="open-project"
            type="submit"
            disabled={!path.trim() || busy || sharing || Boolean(removeTarget) || !status.ready}
          >
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <FolderOpen size={15} />
            )}
            {activate ? "Open project" : "Use this project"}
          </button>
        </>
      }
    >
      <form
        id="open-project"
        className="modal-body project-form"
        onSubmit={open}
      >
        <p>{activate ? remote ? "Choose an existing project, or add a cloud project folder." : "Choose an existing project, or add a local project folder." : "Choose a working directory from the Cage project list. New projects are authorized and shared by Cage."}</p>
        {canShare && <>
          <button type="button" className="quiet-button project-picker-add" onClick={() => { setSharing(!sharing); setWriteAccess(false); }} disabled={busy} aria-expanded={sharing}>
            <FolderOpen size={16} />Share a local project…
          </button>
          {sharing && <fieldset className="project-picker-list project-permissions" disabled={busy}>
            <legend>Share with {context.name || "the current cloud Cage"}</legend>
            <p className="field-help">The cloud reads the project on demand. Credentials, Git metadata and links are restricted. Sharing ends when the connection is closed.</p>
            <label><input type="checkbox" checked={writeAccess} onChange={(e) => setWriteAccess(e.target.checked)} />Allow the cloud to modify and delete local project files</label>
            <button type="button" onClick={share}>Choose a local folder…</button>
          </fieldset>}
        </>}
        {!sharing && !adding && <>
          <fieldset className="project-picker-list" disabled={busy || Boolean(removeTarget)}>
            <legend>Cage projects</legend>
            {projectList.map((project) => <label className={`project-picker-item ${path === project ? "selected" : ""}`} key={project}>
              <input type="radio" name="project" value={project} checked={path === project} onChange={() => { setPath(project); setError(""); }} />
              <FolderOpen size={18} aria-hidden="true" />
              <span>
                <strong>{project === status.environment_directory ? "Default workspace" : projectName(project)}</strong>
                <small>{shares.find((s) => s.guest_path === project)?.path || project}</small>
                {status.project_errors?.some((item) => item.path === project) && <small>Needs to reconnect. Select it and try again.</small>}
              </span>
            </label>)}
          </fieldset>
          {selectedShare && <button type="button" disabled={submitting} onClick={() => revoke(selectedShare)}>Stop sharing the local project ({selectedShare.readonly ? "read-only" : "read-write"})</button>}
          {activate && !selectedShare && path && path !== status.environment_directory && !removeTarget && <button type="button" className="quiet-button" disabled={busy} onClick={() => { setRemoveTarget(path); setError(""); setRecovery(""); }}>Remove this project from Cage</button>}
          {removeTarget && <section className="project-picker-list" aria-label="Confirm project removal">
            <p>Removing "{projectName(removeTarget)}" stops sharing the directory. The original files and session history are kept, and the history is available again if you add the same directory later.</p>
            <p className="field-help">Save your files first, and close this project's terminals, running sessions and editor. Removing the current project selects the default workspace.</p>
            <button type="button" disabled={busy} onClick={() => { setRemoveTarget(""); setError(""); }}>Cancel removal</button>
            <button type="button" disabled={busy} onClick={remove}>Confirm project removal</button>
          </section>}
          <button type="button" className="quiet-button project-picker-add" onClick={add} disabled={busy || Boolean(removeTarget) || !status.ready}><Plus size={16} />{remote ? "Add a cloud project…" : "Add a local project…"}</button>
        </>}
        {!sharing && adding && <>
          {projects.length > 0 && <button type="button" className="quiet-button project-picker-add" disabled={busy} onClick={() => { setAdding(false); setPath(status.workspace || projects[0]); setError(""); }}>Back to existing projects</button>}
          <label htmlFor="project-path">New project folder</label>
          <div className="folder-input">
          <input
            id="project-path"
            autoFocus
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
              setError("");
            }}
            placeholder={remote ? "/home/cage/Projects/my-project" : isWindows ? "C:/Users/your-name/Projects/my-project" : isMac ? "/Users/your-name/Projects/my-project" : "/home/your-name/Projects/my-project"}
            disabled={busy}
            spellCheck="false"
            autoComplete="off"
          />
          {(remote || nativeAvailable()) && (
            <button type="button" onClick={choose} disabled={busy || browsing}>
              {browsing ? "Reading…" : remote ? "Browse cloud folders…" : "Choose a folder…"}
            </button>
          )}
          </div>
          {remote && directories && <section className="remote-directory-picker" aria-label="Cloud folders">
            <div className="remote-directory-heading"><strong>{directories.path}</strong><button type="button" disabled={browsing} onClick={() => setDirectories(null)}>Collapse</button></div>
            <div className="remote-directory-list">
              {directories.parent && <button type="button" disabled={browsing} onClick={() => browse(directories.parent)}>Back to the parent folder</button>}
              {directories.directories?.map((directory) => <button type="button" key={directory.path} disabled={browsing} onClick={() => browse(directory.path)}><FolderOpen size={16} />{directory.name}</button>)}
              {directories.directories?.length === 0 && <p className="field-help">This directory has no folders to browse.</p>}
            </div>
            <button type="button" disabled={browsing || !directories.selectable} onClick={() => { setPath(directories.path); setDirectories(null); }}>Choose this cloud folder</button>
          </section>}
        </>}
        <p className="field-help">
          {remote ? "Cloud projects are stored on the server." : "Changes in this folder sync to this computer."} All projects share the Cage environment, and existing terminals and web pages keep running.
        </p>
        {!status.ready && <p className="field-help">Projects can be added or opened once the environment is ready. Existing projects can still be removed from the list.</p>}
        {error && (
          <div className="error-message" role="alert">
            <SafetyMessage message={error} />
            {recovery && <ProjectRecovery recovery={recovery} disabled={busy} onRetry={() => void open()}
              onSettings={onSettings} onSessionClosed={() => void open()} />}
          </div>
        )}
      </form>
    </Modal>
  );
}
