import React, { useEffect, useState } from "react";
import { ArrowDownToLine, LoaderCircle } from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import { reportDiagnostic } from "./diagnostics.mjs";
import { isRemoteClient, runtimeURL } from "./client-context.mjs";

export function DiagnosticSettings() {
  const remote = isRemoteClient();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api("/diagnostics").then(value => { if (live) setInfo(value); })
      .catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, []);
  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      if (nativeAvailable()) {
        const result = await native("exportDiagnostics");
        if (!result?.canceled) setNotice("Diagnostics bundle saved. Review its contents before sharing.");
      } else {
        // Fetch before downloading so authentication or disk failures are shown.
        const response = await fetch(runtimeURL("/diagnostics/export"));
        if (!response.ok) throw new Error((await response.text()).trim() || "Diagnostics bundle export failed.");
        if (!response.headers.get("content-type")?.startsWith("application/zip")) throw new Error("The current backend does not support diagnostics export. Reopen Cage.");
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a"); link.href = url; link.download = "cage-diagnostics.zip"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setNotice("Diagnostics bundle downloaded. Review its contents before sharing.");
      }
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  return <section className="settings-group" aria-label="Logs and diagnostics">
    <h3>Logs and diagnostics</h3>
    <p className="footnote">App failures are recorded automatically with sensitive data redacted, and kept for 14 days. Each backend log is capped at 40 MiB, with a 10 MiB budget for environment services. The diagnostics bundle collects records from both the desktop connection and the current environment, up to 96 MiB, limited to failure logs and runtime status.</p>
    {info && <p className="footnote">{remote ? "Server" : "Local"} logs {(info.bytes / 1024 / 1024).toFixed(1)} MiB · {info.files} files</p>}
    <button className="secondary-button" disabled={busy} onClick={save}>
      {busy ? <LoaderCircle size={14} className="spin" /> : <ArrowDownToLine size={14} />}
      {busy ? "Exporting…" : remote ? "Export server diagnostics bundle" : "Export diagnostics bundle"}
    </button>
    <p className="footnote">{remote ? "The diagnostics bundle includes redacted logs, versions and collection status from the local UI and the current cloud host, so the remote connection must stay up. It is saved to the local location you choose after export." : "The diagnostics bundle includes redacted logs, versions and collection status from the UI and the environment, and local records can still be exported while the environment is offline. It is saved only where you choose."}</p>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
  </section>;
}

export class DiagnosticBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { reportDiagnostic("react", new Error(`${error.message}\n${error.stack || ""}\n${info.componentStack || ""}`)); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main style={{ padding: 32 }}>
      <h2>The workbench ran into a display error</h2>
      <p>Background tasks can keep running. You can export a diagnostics bundle, then reload the interface.</p>
      <DiagnosticSettings />
      <button className="primary-button" onClick={() => location.reload()}>Reload interface</button>
    </main>;
  }
}
