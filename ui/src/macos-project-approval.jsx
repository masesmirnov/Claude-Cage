import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Modal } from "./modal";
import { MacOSLogin } from "./macos-login";
import "./macos-project-approval.css";

const permissionMessages = {
  project_screen_permission: "Cannot show the folder authorization window. In the virtual Mac, go to System Settings → Privacy & Security → Screen & System Audio Recording, allow Cage Guest Window, and reopen the helper as the system prompts.",
  accessibility_permission: "Cannot click the folder authorization window. In the virtual Mac, go to System Settings → Privacy & Security → Accessibility, allow Cage Guest Window, then try again.",
  requires_gui_login: "Sign in to and unlock the virtual Mac's regular account first, then reopen the project.",
};

export function InitializationProjectApproval({ workspace, jobRunning, onClose, onApproved = onClose }) {
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const approved = useRef(onApproved);
  approved.current = onApproved;

  useEffect(() => {
    if (jobRunning || pending || error) return;
    let live = true, timer;
    async function open() {
      setRequesting(true);
      try {
        const result = await api("/projects/open", { workspace, add: false, activate: false });
        if (!live) return;
        if (result.approval) setPending({ workspace: result.workspace, grant: result.approval });
        else approved.current();
      } catch (e) {
        if (!live) return;
        if (e.recovery === "project-operation-busy") timer = setTimeout(open, 1200);
        else setError(e.message);
      } finally {
        if (live) setRequesting(false);
      }
    }
    open();
    return () => { live = false; clearTimeout(timer); setRequesting(false); };
  }, [workspace, jobRunning, pending, error]);

  if (pending) return <MacOSProjectApproval pending={pending} onClose={onClose} onCheck={async () => {
    const result = await api("/projects/open", { workspace, add: false, activate: false });
    if (result.approval) setPending({ workspace: result.workspace, grant: result.approval });
    else onApproved();
  }} />;
  return <Modal title="Allow the guest to access the selected project" onClose={requesting ? undefined : onClose} footer={<>
    <button disabled={requesting} onClick={onClose}>Cancel</button>
    {error && <button onClick={() => setError("")}>Request authorization again</button>}
  </>}>
    <p className="macos-approval-path">{workspace}</p>
    {error ? <p role="alert">{error}</p> : <p role="status">{jobRunning ? "The project authorization window appears once the current guest operation ends." : "Connecting to the guest's project authorization window…"}</p>}
  </Modal>;
}

export function MacOSProjectApproval({ pending, onCheck, onClose, onSettings }) {
  const [frame, setFrame] = useState(null),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [ended, setEnded] = useState(false);
  const [maintenance, setMaintenance] = useState("");
  const active = useRef(false),
    inFlight = useRef(null);
  const call = (action, fields = {}) =>
    api("/macos/project-approval", {
      workspace: pending.workspace,
      grant: pending.grant,
      action,
      ...fields,
    });

  useEffect(() => {
    let live = true,
      timer;
    async function poll() {
      if (!active.current) {
        try {
          const request = call("frame");
          inFlight.current = request;
          const result = await request;
          if (live && !active.current) {
            if (result.error === "project_screen_permission") setMaintenance("screen");
            if (result.error === "accessibility_permission") setMaintenance("input");
            const valid = Boolean(
              !result.error &&
              result.image &&
              result.window &&
              result.pid &&
              result.nonce,
            );
            setFrame(valid ? result : null);
            setNotice(
              valid
                ? ""
                : permissionMessages[result.error] || "Waiting for the virtual Mac's project authorization window. If this folder is already allowed, you can verify the authorization directly.",
            );
          }
        } catch (e) {
          if (live && !active.current) {
            setFrame(null);
            setNotice(e.message);
            if (e.recovery === "project-approval-ended") {
              setEnded(true);
              return;
            }
          }
        } finally {
          inFlight.current = null;
        }
      }
      if (live) timer = setTimeout(poll, 650);
    }
    setFrame(null);
    setEnded(false);
    setMaintenance("");
    setNotice("");
    setActionError("");
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pending.workspace, pending.grant]);

  async function act(fn) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setActionError("");
    try {
      await inFlight.current?.catch(() => {});
      await fn();
    } catch (e) {
      setFrame(null);
      if (e.recovery === "project-approval-ended") setEnded(true);
      setActionError(e.message);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const cancel = () =>
    act(async () => {
      try {
        await call("cancel");
      } catch (error) {
        if (error.recovery !== "project-approval-ended") throw error;
      }
      onClose();
    });
  const click = (event) => {
    if (!frame) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width,
      y = (event.clientY - rect.top) / rect.height;
    if (!(x >= 0 && x < 1 && y >= 0 && y < 1)) return;
    void act(async () => {
      const result = await call("click", {
        window: frame.window,
        pid: frame.pid,
        nonce: frame.nonce,
        x,
        y,
      });
      setFrame(null);
      if (result.error === "accessibility_permission") setMaintenance("input");
      if (result.error) throw new Error(permissionMessages[result.error] || "The guest authorization window has changed. Wait for the new view.");
      await onCheck();
    });
  };
  return (
    <Modal
      title="Allow the guest to access the selected project"
      onClose={busy ? undefined : cancel}
      footer={
        <>
          <button disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button disabled={busy} onClick={() => act(onCheck)}>
            {ended ? "Request authorization again" : "Verify authorization"}
          </button>
        </>
      }
    >
      <p>Confirm the selected project in the macOS authorization window below.</p>
      <p className="macos-approval-path">{pending.workspace}</p>
      {frame && (
        <img
          src={"data:image/png;base64," + frame.image}
          alt="The virtual Mac's current project authorization window"
          onClick={click}
          className="macos-approval-frame"
          draggable={false}
        />
      )}
      {notice && <p role="status">{notice}</p>}
      {maintenance && !ended && <MacOSLogin maintenance={maintenance} onSettings={onSettings} onSessionClosed={() => void act(onCheck)} />}
      {actionError && <p role="alert">{actionError}</p>}
    </Modal>
  );
}
