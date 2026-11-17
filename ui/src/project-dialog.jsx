import { isWindows, isMac } from "./platform.mjs";
import React, { useEffect, useState } from "react";
import { FolderMinus, FolderOpen, LoaderCircle, PencilLine, Plus } from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import { SafetyMessage } from "./safety-message";
import { Modal } from "./views";
import { MacOSProjectApproval } from "./macos-project-approval";
import { ProjectRecovery } from "./project-recovery";
import { projectGroups, projectName, rememberClientProjectName } from "./workspace-state.mjs";
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
  const groups = projectGroups(status);
  const projects = groups.map(group => group.workspace);
  const initialGroup = groups.find(group => group.folders.includes(initialPath));
  const [adding, setAdding] = useState(Boolean(initialPath && !initialGroup) || projects.length === 0);
  const [path, setPath] = useState(initialGroup?.workspace || initialPath || groups.find(group => group.folders.includes(status.workspace))?.workspace || projects[0] || "");
  const [editing, setEditing] = useState("");
  const [name, setName] = useState("");
  const [folders, setFolders] = useState([]);
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
      if (path === item.guest_path) setPath(status.workspace || "");
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };
  const projectList = [...new Set([...projects, ...shares.map((s) => s.guest_path)])].filter(project => !removed.includes(project));
  const displayName = value => projectName(value, groups);
  const selectedGroup = groups.find(group => group.workspace === path);
  const draftFolders = [...new Set([...folders, ...(path.trim() ? [path.trim()] : [])])];
  const appendFolder = value => {
    const folder = value.trim();
    if (!folder) return;
    setFolders(previous => [...new Set([...previous, folder])]);
    setName(previous => previous || projectName(folder));
    setPath(""); setError("");
  };
  const edit = () => {
    if (!selectedGroup) return;
    setEditing(selectedGroup.workspace); setName(selectedGroup.name);
    setFolders(selectedGroup.folders); setPath(""); setAdding(true); setError("");
  };
  const selectedShare = shares.find((item) => item.guest_path === path);
  const busy = submitting || Boolean(status.job?.running);
  const remove = async () => {
    if (busy || !removeTarget) return;
    setSubmitting(true); setError("");
    try {
      const result = await api("/projects/remove", { workspace: removeTarget });
      setRemoved(previous => [...previous, removeTarget]);
      setPath(result.workspace || "");
      if (!result.workspace) setAdding(true);
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
    setBrowsing(true);
    try {
      const selected = await native("chooseFolder");
      if (selected) {
        appendFolder(selected);
      }
    } catch {
      setError("Could not choose a folder. Enter the path directly.");
    } finally {
      setBrowsing(false);
    }
  };
  const add = () => {
    setAdding(true);
    setEditing(""); setName(""); setFolders([]);
    setPath("");
    setError("");
    if (remote) void browse("");
    else if (nativeAvailable()) void choose();
  };
  const performOpen = async () => {
    let workspace = path.trim();
    if (adding) {
      const saved = await api("/projects/save", {
        workspace: editing, name: name.trim() || projectName(draftFolders[0]), folders: draftFolders,
      });
      if (saved.approval) {
        setPending({ workspace: saved.workspace, grant: saved.approval });
        return;
      }
      workspace = saved.workspace;
      setEditing(saved.workspace);
    }
    const result = await api("/projects/open", { workspace, add: false, activate });
    if (result.approval) setPending({ workspace: result.workspace, grant: result.approval });
    else await onOpened(result.workspace);
  };
  const open = async (event) => {
    event?.preventDefault();
    if (busy || sharing || removeTarget || !status.ready || !(adding ? draftFolders.length : path.trim())) return;
    setSubmitting(true);
    setError("");
    setRecovery("");
    try {
      await performOpen();
    } catch (e) {
      setError(e.message);
      setRecovery(e.recovery || "");
    } finally {
      setSubmitting(false);
    }
  };
  if (pending) return <MacOSProjectApproval pending={pending} onClose={onClose} onSettings={onSettings} onCheck={async () => {
    await performOpen();
  }} />;
  return (
    <Modal
      title={adding ? editing ? "Edit project" : "Create project" : activate ? "Open project" : "Choose a work project"}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <span className="save-note">
            {busy
              ? submitting ? removeTarget ? "Removing the project…" : "Connecting to the project…" : status.job?.message
              : adding ? editing ? "Session history is kept" : "The first folder is the default folder" : "Use an authorized Cage project"}
          </span>
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            form="open-project"
            type="submit"
            disabled={!(adding ? draftFolders.length : path.trim()) || busy || sharing || Boolean(removeTarget) || !status.ready}
          >
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <FolderOpen size={15} />
            )}
            {adding ? editing ? "Save project" : "Create project" : activate ? "Open project" : "Use this project"}
          </button>
        </>
      }
    >
      <form
        id="open-project"
        className="modal-body project-form"
        onSubmit={open}
      >
        <p>{adding ? "Name the project and add the folders you need to use together." : activate ? "Choose a project to open, or add a new one." : "Choose a working folder from the Cage project list. New projects are authorized and shared by Cage."}</p>
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
            <legend>Projects</legend>
            {projectList.map((project) => <div className={`project-picker-row ${path === project ? "selected" : ""}`} key={project}>
              <label className="project-picker-item">
                <input type="radio" name="project" value={project} checked={path === project} onChange={() => { setPath(project); setError(""); }} />
                <FolderOpen size={18} aria-hidden="true" />
                <span>
                  <strong>{displayName(project)}</strong>
                  <small>{shares.find((s) => s.guest_path === project)?.path || groups.find(g => g.workspace === project)?.folders.join(" · ") || project}</small>
                  {status.project_errors?.some((item) => (groups.find(group => group.workspace === project)?.folders || [project]).includes(item.path)) && <small>Needs to reconnect; choose it and try again</small>}
                </span>
              </label>
              {path === project && !selectedShare && !removeTarget && <div className="project-picker-actions">
                {selectedGroup && <button type="button" className="icon-button" aria-label="Edit name and folders…" disabled={busy || !status.ready} onClick={edit}><PencilLine size={16} aria-hidden="true" /></button>}
                {activate && <button type="button" className="icon-button project-picker-remove" aria-label="Remove this project from Cage" disabled={busy} onClick={() => { setRemoveTarget(path); setError(""); setRecovery(""); }}><FolderMinus size={16} aria-hidden="true" /></button>}
              </div>}
            </div>)}
          </fieldset>
          {selectedShare && <button type="button" disabled={submitting} onClick={() => revoke(selectedShare)}>Stop sharing the local project ({selectedShare.readonly ? "read-only" : "read-write"})</button>}
          {removeTarget && <section className="project-picker-list" aria-label="Confirm project removal">
            <p>Removing "{displayName(removeTarget)}" stops sharing all bound folders. The original files and session history are kept, and you can keep using the history after adding the same folder again.</p>
            <p className="field-help">Save your files and close this project's terminals, running sessions and editor first. After removing the current project, a remaining project is selected; after removing the last project, you can add folders again.</p>
            <button type="button" disabled={busy} onClick={() => { setRemoveTarget(""); setError(""); }}>Cancel removal</button>
            <button type="button" disabled={busy} onClick={remove}>Confirm project removal</button>
          </section>}
          <button type="button" className="quiet-button project-picker-add" onClick={add} disabled={busy || Boolean(removeTarget) || !status.ready}><Plus size={16} />{remote ? "Add a cloud project…" : "Add a local project…"}</button>
        </>}
        {!sharing && adding && <>
          {projects.length > 0 && <button type="button" className="quiet-button project-picker-add" disabled={busy} onClick={() => { setAdding(false); setEditing(""); setFolders([]); setPending(null); setPath(groups.find(group => group.folders.includes(status.workspace))?.workspace || projects[0]); setError(""); }}>Back to existing projects</button>}
          <label htmlFor="project-name">Project name</label>
          <input id="project-name" autoFocus value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder="For example: Course system" disabled={busy} />
          <label>Source folders</label>
          {folders.length > 0 && <ul className="project-folder-list" aria-label="Bound folders">
            {folders.map((folder, index) => <li key={folder}>
              <FolderOpen size={16} aria-hidden="true" /><span><strong>{projectName(folder)}</strong><small>{folder}</small></span>
              {index === 0 && <small className="project-folder-default">Default</small>}
              <button type="button" disabled={busy || folder === editing} aria-label={`Remove folder ${projectName(folder)}`} title={folder === editing ? "The default folder links session history and must be kept" : "Unbind folder"} onClick={() => setFolders(previous => previous.filter(value => value !== folder))}>Remove</button>
            </li>)}
          </ul>}
          <label htmlFor="project-path">Add folder</label>
          <div className="folder-input">
          <input
            id="project-path"
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
          {path.trim() && <button type="button" disabled={busy} onClick={() => appendFolder(path)}>Add</button>}
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
            <button type="button" disabled={browsing || !directories.selectable} onClick={() => { appendFolder(directories.path); setDirectories(null); }}>Choose this cloud folder</button>
          </section>}
        </>}
        {adding && <p className="field-help">Claude starts from the default folder and can read and write the other bound folders. After changing bindings, the change takes effect for new or reopened sessions.{editing && "The default folder links session history and must be kept. Before unbinding, close the project's terminals, running sessions and editor."}</p>}
        <p className="field-help project-picker-note">
          <span>{remote ? "Cloud projects are stored on the server." : "Changes in bound folders are written directly to this computer."}</span>
          <span>All projects share the Cage environment, and existing terminals and web pages keep running.</span>
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
