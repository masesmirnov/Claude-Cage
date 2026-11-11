import React, { useEffect, useState } from "react";
import { api } from "./api";
import { SafetyMessage } from "./safety-message";

export function EnvironmentVersions({ status, onConfirm }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(false), [starting, setStarting] = useState(false);
  const refresh = async () => {
    setLoading(true);
    try { setData(await api("/environment/versions")); setError(""); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let live = true;
    setLoading(true);
    api("/environment/versions")
      .then((next) => { if (live) { setData(next); setError(""); } })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [status.vm_running, status.job?.running]);
  const busy = Boolean(status.job?.running) || starting;
  const update = async (tools) => {
    if (!(await onConfirm({
      title: tools ? "Update environment tools?" : "Update environment components?",
      body: data?.maintenance?.native
        ? "Save your work and end any running terminals and Claude Code turns first. The update restarts the browser, editor and file share connections; chat history, project files and sign-in data are kept." + (data.maintenance.guest_system === "windows-11" ? " Confirm the host management authorization in the system prompt and verify the administrator account bound to the guest." : "")
        : "Save the contents of the browser and editor first. The browser and editor restart briefly, and terminals inside the editor may end; workbench terminals, project files and sign-in state are kept.",
      confirm: tools ? "Update tools" : "Update components",
    }))) return;
    setStarting(true); setError("");
    try { await api(tools ? "/environment/tools" : "/environment/update", {}); }
    catch (e) { setError(e.message); }
    finally { setStarting(false); }
  };
  const componentLabels = { current: "Up to date", update_required: "Update required", stopped: "Environment stopped", unknown: "Cannot confirm right now" };
  const toolNames = { chromium: "Browser", code_server: "File editor", claude: "Claude Code", mise: "Tool version manager", node: "Node.js", python: "Python", git: "Git", gh: "GitHub CLI", proxy: "Proxy core" };
  return (
    <section className="environment-versions" aria-label="Environment versions">
      <h4>Versions and components</h4>
      <div className="setting-summary-row"><span>Control service</span><strong>{data?.controller?.version || "—"}</strong></div>
      <div className="setting-summary-row"><span>Environment components</span><strong>{componentLabels[data?.components?.status] || (loading ? "Reading…" : "Cannot confirm right now")}</strong></div>
      {data?.tools && <table className="environment-tool-table">
        <thead><tr><th>Tool</th><th>Current version</th><th>Managed version</th></tr></thead>
        <tbody>{Object.entries(toolNames).filter(([key]) => data.tools[key]).map(([key, name]) => <tr key={key}><td>{name}</td><td>{data.tools[key]?.current || "—"}</td><td>{data.tools[key]?.required || "—"}</td></tr>)}</tbody>
      </table>}
      {(error || data?.error) && <p role="alert" className="error-message"><SafetyMessage message={error || data.error} /></p>}
      <div className="environment-version-actions">
        <button disabled={loading || busy} onClick={refresh}>{loading ? "Reading…" : "Refresh versions"}</button>
        {data?.components?.update_required && <button className="primary" disabled={busy || !status.vm_running} onClick={() => update(false)}>Update environment components</button>}
        <button disabled={busy || !data?.tools_update_allowed} onClick={() => update(true)}>Update environment tools</button>
      </div>
      <p className="field-help">{data?.maintenance?.native
        ? "Running terminals and Claude Code turns must end before a native component update. The system disk, projects and account data are kept, and paused internet access stays paused. The host prepares and verifies the tool package before passing it to the guest."
        : "A component update keeps the virtual disk and terminals. A tool update needs the environment started and components synced first; dependencies download through the selected proxy, no business network needs to be allowed, and paused internet access is not resumed automatically."}</p>
    </section>
  );
}
