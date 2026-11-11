import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Plus, RefreshCw, TerminalSquare, Timer } from "lucide-react";
import { api } from "./api";
import { InlineSelect } from "./inline-select";
import crabIcon from "./claude-account-crab.svg";
import "./claude-accounts.css";

// Ordinary reads never start an upstream usage query.
export function useClaudeAccounts() {
  const [registry, setRegistry] = useState(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const pendingMutation = useRef(0);
  const polling = useRef(false);
  const load = useCallback(async (change, visiblePanel = false) => {
    if (!change && (pendingMutation.current || (visiblePanel && polling.current))) return;
    const request = ++generation.current;
    if (change) pendingMutation.current++;
    else if (visiblePanel) polling.current = true;
    try {
      const value = await api(visiblePanel ? "/claude-accounts?panel=visible" : "/claude-accounts", change);
      if (!Array.isArray(value?.accounts)) throw new Error("Could not read the Claude account list.");
      if (generation.current === request) {
        setRegistry(value);
        setError("");
      }
      return value.accounts;
    } catch (e) {
      if (generation.current === request) setError(e.message);
      if (change) throw e;
    } finally {
      if (change) pendingMutation.current--;
      else if (visiblePanel) polling.current = false;
    }
  }, []);
  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);
  return { accounts: registry?.accounts ?? null, detected: registry?.detected,
    detectionStatus: registry?.detection_status, detectionError: registry?.detection_error,
    usageRunning: registry?.usage_panel_running, usageUnavailable: registry?.usage_unavailable_reason,
    scheduling: registry?.scheduling || {mode:"balanced",switch_policy:"ask"}, loginNotice: registry?.login_notice, error, load };
}

const statusLabels = {
  pending: "Waiting for sign-in", ready: "Signed in", signed_out: "Sign-in required",
  duplicate: "Account already in the list", changed: "Sign-in identity changed",
};
const localTimestamp = new Intl.DateTimeFormat(undefined, {
  month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
});
const timeLabel = (seconds) => localTimestamp.format(seconds * 1000);

const usageUpdatedAt = (profile) => Math.max(profile.quota?.five_hour?.observed_at || 0,
  profile.quota?.seven_day?.observed_at || 0) || profile.usage_checked_at || 0;
const ageUnit = (elapsed) => elapsed < 3600 ? 60 : elapsed < 86400 ? 3600 : 86400;
function relativeTimeLabel(seconds, now) {
  const elapsed = Math.max(0, now - seconds);
  if (elapsed < 60) return "Just now";
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)} min ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)} h ago`;
  return `${Math.floor(elapsed / 86400)} d ago`;
}

const QuotaTime = createContext(0);

// All rows share a clock. Only quota readings subscribe; a tick doesn't render
// the account forms or fetch data. Sleep until the next visible unit changes.
function QuotaClock({ accounts, children }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    let timer;
    const update = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const millis = Date.now();
      const seconds = Math.floor(millis / 1000);
      setNow(seconds);
      let delay = Infinity;
      for (const account of accounts || []) {
        const updated = usageUpdatedAt(account);
        if (updated > 0) {
          const elapsed = Math.max(0, seconds - updated);
          const unit = ageUnit(elapsed);
          delay = Math.min(delay, unit - elapsed % unit);
        }
        for (const window of [account.quota?.five_hour, account.quota?.seven_day]) {
          const left = window?.resets_at - seconds;
          if (left > 0) delay = Math.min(delay, left <= 60 ? 1 : (left - 1) % 60 + 1);
          const seen = window?.observed_at;
          if (window && seen && seen + 901 > seconds) delay = Math.min(delay, seen + 901 - seconds);
        }
      }
      if (Number.isFinite(delay)) timer = setTimeout(update, delay * 1000 - millis % 1000);
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
  }, [accounts]);
  return <QuotaTime.Provider value={now}>{children}</QuotaTime.Provider>;
}

function resetCountdown(seconds) {
  if (seconds < 60) return `in ${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours} h ${minutes % 60} min`;
  return `in ${Math.floor(hours / 24)} d ${hours % 24} h`;
}

const usageLabels = {
  checking: "Checking usage limits…", reported: "Usage limits received", partial: "Only some usage limits were returned",
  cached: "Only cached readings this time", unavailable: "No usage limits returned this time", error: "Usage limit check failed",
  not_applicable: "This sign-in has no subscription usage limits",
  identity_changed: "Sign-in identity changed; this reading was discarded", offline: "Environment offline; cannot check",
  update_required: "Sync the environment components before checking", blocked: "Usage limits cannot be checked right now",
  signed_out: "Sign in to check usage limits", local: "Session reading available", unknown: "Usage limits not checked yet",
};

function useUsageCheck(profile, environment, perform, change) {
  const [manual, setManual] = useState(null);
  const check = () => perform(async () => {
    setManual({ state: "checking" });
    try {
      await change(profile.id ? { action: "refresh", id: profile.id } :
        { action: "refresh_default", identity: profile.identity });
      setManual(null);
    } catch (e) {
      setManual({ state: "error", previousCheck: profile.usage_checked_at, previousStatus: profile.usage_status });
      await change(); // A failed identity check can still change which default account the panel should show.
      throw e;
    }
  });
  let state = profile.usage_status || (profile.quota ? "local" : "unknown");
  if (profile.status === "changed" || profile.status === "duplicate") state = "identity_changed";
  if (profile.status === "signed_out" || profile.status === "pending") state = "signed_out";
  if (manual?.state === "error" && manual.previousCheck === profile.usage_checked_at && manual.previousStatus === profile.usage_status) state = "error";
  if (profile.usage_checking || manual?.state === "checking") state = "checking";
  if (environment) state = environment;
  return { state, check };
}

function QuotaWindow({ label, snapshot, state }) {
  const now = useContext(QuotaTime);
  const reset = snapshot?.resets_at;
  const remaining = reset ? reset - now : null;
  const expired = remaining !== null && remaining <= 0;
  const hasReading = Number.isFinite(snapshot?.used_percentage);
  const known = !expired && hasReading;
  const lastSeen = snapshot?.observed_at;
  const stale = known && (!lastSeen || now - lastSeen > 15 * 60 ||
    !["reported", "partial"].includes(state));
  const countdown = expired ? "Waiting for update" : remaining !== null ? resetCountdown(remaining) :
    known ? "Reset time unknown" : state === "checking" ? "Checking" : "No reading";
  return <div className="claude-quota-row" role="group" aria-label={label + " usage limit"}>
    <span className="claude-quota-period">{label}</span>
    {known
      ? <progress aria-label={label + " used usage limit"} value={snapshot.used_percentage} max={100} />
      : <span className="claude-quota-unknown" aria-hidden="true" />}
    <div className="claude-quota-reading">
      {stale && <span className="claude-quota-stale" title={lastSeen ? `Earlier reading · ${timeLabel(lastSeen)}` : "Earlier reading"}>Earlier reading</span>}
      {known && <strong title={lastSeen ? `Usage limit used · read ${timeLabel(lastSeen)}` : "Usage limit used"}>{snapshot.used_percentage}%</strong>}
      <span className="claude-quota-reset" title={reset ? `Resets ${timeLabel(reset)}` : "No reset time yet"}>
        {remaining > 0 && <Timer size={12} aria-hidden="true" />}{countdown}
      </span>
    </div>
    {hasReading && (expired || stale || state === "partial") && <small className="claude-quota-history">
      {expired && `Last ${snapshot.used_percentage}% · `}
      {lastSeen > 0 ? <>{!expired && "Read "}<time dateTime={new Date(lastSeen * 1000).toISOString()}>{timeLabel(lastSeen)}</time></> : "Reading time unknown"}
    </small>}
  </div>;
}

function ProfileUsage({ quota, state }) {
  return <div className="claude-quota-grid">
    <QuotaWindow label="5h" snapshot={quota?.five_hour} state={state} />
    <QuotaWindow label="7d" snapshot={quota?.seven_day} state={state} />
  </div>;
}

function UsageNote({ profile, state }) {
  const now = useContext(QuotaTime);
  const updated = usageUpdatedAt(profile);
  return <small className="claude-quota-age">
    <span>{usageLabels[state] || "No usage limit information"}</span>
    {updated > 0 && <span>Last updated <time dateTime={new Date(updated * 1000).toISOString()} title={timeLabel(updated)}>
      {relativeTimeLabel(updated, now)}</time></span>}
  </small>;
}

function DetectedProfile({ profile, usageEnvironment, busy, join, perform, change }) {
  const usage = useUsageCheck(profile, usageEnvironment, perform, change);
  return <article className="claude-profile claude-detected" aria-label={profile.email}>
    <div className="claude-profile-heading">
      <span className="claude-profile-avatar" aria-hidden="true"><img src={crabIcon} alt="" /></span>
      <div className="claude-profile-identity">
        <div className="claude-profile-name">
          <h4 title={profile.email}>{profile.email}</h4>
          {profile.plan && <span className="claude-profile-plan">{profile.plan}</span>}
        </div>
        <div className="claude-profile-meta">
          <span className="claude-profile-status">Regular terminal · found, not added</span>
          {profile.organization && <span className="claude-profile-email" title={profile.organization}>{profile.organization}</span>}
        </div>
      </div>
    </div>
    <ProfileUsage quota={profile.quota} state={usage.state} />
    <div className="claude-profile-actions">
      <button className="quiet-button" disabled={busy} onClick={join}><Plus size={14} />Add to scheduling</button>
      <button className="quiet-button" disabled={busy || !!usageEnvironment || usage.state === "checking"} onClick={usage.check}>
        <RefreshCw size={14} />Check status</button>
      <UsageNote profile={profile} state={usage.state} />
    </div>
  </article>;
}

function ProfileCard({ profile, environment, usageEnvironment, busy, active, defaultActive, perform, change, login, cancelDraft }) {
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState(profile.handoff_group || "");
  const displayName = profile.label || profile.email;
  const fromTerminal = profile.source === "default";
  const savedLabel = label.trim() || profile.email;
  const usage = useUsageCheck(profile, usageEnvironment, perform, change);
  return <article className="claude-profile" aria-label={displayName} data-enabled={profile.enabled}>
    <div className="claude-profile-heading">
      <span className="claude-profile-avatar" aria-hidden="true"><img src={crabIcon} alt="" /></span>
      <div className="claude-profile-identity">
        {renaming ? <form className="claude-profile-rename" onSubmit={(e) => {
          e.preventDefault();
          perform(async () => { await change({ action: "update", id: profile.id, label: savedLabel }); setRenaming(false); });
        }}>
          <input autoFocus aria-label="Account note" maxLength={64} placeholder={profile.email || "Account name"} value={label} onChange={(e) => setLabel(e.target.value)} />
          <button disabled={busy || !savedLabel} aria-label="Save note"><Check size={15} /></button>
          <button type="button" disabled={busy} onClick={() => setRenaming(false)}>Cancel</button>
        </form> : <div className="claude-profile-name">
          <h4 title={displayName}>{displayName}</h4>
          {profile.plan && <span className="claude-profile-plan">{profile.plan}</span>}
          <button type="button" className="icon-button" disabled={busy} aria-label={`Edit the note for ${displayName}`}
            onClick={() => { setLabel(profile.label === profile.email ? "" : profile.label || ""); setRenaming(true); }}><Pencil size={14} /></button>
        </div>}
        <div className="claude-profile-meta">
          <span className="claude-profile-status">{statusLabels[profile.status] || "Status unknown"}</span>
          {profile.email && <span className="claude-profile-email" title={[profile.email, profile.organization].filter(Boolean).join(" · ")}>
            {[profile.email !== displayName && profile.email, profile.organization].filter(Boolean).join(" · ")}
          </span>}
        </div>
      </div>
      <label className="check-line claude-participation">
        <input type="checkbox" aria-label="Include in automatic assignment" checked={profile.enabled} disabled={busy}
          onChange={(e) => { const enabled = e.target.checked; perform(() => change({ action: "update", id: profile.id, enabled })); }} />
        <span className="claude-switch-track" aria-hidden="true" />
        <span>{profile.enabled ? "In rotation" : "Paused"}</span>
      </label>
    </div>
    <ProfileUsage quota={profile.quota} state={usage.state} />
    <form className="claude-handoff-group" onSubmit={event => { event.preventDefault(); perform(() => change({action:"update",id:profile.id,handoff_group:group})); }}>
      <label>Handoff group<input aria-label={`Handoff group for ${displayName}`} value={group} maxLength={32} placeholder="No group; no handoff across accounts" onChange={event => setGroup(event.target.value)} /></label>
      <button disabled={busy || group === (profile.handoff_group || "")}>Save group</button>
    </form>
    {active > 0 && <p className="claude-profile-note">{active} {active === 1 ? "terminal is" : "terminals are"} still running{!fromTerminal && "; sign in again after closing them"}</p>}
    {!fromTerminal && defaultActive > 0 && <p className="field-help">
      {defaultActive} of them {defaultActive === 1 ? "still uses" : "still use"} the regular terminal's sign-in. If the regular terminal switched accounts, reopen those sessions to confirm the identity.
    </p>}
    {fromTerminal && ["changed", "signed_out"].includes(profile.status) && <p className="field-help">
      {profile.status === "changed" ? "The regular terminal switched accounts, so this account is not in rotation for now. The new identity must be added separately." : "The regular terminal signed out. To keep using this account, sign in with the original identity first."}
      {active > 0 && " The original work terminals keep the label from their first assignment. Reopen the work sessions to confirm the identity."}
    </p>}
    {!fromTerminal && profile.status === "changed" && <p className="field-help">Sign in again with the original account. To use the new identity, click "Sign in to a new account".</p>}
    {profile.status === "duplicate" && <p className="field-help">One subscription takes part in assignment only once. Sign in to a different account here.</p>}
    <div className="claude-profile-actions">
      {fromTerminal ? <span className="claude-profile-source">Regular terminal account</span> :
        <button className="quiet-button" disabled={busy || !!environment || active > 0} onClick={() => perform(() => login(profile.id))}>
          <TerminalSquare size={14} />{profile.status === "ready" ? "Sign in again" : "Open sign-in terminal"}</button>}
      <button className="quiet-button" disabled={busy || !!usageEnvironment || usage.state === "checking"} onClick={usage.check}>
        <RefreshCw size={14} />Check status</button>
      {!fromTerminal && !profile.email && !active && ["pending", "signed_out", "duplicate"].includes(profile.status) &&
        <button className="text-button" disabled={busy} onClick={() => perform(() => cancelDraft(profile))}>Undo add</button>}
      <UsageNote profile={profile} state={usage.state} />
    </div>
  </article>;
}

export function ClaudeAccountsPanel({ store, running, environmentBusy, tabs, login, onConfirm }) {
  const { accounts, detected, detectionStatus, detectionError, loginNotice, usageRunning, usageUnavailable, load, error } = store;
  const [busy, setBusy] = useState(false);
  const [requestingUsage, setRequestingUsage] = useState(false);
  const [actionError, setActionError] = useState("");
  const visibleProfiles = useMemo(() => detected ? [detected, ...(accounts || [])] : accounts, [accounts, detected]);
  const environment = !running || detectionStatus === "offline" ? "offline" :
    detectionStatus === "update_required" ? "update_required" : "";
  const usageEnvironment = environment || (usageUnavailable ? "blocked" : "");
  const checking = !usageEnvironment && (usageRunning || visibleProfiles?.some((profile) => profile.usage_checking));
  const activeCounts = useMemo(() => {
    const counts = new Map();
    for (const tab of tabs) {
      if (!tab.claude_account_id || tab.closed) continue;
      const count = counts.get(tab.claude_account_id) || { all: 0, fromDefault: 0 };
      count.all++;
      if (tab.claude_account_source === "default") count.fromDefault++;
      counts.set(tab.claude_account_id, count);
    }
    return counts;
  }, [tabs]);
  useEffect(() => {
    let requested = false, mounted = true;
    const openPanel = () => {
      if (requested || document.hidden) return;
      requested = true;
      setRequestingUsage(running);
      if (running) {
        load({ action: "usage_panel" })
          .catch(() => {})
          .finally(() => { if (mounted) setRequestingUsage(false); });
      } else load();
    };
    openPanel();
    document.addEventListener("visibilitychange", openPanel);
    return () => { mounted = false; document.removeEventListener("visibilitychange", openPanel); };
  }, [load, running]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) load(undefined, true); }, checking ? 2000 : 12000);
    return () => clearInterval(timer);
  }, [load, checking]);
  const perform = async (operation) => {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try { await operation(); }
    catch (e) { setActionError(e.message); }
    finally { setBusy(false); }
  };
  const cancelDraft = async (profile) => {
    const last = accounts.length === 1;
    if (await onConfirm({ title: `Undo adding "${profile.label}"?`,
      body: last
        ? "This is the last account in the list. After undoing, new Claude terminals use the environment's existing sign-in. Data in the virtual machine is kept."
        : "This account will be removed from the list. Data in the virtual machine is kept.",
      confirm: "Undo add" })) {
      await load({ action: "cancel", id: profile.id });
    }
  };
  const joinDetected = async () => {
    try { await load({ action: "join", identity: detected.identity }); }
    catch (e) {
      await load(); // The identity shown when the user clicked may no longer be signed in.
      throw e;
    }
  };
  return <section className="claude-profiles" aria-label="Claude account management">
    <div className="section-title">
      <h3>Claude accounts</h3>
      <p>Add subscriptions already signed in on the regular terminal to scheduling, or sign in to a new account separately. Accounts are assigned automatically to new Claude terminals.</p>
    </div>
    <details className="claude-scheduling">
      <summary>Scheduling settings · {store.scheduling.mode === "sequential" ? "Sequential first" : "Balanced"}</summary>
      <label>New session assignment<InlineSelect aria-label="New session assignment" value={store.scheduling.mode} disabled={busy}
        onValueChange={mode => perform(() => load({action:"scheduling",scheduling:{...store.scheduling,mode}}))}>
        <option value="balanced">Balanced</option><option value="sequential">In list order</option>
      </InlineSelect></label>
      <label>New session switch authorization<InlineSelect aria-label="New session switch authorization" value={store.scheduling.switch_policy} disabled={busy}
        onValueChange={switch_policy => perform(() => load({action:"scheduling",scheduling:{...store.scheduling,switch_policy}}))}>
        <option value="ask">Ask every time</option><option value="allow">Continue automatically when the usage limit runs out</option><option value="wait">Always wait for the original account</option>
      </InlineSelect></label>
      <p className="field-help">Existing sessions keep their account and authorization. Automatic handoff happens only when the limit is confirmed, the original task can be stopped safely, and the target account is in the same handoff group; switching accounts may rebuild the cache.</p>
      {store.scheduling.mode === "sequential" && accounts?.length > 1 && <div className="claude-account-order" aria-label="Account priority order">
        {accounts.map((profile,index) => <div key={profile.id}><span>{index+1}. {profile.label || profile.email}</span>
          <button disabled={busy || index===0} aria-label={`Raise the priority of ${profile.label}`} onClick={() => {
            const order=accounts.map(a=>a.id); [order[index-1],order[index]]=[order[index],order[index-1]];
            perform(() => load({action:"scheduling",scheduling:store.scheduling,order}));
          }}>Move up</button></div>)}
      </div>}
    </details>
    <div className="claude-add-profile">
      <button className="primary" disabled={busy || environmentBusy || !!environment}
        onClick={() => perform(() => login())}><Plus size={16} />Sign in to a new account</button>
    </div>
    {(actionError || error) && <p className="account-error" role="alert">{actionError || error}</p>}
    {loginNotice && <p className="claude-profile-note" role="status">{loginNotice}</p>}
    {detectionError && <p className="account-error" role="alert">{detectionError}</p>}
    {usageUnavailable && !environment && <p className="claude-profile-note" role="status">{usageUnavailable}</p>}
    {!running ? <p className="claude-profile-note">Start the Cage environment to detect the regular terminal's sign-in, or sign in to a new account.</p> :
      detectionStatus === "offline" ? <p className="claude-profile-note">Accounts can be detected and signed in once the working environment is ready.</p> :
      detectionStatus === "signed_out" && <p className="claude-profile-note">The regular terminal is not signed in to a Claude subscription. Run <code>claude auth login</code> there, and the account will appear here.</p>}
    <div className="claude-list-heading">
      <h4>Account list <span>{visibleProfiles?.length ?? "—"}</span></h4>
      {requestingUsage || checking ? <small role="status">{requestingUsage ? "Requesting account usage…" : "Checking account usage…"}</small> :
        accounts?.length > 0 && <small>{accounts.filter((a) => a.enabled).length} in scheduling</small>}
    </div>
    <div className="claude-profile-list" role="region" aria-label="Account list" tabIndex={0}>
      {accounts === null && !error && <p role="status">Reading accounts…</p>}
      {accounts?.length === 0 && !detected && <div className="claude-profile-empty">
        <img src={crabIcon} alt="" /><p>No accounts added to scheduling yet.</p><small>Until you add the first account, new terminals use the environment's existing sign-in.</small>
      </div>}
      <QuotaClock accounts={visibleProfiles}>
        {detected && <DetectedProfile key={detected.identity} profile={detected} usageEnvironment={usageEnvironment} busy={busy || environmentBusy || !!environment}
          perform={perform} change={load}
          join={() => perform(joinDetected)} />}
        {accounts?.map((profile) => <ProfileCard key={profile.id} profile={profile} environment={environment} usageEnvironment={usageEnvironment}
          busy={busy || environmentBusy} perform={perform} change={load} login={login} cancelDraft={cancelDraft}
          active={activeCounts.get(profile.id)?.all || 0} defaultActive={activeCounts.get(profile.id)?.fromDefault || 0} />)}
      </QuotaClock>
    </div>
  </section>;
}
