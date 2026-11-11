import React, { useEffect, useRef, useState } from "react";
import { KeyRound, Plus, Search, ShieldCheck } from "lucide-react";
import { api, writeClipboard } from "./api";
import "./password-vault.css";

const emptyBrowser = { available: false, entries: [], candidates: [] };
export function usePasswordVault(ready, tab) {
  const [state, setState] = useState(emptyBrowser);
  const refresh = useRef(null), mutation = useRef(0);
  useEffect(() => {
    let cancelled = false, timer, running = false;
    setState(emptyBrowser);
    const poll = async () => {
      if (running || cancelled || !ready) return;
      running = true;
      const revision = mutation.current;
      clearTimeout(timer);
      try {
        const value = await api("/vault/browser", { action: "status", tab });
        if (!cancelled && revision === mutation.current) setState({ ...emptyBrowser, ...value, tab });
      } catch (error) {
        if (!cancelled) setState({ ...emptyBrowser, message: error.message });
      } finally {
        running = false;
        if (!cancelled && ready) timer = setTimeout(poll, 2000);
      }
    };
    refresh.current = poll;
    void poll();
    return () => { cancelled = true; clearTimeout(timer); refresh.current = null; };
  }, [ready, tab]);
  const act = async input => {
    await api("/vault/browser", input);
    mutation.current++;
    if (input.candidate) setState(previous => ({ ...previous, candidates: previous.candidates.filter(value => value.id !== input.candidate) }));
    await refresh.current?.();
  };
  return { state, act };
}

export function BrowserVaultBar({ tab, vault, onManage, ready, menu = false }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const { state, act } = vault;
  const entries = state.tab === tab.id ? state.entries : [];
  const candidate = state.candidates.find(value => value.tab === tab.id);
  useEffect(() => { setOpen(false); setMessage(""); }, [tab.id, tab.url]);
  const run = async (input, success) => {
    setBusy(true); setMessage("");
    try { await act(input); setMessage(success); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <div className="vault-browser" onKeyDown={event => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); event.currentTarget.querySelector("button").focus(); }
  }}>
    <div className="vault-browser-heading">
      <button className={menu ? "browser-menu-item" : "text-button"} role={menu ? "menuitem" : undefined}
        aria-expanded={open} onClick={() => setOpen(!open)}>
        <KeyRound size={16} /><span>Passwords{entries.length ? ` · ${entries.length} ${entries.length === 1 ? "account" : "accounts"}` : ""}</span>
      </button>
      {message && <span role="status">{message}</span>}
    </div>
    {candidate && <div className="vault-save" role="region" aria-label="Save site password">
      <div><strong>{candidate.update ? "Update the password for this account?" : "Save the password for this account?"}</strong>
        <span>{candidate.origin} · {candidate.username || "No username entered"}</span>
        <small>Save it after confirming the site sign-in succeeded.</small></div>
      <div className="vault-actions">
        <button className="primary" disabled={busy} onClick={() => run({ action: "save", candidate: candidate.id }, "Password saved")}>{candidate.update ? "Update password" : "Save password"}</button>
        <button disabled={busy} onClick={() => run({ action: "dismiss", candidate: candidate.id }, "")}>Not now</button>
        <button className="text-button" disabled={busy} onClick={() => run({ action: "never", candidate: candidate.id }, "This site will no longer prompt to save")}>Never for this site</button>
      </div>
    </div>}
    {open && <div className="vault-picker" role="region" aria-label="Passwords for the current site">
      <p>{state.origin && state.tab === tab.id ? state.origin : "Pick an account to fill in on an HTTPS site's sign-in page"}</p>
      {!ready ? <p>Start the environment to fill in site passwords.</p> : !state.available ? <p>{state.message || "Connecting to the browser password feature…"}</p> :
        entries.length ? entries.map(entry => <button className="vault-account-choice" key={entry.id} disabled={busy}
          onClick={() => run({ action: "fill", tab: tab.id, id: entry.id, document: state.document }, "Filled in. Submit the sign-in on the page.")}>
          <span>{entry.username || "No username entered"}</span><span>Fill in credentials</span>
        </button>) : <p>No credentials are saved for this site yet.</p>}
      <button className="text-button" onClick={onManage}>Manage password vault</button>
    </div>}
  </div>;
}

const newEntry = () => ({ origin: "", username: "", password: "" });
export function PasswordVaultSettings({ onConfirm, onDirty }) {
  const [store, setStore] = useState({ entries: [], blocked: [] });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(""), [draft, setDraft] = useState(null);
  const [verify, setVerify] = useState(null), [accountPassword, setAccountPassword] = useState("");
  const [revealed, setRevealed] = useState(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const alive = useRef(true);
  const refresh = async () => {
    const data = await api("/vault");
    if (alive.current) setStore(data);
  };
  useEffect(() => {
    alive.current = true;
    refresh().catch(error => { if (alive.current) setError(error.message); }).finally(() => { if (alive.current) setLoading(false); });
    const clear = () => { setRevealed(null); setAccountPassword(""); };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => { alive.current = false; window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", clear); };
  }, []);
  useEffect(() => { onDirty(Boolean(draft)); return () => onDirty(false); }, [draft, onDirty]);
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(null), 30000);
    return () => clearTimeout(timer);
  }, [revealed]);
  const run = async (input, success) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api("/vault", input);
      if (!alive.current) return;
      if (input.action === "reveal") {
        if (verify.mode === "copy") { await writeClipboard(result.password); setMessage("Password copied to the local clipboard"); }
        else setRevealed({ id: input.id, password: result.password });
        setVerify(null);
      } else { setDraft(null); setRevealed(null); await refresh(); setMessage(success); }
    } catch (error) { if (alive.current) setError(error.message); }
    finally { if (alive.current) { setBusy(false); setAccountPassword(""); } }
  };
  const askReveal = (entry, mode) => { setRevealed(null); setAccountPassword(""); setVerify({ entry, mode }); setError(""); };
  const entries = store.entries.filter(entry => `${entry.origin} ${entry.username}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="vault-settings">
    <div className="section-title"><h3>Password vault</h3><p>Credentials are stored encrypted on this device and unlock and lock together with Cage.</p></div>
    <div className="vault-note"><ShieldCheck size={17} /><span>Viewing or copying a password requires verifying your Cage account password again. You submit the sign-in after it is filled in.</span></div>
    {error && <p className="account-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <div className="vault-toolbar"><label className="vault-search"><span><Search size={14} />Search sites or accounts</span>
      <input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <button disabled={busy || Boolean(draft) || loading || Boolean(error && !store.entries.length)} onClick={() => { setDraft(newEntry()); setVerify(null); setRevealed(null); }}><Plus size={15} />Add password</button></div>
    {draft && <form className="vault-editor" onSubmit={event => { event.preventDefault(); void run({ action: "save", entry: draft }, "Password entry saved"); }}>
      <h4>{draft.id ? "Edit password" : "Add password"}</h4>
      <fieldset disabled={busy}>
        <label>Site address<input type="url" required autoFocus placeholder="https://mail.example.com" value={draft.origin} onChange={event => setDraft({ ...draft, origin: event.target.value })} /></label>
        <label>Account or email<input autoComplete="off" maxLength={1024} value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} /></label>
        <label>{draft.id ? "New password (leave blank to keep the current one)" : "Site password"}<input type="password" autoComplete="new-password" required={!draft.id} maxLength={8192} value={draft.password || ""} onChange={event => setDraft({ ...draft, password: event.target.value })} /></label>
        <div className="vault-actions"><button className="primary" type="submit">Save entry</button><button type="button" onClick={() => setDraft(null)}>Cancel</button></div>
      </fieldset>
    </form>}
    {verify && <form className="vault-editor" onSubmit={event => { event.preventDefault(); void run({ action: "reveal", id: verify.entry.id, account_password: accountPassword }); }}>
      <h4>{verify.mode === "copy" ? "Verify to copy the password" : "Verify to view the password"}</h4><p>{verify.entry.origin} · {verify.entry.username}</p>
      <label>Cage account password<input type="password" autoComplete="off" autoFocus required maxLength={1024} value={accountPassword} onChange={event => setAccountPassword(event.target.value)} /></label>
      <div className="vault-actions"><button className="primary" disabled={busy} type="submit">{verify.mode === "copy" ? "Verify and copy" : "Verify and view"}</button>
        <button type="button" disabled={busy} onClick={() => { setVerify(null); setAccountPassword(""); }}>Cancel verification</button></div>
    </form>}
    {loading ? <p>Reading the password vault…</p> : !entries.length ? <div className="vault-empty"><KeyRound size={24} /><p>{search ? "No matching accounts found" : "No passwords saved yet"}</p><small>After signing in on a page you can confirm saving, or add one manually.</small></div> :
      <div className="vault-list">{entries.map(entry => <article className="vault-entry" key={entry.id}>
        <div><strong>{entry.origin}</strong><span>{entry.username || "No username entered"}</span></div>
        {revealed?.id === entry.id && <div className="vault-revealed"><output aria-label="Saved site password">{revealed.password}</output><button onClick={() => setRevealed(null)}>Hide password</button></div>}
        <div className="vault-actions">
          <button disabled={busy || Boolean(draft)} onClick={() => askReveal(entry, "view")}>View password</button>
          <button disabled={busy || Boolean(draft)} onClick={() => askReveal(entry, "copy")}>Copy password</button>
          <button disabled={busy || Boolean(draft)} onClick={() => { setDraft({ ...entry, password: "" }); setVerify(null); setRevealed(null); }}>Edit</button>
          <button disabled={busy || Boolean(draft)} onClick={async () => { if (await onConfirm({ title: "Delete this password?", body: `${entry.origin} · ${entry.username || "No username entered"}. It cannot be recovered after deletion.`, confirm: "Delete password" })) await run({ action: "delete", id: entry.id }, "Password entry deleted"); }}>Delete</button>
        </div>
      </article>)}</div>}
    {store.blocked.length > 0 && <section className="vault-blocked"><h4>Sites that no longer prompt to save</h4>{store.blocked.map(origin => <div key={origin}><span>{origin}</span><button disabled={busy} onClick={() => run({ action: "unblock", origin }, "Save prompts restored for this site")}>Restore prompts</button></div>)}</section>}
    <p className="footnote">Common sign-in forms on top-level HTTPS pages are supported. Passwords do not sync to other devices; when backing up, keep both the local account file and the password library.</p>
  </section>;
}
