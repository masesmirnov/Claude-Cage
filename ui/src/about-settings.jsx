import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import "./about-settings.css";

const repository = "https://github.com/Lee-xeo/Claude-Cage";
const sourceMessages = {
  current: "In sync with the main branch",
  available: "The main branch has new commits",
  ahead: "The current build commit is ahead of the main branch",
  diverged: "The current build has diverged from the main branch; check the differences",
  unknown: "This build has no commit information, so it cannot check whether it is up to date",
};
const releaseMessages = {
  current: "Already the latest release (including prereleases)",
  available: "New release found",
  ahead: "The current version is newer than the latest release",
  unknown: "The current version cannot be compared; check the release notes",
  missing: "No public release to compare yet",
};

function RepositoryLink({ kind, onError, children }) {
  const url = `${repository}/${kind === "source" ? "commits/main" : "releases"}`;
  return <a href={url} target="_blank" rel="noopener noreferrer" onClick={async event => {
    if (!nativeAvailable()) return;
    event.preventDefault();
    try { await native("appReference", { kind }); }
    catch (error) { onError(error.message); }
  }}>{children}<ExternalLink size={13} aria-hidden="true" /></a>;
}

function CheckResult({ label, item, source, onError }) {
  return <section className="about-result" aria-label={label}>
    <h4>{label}</h4>
    {!item ? <p className="footnote">Not checked yet</p> : <>
      <p className={item.error ? "error-message" : "about-result-status"}>
        {item.error || (source ? sourceMessages : releaseMessages)[item.status]}
      </p>
      {item.retryAt && <p className="footnote">Retry after {new Date(item.retryAt).toLocaleString()}</p>}
      {source && item.commit && <p className="about-result-detail">Main branch commit <code title={item.commit}>{item.commit.slice(0, 12)}</code></p>}
      {source && item.status === "available" && item.aheadBy > 0 && <p className="footnote">The main branch has {item.aheadBy} new commits</p>}
      {!source && item.version && <p className="about-result-detail">{item.version} · {item.prerelease ? "Prerelease" : "Release"}</p>}
      <RepositoryLink kind={source ? "source" : "releases"} onError={onError}>{source ? "View source commits" : "View release notes and downloads"}</RepositoryLink>
    </>}
  </section>;
}

export function AboutSettings() {
  const [build, setBuild] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now);
  const retryAt = Math.max(Date.parse(result?.source?.retryAt || "") || 0, Date.parse(result?.release?.retryAt || "") || 0);
  const coolingDown = retryAt > clock;
  useEffect(() => {
    if (!coolingDown) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.min(60000, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [clock, coolingDown, retryAt]);
  const request = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    api("/client/about", undefined, undefined, {}, { signal: controller.signal })
      .then(setBuild).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, []);
  const check = async () => {
    if (request.current || retryAt > Date.now()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(""); setResult(null);
    try {
      const next = await api("/client/about", {}, undefined, {}, { signal: controller.signal });
      setBuild(next.build); setResult(next); setClock(Date.now());
    } catch (error) { if (!controller.signal.aborted) setError(error.message); }
    finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return <section className="about-settings" aria-label="About Cage">
    <div className="section-title"><h3>About</h3><p>Cage version and update information</p></div>
    <dl className="about-build">
      <div><dt>Software version</dt><dd>{loading ? "Reading…" : build?.version || "Unknown"}</dd></div>
      <div><dt>Build commit</dt><dd>{build?.commit ? <code title={build.commit}>{build.commit.slice(0, 12)}</code> : loading ? "Reading…" : "Not recorded"}</dd></div>
    </dl>
    {build?.modified && <p className="footnote">This build contains uncommitted changes; the commit check only reflects recorded commits.</p>}
    <div className="about-check-actions">
      <button className="secondary-button" onClick={check} disabled={busy || coolingDown}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
        {busy ? "Checking…" : coolingDown ? "Waiting to retry" : "Check for updates"}
      </button>
      {result?.checkedAt && <span className="footnote">Checked at:{new Date(result.checkedAt).toLocaleString()}</span>}
    </div>
    <p className="footnote">Checks main branch commits and the latest release, including prereleases, through the host network and system proxy first; when the host connection fails, Cage's selected proxy is tried. After checking, you can download from the releases page.</p>
    {busy && <p role="status">Checking source commits and releases…</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="about-results" aria-live="polite" aria-busy={busy}>
      <CheckResult label="Source updates" item={result?.source} source onError={setError} />
      <CheckResult label="Release updates (including prereleases)" item={result?.release} onError={setError} />
    </div>
  </section>;
}
