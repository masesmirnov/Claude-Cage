import React, { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { native } from "./api";

const read = () => ({ shown: Boolean(window.cageWindowControls), maximized: Boolean(window.cageWindowMaximized) });

export function WindowControls() {
  const [state, setState] = useState(read);
  useEffect(() => {
    if (!window.chrome?.webview) return;
    const sync = () => setState(read());
    window.addEventListener("cage-window-visibility", sync);
    native("window", { operation: "controls" }).catch(() => {});
    return () => window.removeEventListener("cage-window-visibility", sync);
  }, []);
  useEffect(() => { document.documentElement.toggleAttribute("data-window-controls", state.shown); }, [state.shown]);
  if (!state.shown) return null;
  const send = operation => () => { native("window", { operation }).catch(() => {}); };
  return <>
    <div className="window-drag" />
    <div className="window-controls">
      {!state.maximized && <span className="window-resize" onPointerDown={send("resize")} />}
      <button aria-label="Minimize" onClick={send("minimize")}><Minus size={16} /></button>
      <button aria-label={state.maximized ? "Restore" : "Maximize"} onClick={send("maximize")}>{state.maximized ? <Copy size={13} /> : <Square size={12} />}</button>
      <button className="window-close" aria-label="Close" onClick={send("close")}><X size={16} /></button>
    </div>
  </>;
}
