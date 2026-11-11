import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, RefreshCw } from "lucide-react";
import { native, nativeAvailable } from "./api";

const activePhases = new Set(["checking", "downloading", "downloaded", "verifying", "installing"]);
const checkInterval = 6 * 60 * 60 * 1000;
const retryInterval = 5 * 60 * 1000;

export function useAppUpdates() {
  const [state, setState] = useState({ phase: "idle", message: "" });
  const [startupFailure, setStartupFailure] = useState("");
  const [retryClock, setRetryClock] = useState(Date.now);
  const retryAt = Date.parse(state.retryAt || "");
  const coolingDown = state.phase === "failed" && retryAt > Date.now();
  const current = useRef(state);
  current.current = state;
  const requestPending = useRef(false);
  const lastCheck = useRef(0);
  const available = nativeAvailable();
  const run = useCallback(async (operation) => {
    if (!available || requestPending.current || activePhases.has(current.current.phase)) return;
    if (["check", "install"].includes(operation) && Date.parse(current.current.retryAt || "") > Date.now()) return;
    requestPending.current = true;
    if (operation === "check") lastCheck.current = Date.now();
    if (operation === "install") setState(previous => ({ ...previous, phase: "checking" }));
    try {
      const next = await native("appUpdate", { operation });
      if (next?.phase) setState(next);
    } catch (error) {
      setState(previous => ({ ...previous, phase: "failed", message: error.message, retryable: true }));
    } finally { requestPending.current = false; }
  }, [available]);

  useEffect(() => {
    if (!coolingDown) return;
    const timer = setTimeout(() => setRetryClock(Date.now()), Math.min(60000, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [coolingDown, retryAt, retryClock]);

  useEffect(() => {
    if (!available) return;
    let live = true;
    const receive = event => {
      if (event.detail?.phase) setState(event.detail);
    };
    const check = () => {
      if (document.visibilityState === "hidden" || window.cageWindowVisible === false) return;
      const phase = current.current.phase;
      const interval = ["failed", "waiting"].includes(phase) ? retryInterval : checkInterval;
      const deadline = phase === "failed" && Number.isFinite(Date.parse(current.current.retryAt || ""))
        ? Date.parse(current.current.retryAt) : lastCheck.current + interval;
      if (["idle", "current", "failed", "waiting", "available"].includes(phase) && Date.now() >= deadline) void run("check");
    };
    window.addEventListener("cage-app-update", receive);
    window.addEventListener("focus", check);
    window.addEventListener("cage-window-visibility", check);
    document.addEventListener("visibilitychange", check);
    (async () => {
      try {
        const next = await native("appUpdate", { operation: "status" });
        if (!live) return;
        if (next?.phase === "failed") setStartupFailure(next.message || "The last app update was not completed");
        if (next?.phase) { current.current = next; setState(next); }
        if (!next || ["idle", "current", "failed", "waiting"].includes(next.phase)) void run("check");
      } catch (error) {
        if (live) setState({ phase: "failed", message: error.message, retryable: true });
      }
    })();
    const timer = setInterval(check, 60 * 1000);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("cage-app-update", receive);
      window.removeEventListener("focus", check);
      window.removeEventListener("cage-window-visibility", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [available, run]);
  useEffect(() => {
    if (!startupFailure) return;
    const timer = setTimeout(() => setStartupFailure(""), 8000);
    return () => clearTimeout(timer);
  }, [startupFailure]);
  return { state, run, available, startupFailure, coolingDown };
}

export function AppUpdateButton({ updates }) {
  const { state, run, available, startupFailure, coolingDown } = updates;
  const busy = activePhases.has(state.phase);
  const failed = state.phase === "failed";
  const visible = state.latestVersion && ["available", "ready", "failed", ...activePhases].includes(state.phase);
  const announcedFailure = useRef("");
  const [failure, setFailure] = useState("");
  useEffect(() => {
    if (failed && visible && state.message && announcedFailure.current !== state.message) {
      announcedFailure.current = state.message;
      setFailure(state.message);
    }
    if (!failed) { announcedFailure.current = ""; setFailure(""); }
  }, [failed, visible, state.message]);
  useEffect(() => {
    if (!failure) return;
    const timer = setTimeout(() => setFailure(""), 8000);
    return () => clearTimeout(timer);
  }, [failure]);
  if (!available || (!visible && !startupFailure)) return null;
  const downloading = state.phase === "downloading";
  const percent = state.totalBytes > 0
    ? Math.max(0, Math.min(100, Math.floor((state.receivedBytes || 0) / state.totalBytes * 100)))
    : null;
  const label = downloading ? `Downloading update${percent === null ? "" : ` ${percent}%`}`
    : state.phase === "verifying" || state.phase === "downloaded" ? "Verifying update"
    : state.phase === "installing" ? "Installing update; the app restarts automatically when done"
    : state.phase === "checking" ? "Preparing update"
    : coolingDown ? "Waiting to retry update" : failed ? "Retry update" : "Download update";
  const hint = coolingDown ? `${state.message || "The update source is rate-limited"}. You can retry after ${new Date(state.retryAt).toLocaleString()}`
    : failed ? `${state.message || "The update was not completed"}. Click to retry`
    : busy ? label : `Update to ${state.latestVersion}. Save your work first; clicking stops the environment, installs and restarts automatically.`;
  const circumference = 2 * Math.PI * 15;
  return (
    <>
      {visible && <button
        className={`app-update-button${busy ? " busy" : ""}${failed ? " failed" : ""}`}
        aria-label={label}
        title={hint}
        disabled={busy || coolingDown}
        onClick={() => { setFailure(""); void run("install"); }}
      >
        {busy ? (
          <>
            <svg className={`app-update-ring${downloading && percent !== null ? "" : " indeterminate"}`}
              viewBox="0 0 36 36" role="progressbar" aria-label={downloading ? "Update download progress" : label}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloading && percent !== null ? percent : undefined}>
              <circle className="app-update-ring-track" cx="18" cy="18" r="15" />
              <circle className="app-update-ring-value" cx="18" cy="18" r="15"
                strokeDasharray={circumference} strokeDashoffset={circumference * (1 - (downloading && percent !== null ? percent / 100 : 0.25))} />
            </svg>
            {downloading && percent !== null && <span className="app-update-percent">{percent}%</span>}
          </>
        ) : failed ? <RefreshCw size={20} /> : <ArrowDownToLine size={20} />}
      </button>}
      {(failure || startupFailure) && <div className="app-update-error" role="alert">{failure || startupFailure}{visible ? coolingDown ? ". Wait for the update source to recover, then retry." : ". Click the update button to retry." : ""}</div>}
    </>
  );
}
