import React, { useState } from "react";
import { api } from "./api";
import { Modal } from "./modal";
import { SafetyMessage } from "./safety-message";
import "./device-checks.css";

const labels = { passed: "Passed", failed: "Failed", unknown: "Not observed", warning: "Needs attention", observed: "Observed" };
const renderers = { software: "Software rendering", "virtual-gpu": "Virtual GPU", "driver-reported": "Driver-reported renderer", unobserved: "Not observed" };

export function DeviceChecks({ target, disabled = false }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(selected) {
    setBusy(true); setError(""); setReport(null);
    try { setReport(await api("/environment/device-check", { target: selected })); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section className="device-checks" aria-label="Device configuration and rendering checks">
    <h4>Device configuration and rendering checks</h4>
    <p>Checks the actual configuration, browser identity and graphics capabilities. The results help find mismatches and do not certify a physical device or anonymity.</p>
    <div className="device-check-actions">
      {(!target || target === "browser") && <button disabled={busy || disabled} onClick={() => run("browser")}>{busy ? "Checking…" : "Check browser"}</button>}
      {(!target || target === "desktop") && <button disabled={busy || disabled} onClick={() => run("desktop")}>{busy ? "Checking…" : "Check Claude Desktop"}</button>}
    </div>
    {error && <p role="alert"><SafetyMessage message={error} /></p>}
    {report && <div aria-live="polite">
      <p>{report.target === "desktop" ? "Claude Desktop" : "Browser"} · {new Date(report.checked_at).toLocaleString()}</p>
      {report.renderer_class && <p>Actual graphics environment:{renderers[report.renderer_class] || "Not observed"}</p>}
      {report.browser && <details><summary>Actual browser values</summary><dl>
        <dt>User Agent</dt><dd>{report.browser.user_agent}</dd>
        <dt>Graphics renderer</dt><dd>{report.browser.webgl.renderer || "Not observed"}</dd>
        <dt>Display size</dt><dd>{report.browser.screen.width} × {report.browser.screen.height}, pixel ratio {report.browser.screen.pixel_ratio}</dd>
        <dt>Diagnostic document viewport</dt><dd>{report.browser.viewport.width} × {report.browser.viewport.height}</dd>
      </dl></details>}
      <ul className="device-check-results">{report.checks.map(check => <li key={check.id} data-state={check.state}><strong>{check.title}</strong><span>{labels[check.state] || "Not observed"}</span><p>{check.evidence}</p></li>)}</ul>
    </div>}
  </section>;
}

export function DeviceCheckButton({ target = "desktop", disabled = false }) {
  const [open, setOpen] = useState(false);
  return <><button disabled={disabled} onClick={() => setOpen(true)}>Check environment</button>{open && <Modal title="Device configuration and rendering checks" onClose={() => setOpen(false)}><div className="modal-body"><DeviceChecks target={target} /></div></Modal>}</>;
}
