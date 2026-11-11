import React, { useEffect, useRef, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { api } from "./api";
import { isRemoteClient } from "./client-context.mjs";
import { Modal } from "./views";

export function HostGitPreparation({ onClose, onReady }) {
  const machine = isRemoteClient() ? "the cloud host" : "this computer";
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const check = async (enable = false) => {
    setBusy(true);
    setError("");
    try {
      const next = await api(
        "/host/git",
        enable ? { confirm: true } : undefined,
      );
      if (!alive.current) return;
      setState(next);
      if (next.ready) onReady();
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    check();
    return () => {
      alive.current = false;
    };
  }, []);
  // The welcome page shows progress; open a dialog only when input is needed.
  if (!state && !error) return null;
  return (
    <Modal
      title={`Protect Git on ${machine} before starting`}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button disabled={busy} onClick={onClose}>
            Not now
          </button>
          <button disabled={busy} onClick={() => check()}>
            Check again
          </button>
          {state?.can_enable && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => check(true)}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <ShieldCheck size={16} />
              )}
              Enable protection and continue
            </button>
          )}
        </>
      }
    >
      <div className="modal-body host-git-preparation">
        {busy && !state ? (
          <p role="status">Checking Git on {machine}; no settings have been changed yet…</p>
        ) : (
          <>
            <p>{state?.message}</p>
            {state?.can_enable && (
              <>
                <p>
                  Claude can modify shared files. With this protection on, Git on {machine}
                  ignores bare repositories you have not explicitly specified, so configuration in a shared folder cannot run commands on
                  {machine}.
                </p>
                <p>
                  Clicking "Enable protection and continue" changes one global Git setting for the current user on {machine}:
                </p>
                <pre>git config --global safe.bareRepository explicit</pre>
                <p>
                  Regular <code>.git</code>{" "}
                  projects, commits and remote addresses stay unchanged. For bare repositories, specify them explicitly with{" "}
                  <code>--git-dir</code>. The setting also affects other tools that use Git on
                  {machine}.
                </p>
              </>
            )}
            {!state?.can_enable && !error && (
              <p>After finishing the installation or repair, click "Check again". You do not need to reconfigure the proxy.</p>
            )}
          </>
        )}
        {error && (
          <p className="start-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
