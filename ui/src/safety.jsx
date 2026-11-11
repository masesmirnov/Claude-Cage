import React, { useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Check,
  CircleHelp,
  X,
  LoaderCircle,
  ArrowUpRight,
  Copy,
  Settings,
  ChevronDown,
} from "lucide-react";
import { api, writeClipboard } from "./api";
import { Modal } from "./views";
import { networkState, reportForSharing } from "./safety-state.mjs";

const diagnostics = [
  {
    name: "IP quality",
    source: "ip.net.coffee",
    url: "https://ip.net.coffee/claude/",
    description: "View IP attributes, ASN, reputation score and network diagnostics.",
  },
  {
    name: "Browser information",
    source: "fuck-claude.com",
    url: "https://fuck-claude.com/",
    description: "View the community's assessment of browser signals such as time zone, language and fonts.",
  },
];

export async function bindDetectedMacOSExit(ip, onConfirm) {
  if (!(await onConfirm({ title: "Bind the fixed exit?", body: `The guest terminal, browser and proxy all measured ${ip}. After saving, restart the guest and check again.`, confirm: "Bind fixed exit" }))) return null;
  return api("/macos/exit-policy", { ip });
}

export function SafetyPanel({
  status,
  onClose,
  onSettings,
  onOpenPage,
  onConfirm,
}) {
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const network = networkState(status),
    safety = status.safety || {},
    report = safety.report;
  const busy = Boolean(status.job?.running),
    online = network.mode === "open";
  const passed =
    report?.checks?.filter((c) => c.critical && c.state === "passed").length ||
    0;
  const total = report?.checks?.filter((c) => c.critical).length || 0;
  const run = async () => {
    setError("");
    if (
      status.vm_running &&
      !safety.gate &&
      !(await onConfirm({
        title: "Restart the environment and load the check components?",
        body: "The current terminal sessions will end. Save your files first; browser sign-ins and project files are kept.",
        confirm: "Restart and check",
      }))
    )
      return;
    try {
      await api(status.ready && safety.gate ? "/safety/check" : "/start", {});
    } catch (e) {
      setError(e.message);
    }
  };
  const pause = async () => {
    setError("");
    try {
      await api("/safety/close", {});
    } catch (e) {
      setError(e.message);
    }
  };
  const copy = async () => {
    try {
      await writeClipboard(JSON.stringify(reportForSharing(report), null, 2));
      setNotice("Report copied, without proxy credentials, IP addresses or local paths");
    } catch {
      setError("Could not write to the local clipboard. Check the browser's clipboard permission.");
    }
  };
  const open = async (url) => {
    if (await onOpenPage(url)) onClose();
  };
  return (
    <Modal
      title="Network and isolation checks"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="save-note">
            {busy ? status.job.message : "While internet access is off, offline terminals and files remain usable"}
          </span>
          {(online || network.mode === "checking") && (
            <button onClick={pause}>
              {network.mode === "checking" ? "Cancel the check and turn internet access off" : "Pause internet access"}
            </button>
          )}
          <button className="primary" disabled={busy} onClick={run}>
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <ShieldCheck size={15} />
            )}
            {busy
              ? "Check in progress"
              : online
                ? "Pause internet access and check again"
                : status.ready && safety.gate
                  ? "Check again"
                  : status.vm_running
                    ? "Restart and check"
                    : "Start and check"}
          </button>
        </>
      }
    >
      <div className="modal-body safety-body">
        {safety.macos_exit_candidate?.ip && <button disabled={busy} onClick={async () => {
          try { if (await bindDetectedMacOSExit(safety.macos_exit_candidate.ip, onConfirm)) setNotice("The fixed exit was submitted. Once saving finishes, restart the guest and check again."); }
          catch (e) { setError(e.message); }
        }}>Bind the detected fixed exit {safety.macos_exit_candidate.ip}</button>}
        <div className={`safety-summary ${network.mode}`}>
          {online ? (
            <ShieldCheck size={27} />
          ) : network.mode === "checking" ? (
            <LoaderCircle size={27} className="spin" />
          ) : (
            <ShieldAlert size={27} />
          )}
          <div>
            <h3>{network.label}</h3>
            <p>
              {busy
                ? status.job.message
                : online
                  ? status.network_error || "Critical checks passed. The backend keeps verifying the exit rules and environment configuration."
                  : status.network_error || safety.error ||
                    safety.gate?.reason ||
                    "Connecting to external sites is allowed only after the critical checks are completed."}
            </p>
          </div>
          <button className="text-button" onClick={() => onSettings("network")}>
            <Settings size={15} />
            Exit rules
          </button>
        </div>
        {(error || notice) && (
          <div
            role="status"
            className={error ? "error-message" : "inline-info"}
          >
            {error || notice}
          </div>
        )}
        <div className="safety-section-heading">
          <h4>Critical checks</h4>
          <span>{total ? `${passed} / ${total} passed` : "No check records yet"}</span>
          {report && (
            <button className="text-button" onClick={copy}>
              <Copy size={14} />
              Copy report
            </button>
          )}
        </div>
        {report ? (
          <>
            <p className="safety-timestamp">
              Checked on {new Date(report.created_at).toLocaleString("en-US")} ·{" "}
              {online ? "Current running instance" : "The report does not mean internet access is currently allowed"}
            </p>
            <div className="safety-checks">
              {report.checks
                .filter((check) => check.critical)
                .map((check) => {
                  const Icon =
                    check.state === "passed"
                      ? Check
                      : check.state === "failed"
                        ? X
                        : CircleHelp;
                  return (
                    <details
                      className={`safety-check ${check.state}`}
                      key={check.id}
                    >
                      <summary>
                        <Icon size={16} />
                        <strong>{check.title}</strong>
                        <span>
                          {check.state === "passed"
                            ? "Passed"
                            : check.state === "failed"
                              ? "Failed"
                              : busy && check.checked_at === report.created_at
                                ? "To check"
                                : "Unknown"}
                        </span>
                        <ChevronDown size={14} />
                      </summary>
                      <div>
                        <p>{check.evidence}</p>
                        {check.state !== "passed" && check.remedy && (
                          <p className="check-remedy">{check.remedy}</p>
                        )}
                      </div>
                    </details>
                  );
                })}
            </div>
          </>
        ) : (
          <p className="safety-empty">
            The checks cover outbound rules, proxy fail-closed behavior, DNS, shared directories, host management interfaces, and the actual system and browser configuration. When a critical item fails or is unknown, internet access stays off.
          </p>
        )}
        {report?.checks?.some((check) => !check.critical) && (
          <div className="safety-advisories">
            {report.checks
              .filter((check) => !check.critical)
              .map((check) => (
                <p key={check.id}>
                  <CircleHelp size={15} />
                  <span>
                    <strong>{check.title}:</strong>{" "}
                    {check.evidence}
                  </span>
                </p>
              ))}
          </div>
        )}
        <div className="safety-section-heading">
          <h4>Community detection (supplementary)</h4>
          <span>Hints only; they do not gate internet access</span>
        </div>
        <div className="diagnostic-sites">
          {diagnostics.map((site) => (
            <div key={site.url}>
              <strong>{site.name}</strong>
              <small>{site.source}</small>
              <p>{site.description}</p>
              <button disabled={!online || busy} onClick={() => open(site.url)}>
                Open in Cage
                <ArrowUpRight size={14} />
              </button>
            </div>
          ))}
        </div>
        <p className="field-help">
          Third-party sites are accessed only after you click. The site receives Cage's exit
          IP and can read the browser information available to that page. Scores are community references.
        </p>
        <details className="safety-scope">
          <summary>Scope and sources of the checks</summary>
          <p>
            This version verifies the IPv4 exit, and the guest's public IPv6 and UDP are off. Exit monitoring runs about every 30
            seconds; the location comes from an IP
            database, so city-level results can be off. How the proxy itself routes by destination still has to be constrained on the proxy side.
          </p>
          <p>
            The report contains runtime policy and sampling evidence. It cannot replace a full virtualization audit and does not indicate platform account eligibility or predict bans. A full check is valid for
            24 hours; after the control service is lost, internet authorization is kept for at most 90 seconds.
          </p>
          <div className="safety-sources">
            <span>Method references</span>
            <button
              className="text-button"
              disabled={!online}
              onClick={() =>
                open("https://github.com/YOURSJEYO/claude-switcher")
              }
            >
              claude-switcher
              <ArrowUpRight size={12} />
            </button>
            <button
              className="text-button"
              disabled={!online}
              onClick={() =>
                open("https://github.com/DUNHKpcc/Claude-Guardian")
              }
            >
              Claude-Guardian
              <ArrowUpRight size={12} />
            </button>
          </div>
        </details>
      </div>
    </Modal>
  );
}
