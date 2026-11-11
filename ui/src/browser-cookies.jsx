import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCw, Trash2 } from "lucide-react";
import { api } from "./api";
import { InlineSelect } from "./inline-select";

export function BrowserCookies({ tab, onClose }) {
  const [scope, setScope] = useState(/^https?:/.test(tab.url) ? "site" : "all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [value, setValue] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const generation = useRef(0), search = useRef(null), operation = useRef(false);
  useEffect(() => { search.current?.focus(); }, []);
  useEffect(() => {
    const version = ++generation.current;
    setLoading(true); setData(null); setValue(null); setError(""); setConfirmClear(false);
    api("/browser/cookies", { id: tab.id, url: tab.url, mode: "list", scope, query, page })
      .then(result => { if (version === generation.current) setData(result); })
      .catch(error => { if (version === generation.current) setError(error.message); })
      .finally(() => { if (version === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [tab.id, scope, query, page, revision]);
  const run = async (mode, cookieKey) => {
    if (operation.current || loading) return;
    operation.current = true; setBusy(true); setError("");
    const version = generation.current;
    try {
      const result = await api("/browser/cookies", { id: tab.id, url: tab.url, mode, scope, query, page, cookieKey });
      if (version !== generation.current) return;
      if (mode === "details") setValue({ key: cookieKey, value: result.value });
      else { setData(result); setValue(null); setConfirmClear(false); }
    } catch (error) {
      if (version === generation.current) setError(error.message);
    } finally { operation.current = false; setBusy(false); }
  };
  return <section className="browser-cookies" aria-label="Cookie manager" onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <div className="cookie-heading">
      <button className="icon-button" aria-label="Close cookie manager" onClick={onClose}><ArrowLeft size={15} /></button>
      <strong>Cookie manager</strong><span>{tab.incognito ? "Incognito session" : "Regular session"}</span>
      <button className="icon-button" aria-label="Refresh cookies" disabled={busy || loading}
        onClick={() => setRevision(revision + 1)}><RefreshCw size={15} /></button>
    </div>
    <div className="cookie-toolbar">
      <InlineSelect aria-label="Cookie site scope" value={scope} disabled={busy} onValueChange={next => { setScope(next); setPage(0); }}>
        <option value="site" disabled={!/^https?:/.test(tab.url)}>Current site</option><option value="all">All sites</option>
      </InlineSelect>
      <input ref={search} aria-label="Search cookies" placeholder="Search by site or cookie name" maxLength={200}
        value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setPage(0); }} />
      <button disabled={busy || loading || !data} onClick={() => setConfirmClear(!confirmClear)}>
        <Trash2 size={14} />Clear {scope === "site" ? "current site" : "all sites"}
      </button>
    </div>
    {confirmClear && <div className="cookie-confirm" role="alert">
      <span>Clear cookies for {scope === "site" ? data?.hostname : "all sites in this " + (tab.incognito ? "incognito" : "regular") + " session"}? The search filter does not limit what is cleared, and sites may require you to sign in again.</span>
      <button disabled={busy} onClick={() => run("clear")}>Confirm clear</button>
      <button disabled={busy} onClick={() => setConfirmClear(false)}>Cancel</button>
    </div>}
    {error && <p className="cookie-error" role="alert">{error}</p>}
    <div className="cookie-list" aria-busy={busy || loading}>
      {loading ? <p>Reading cookies…</p> : data?.cookies.length === 0 ? <p>No matching cookies.</p> : data?.cookies.map(cookie =>
        <article className="cookie-record" key={cookie.key}>
          <div className="cookie-record-heading"><strong>{cookie.name || "(empty name)"}</strong>
            <button disabled={busy} onClick={() => value?.key === cookie.key ? setValue(null) : run("details", cookie.key)}>
              {value?.key === cookie.key ? "Hide value" : "Show value"}</button>
            <button disabled={busy || cookie.partitionKeyOpaque} aria-label={`Delete cookie ${cookie.name}`}
              title={cookie.partitionKeyOpaque ? "This partitioned cookie requires clearing all sites" : "Delete this cookie"}
              onClick={() => run("delete", cookie.key)}><Trash2 size={14} /></button></div>
          <div className="cookie-metadata">{cookie.domain} · Path {cookie.path} · {cookie.size} B</div>
          <div className="cookie-metadata">{cookie.session ? "Expires when the session ends" : `Expires: ${new Date(cookie.expires * 1000).toLocaleString()}`}
            {cookie.secure && " · Secure"}{cookie.httpOnly && " · HttpOnly"}{cookie.sameSite && ` · SameSite=${cookie.sameSite}`}
            {(cookie.partitionKey || cookie.partitionKeyOpaque) && ` · Partition: ${cookie.partitionKey?.topLevelSite || "opaque"}`}</div>
          {value?.key === cookie.key && <pre className="cookie-value">{value.value || "(empty value)"}</pre>}
        </article>)}
    </div>
    {data && <div className="cookie-pagination"><span>{data.total} total · Page {data.page + 1}</span>
      <button disabled={busy || loading || data.page === 0} onClick={() => setPage(data.page - 1)}>Previous</button>
      <button disabled={busy || loading || (data.page + 1) * 50 >= data.total} onClick={() => setPage(data.page + 1)}>Next</button>
    </div>}
  </section>;
}
