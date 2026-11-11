import React, { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, FolderInput, Puzzle, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { api, uploadFile } from './api';
import { assertConnection, getClientContext } from './client-context.mjs';
import { InlineSelect } from './inline-select';

function Permissions({ item, expanded = false }) {
  const permissions = [...(item.permissions || []), ...(item.hostPermissions || [])];
  return <details className="extension-permissions" open={expanded || undefined}><summary>Permissions and site access{permissions.length ? ` (${permissions.length})` : ''}</summary>
    {permissions.length ? <ul>{permissions.map((value, index) => <li key={index}>{value}</li>)}</ul> : <p>No additional permissions declared.</p>}</details>;
}

function LocalExtensionImport({ existing, onUpdated, onClose }) {
  const [profiles, setProfiles] = useState(null), [profileID, setProfileID] = useState('');
  const [selected, setSelected] = useState(new Set()), [results, setResults] = useState({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    api('/client/browser-extensions').then(data => { if (alive.current) { setProfiles(data.profiles); setProfileID(data.profiles[0]?.id || ''); } })
      .catch(error => { if (alive.current) setError(error.message); });
    return () => { alive.current = false; };
  }, []);
  const profile = profiles?.find(item => item.id === profileID);
  const installed = new Set(existing.map(item => item.source));
  const completed = Object.values(results).some(value => value.startsWith('Imported'));
  const eligible = item => item.compatible && !installed.has(`${profileID}:${item.id}`);
  const importCount = profile?.extensions.filter(item => selected.has(item.id) && eligible(item)).length || 0;
  const choose = value => { setProfileID(value); setSelected(new Set()); setResults({}); setError(''); };
  const importSelected = async () => {
    if (busy || !profile) return;
    const connection = getClientContext().connection_id;
    setBusy(true); setError('');
    for (const item of profile.extensions.filter(item => selected.has(item.id) && eligible(item))) {
      let pending;
      try {
        assertConnection(connection);
        if (!alive.current) break;
        setResults(previous => ({ ...previous, [item.id]: 'Importing…' }));
        const response = await fetch('/api/client/browser-extensions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: profileID, id: item.id, version: item.version }) });
        if (!response.ok) throw new Error((await response.text()).trim());
        const file = new File([await response.blob()], item.id + '.zip', { type: 'application/zip' });
        assertConnection(connection);
        if (!alive.current) break;
        pending = await uploadFile('/browser/extensions/upload', file);
        assertConnection(connection);
        if (!alive.current) throw new Error('Import stopped');
        const next = await api('/browser/extensions', { mode: 'install', session: pending.session, target: `${profileID}:${item.id}`, enabled: item.state_known && item.enabled });
        pending = null;
        if (alive.current) { onUpdated(next.items); setResults(previous => ({ ...previous, [item.id]: item.state_known && item.enabled ? 'Imported and enabled' : 'Imported, left disabled' })); }
      } catch (error) {
        if (pending && getClientContext().connection_id === connection) await api('/browser/extensions', { mode: 'cancel', session: pending.session }).catch(() => {});
        if (alive.current) setResults(previous => ({ ...previous, [item.id]: 'Import failed: ' + error.message }));
        if (getClientContext().connection_id !== connection) break;
      }
    }
    if (alive.current) setBusy(false);
  };
  return <section className="extension-import" aria-label="Import extensions from this computer">
    <div className="browser-setting-heading"><h3>Import from the local browser</h3><button className="icon-button" aria-label="Close local import" disabled={busy} onClick={onClose}><X size={16} /></button></div>
    <p>Copy the selected extensions and their enabled state in one go. Browser accounts, cookies and extension sign-in data stay in the local browser.</p>
    {error && <p className="browser-settings-error" role="alert">{error}</p>}
    {!profiles && !error && <p role="status">Looking for local browser profiles…</p>}
    {profiles?.length === 0 && <p>No Edge, Chrome, Brave or Chromium extension profiles were found.</p>}
    {Boolean(profiles?.length) && <>
      <label className="browser-setting-field">Local browser profile<InlineSelect aria-label="Local browser profile" value={profileID} disabled={busy} onValueChange={choose}>
        {profiles.map(item => <option value={item.id} key={item.id}>{item.browser} · {item.name}</option>)}
      </InlineSelect></label>
      <div className="extension-import-actions"><button disabled={busy} onClick={() => setSelected(new Set(profile?.extensions.filter(eligible).map(item => item.id)))}>Select all compatible extensions</button>
        {completed && !busy && !importCount ? <button className="primary" onClick={onClose}>Done and close</button> : <button className="primary" disabled={busy || !importCount} onClick={importSelected}><Download size={15} />{busy ? 'Importing…' : `Import selected extensions (${importCount})`}</button>}</div>
      {!profile?.extensions.length && <p>This profile has no readable extensions.</p>}
      {profile?.extensions.map(item => <article className="extension-import-row" key={item.id}>
        <label><input type="checkbox" disabled={busy || !eligible(item)} checked={selected.has(item.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />
          <strong>{item.name}</strong><span>{item.version}</span></label>
        <p className="extension-import-state" role={results[item.id] ? 'status' : undefined}>{results[item.id] || (!item.compatible ? 'This extension version is not supported; only Manifest V3 is supported' : installed.has(`${profileID}:${item.id}`) ? 'Imported' : !item.state_known ? 'Could not read the enabled state; it will be disabled after import' : item.enabled ? 'Enabled locally' : 'Disabled locally')}</p>
        {item.compatible && !item.identity_preserved && <p>This extension's ID may change, so features that depend on browser identity or authorization may need to be reconfigured.</p>}
        <Permissions item={item} />
      </article>)}
    </>}
  </section>;
}

export function BrowserExtensions({ onOpenPage, onInternal, onConfirm }) {
  const [items, setItems] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null), [importing, setImporting] = useState(false);
  const file = useRef(), alive = useRef(true), pending = useRef(null);
  const connection = useRef(getClientContext().connection_id);
  const load = async () => {
    setError('');
    try { const result = await api('/browser/extensions', { mode: 'list' }); if (alive.current) setItems(result.items); }
    catch (error) { if (alive.current) setError(error.message); }
  };
  useEffect(() => {
    void load();
    return () => { alive.current = false; if (pending.current && getClientContext().connection_id === connection.current) void api('/browser/extensions', { mode: 'cancel', session: pending.current }).catch(() => {}); };
  }, []);
  const select = async event => {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected) return;
    if (selected.size > 32 << 20) { setError('The extension ZIP cannot exceed 32 MB.'); return; }
    setBusy('upload'); setError('');
    try {
      const result = await uploadFile('/browser/extensions/upload', selected);
      if (!alive.current) { if (getClientContext().connection_id === connection.current) await api('/browser/extensions', { mode: 'cancel', session: result.session }); return; }
      pending.current = result.session; setPreview(result);
    } catch (error) { if (alive.current) setError(error.message); }
    finally { if (alive.current) setBusy(''); }
  };
  const act = async (mode, id) => {
    if (busy) return;
    if (mode === 'remove' && !(await onConfirm({ title: 'Remove this extension?', body: 'The extension will be removed from the Cage browser. Extensions in Edge or Chrome on this computer are left unchanged.', confirm: 'Remove extension' }))) return;
    setBusy(id || mode); setError('');
    try {
      const result = await api('/browser/extensions', { mode, id, ...(mode === 'install' ? { session: preview.session } : {}) });
      if (mode === 'install' || mode === 'cancel') { pending.current = null; setPreview(null); }
      if (result.native) await onInternal('extensions', result.id);
      else if (result.id && result.url) await onOpenPage(result);
      else if (result.items) setItems(result.items);
    } catch (error) { setError(error.message); }
    finally { setBusy(''); }
  };
  const cancel = async () => {
    setBusy('cancel'); setError('');
    try { await api('/browser/extensions', { mode: 'cancel', session: preview.session }); pending.current = null; setPreview(null); }
    catch (error) { setError(error.message); }
    finally { setBusy(''); }
  };
  return <div className="browser-extensions">
    <div className="browser-setting-actions">
      <button className="primary" disabled={Boolean(busy || preview)} onClick={() => file.current?.click()}><Upload size={15} />Add ZIP extension</button>
      <button disabled={Boolean(busy || preview)} onClick={() => setImporting(true)}><FolderInput size={15} />Import from this computer</button>
      <button aria-label="Refresh extensions" disabled={Boolean(busy)} onClick={load}><RefreshCw size={15} /></button>
    </div>
    <input ref={file} type="file" accept=".zip,application/zip" hidden onChange={select} aria-label="Choose extension ZIP" />
    <p>Chromium Manifest V3 extensions are supported. Extensions run in the Cage environment and access sites with their declared permissions.</p>
    {error && <p className="browser-settings-error" role="alert">{error}</p>}
    {busy === 'upload' && <p role="status">Reading the extension package…</p>}
    {preview && <section className="extension-install-preview" aria-label="Confirm extension install">
      <h3>Confirm install of {preview.name}</h3><p>Version {preview.version}</p><p>{preview.description}</p>
      <Permissions item={preview} expanded />
      <div className="browser-setting-actions"><button className="primary" disabled={Boolean(busy)} onClick={() => act('install')}>Install extension</button><button disabled={Boolean(busy)} onClick={cancel}>Cancel</button></div>
    </section>}
    {importing && <LocalExtensionImport existing={items || []} onUpdated={setItems} onClose={() => setImporting(false)} />}
    <div className="browser-setting-heading"><h3>Installed extensions{items ? ` (${items.length})` : ''}</h3></div>
    {items === null && !error ? <p role="status">Reading extensions…</p> : items?.length === 0 ? <div className="extension-empty"><Puzzle size={28} /><strong>Make the browser work better for you</strong><p>Add an extension, or import existing ones from the local browser.</p></div> : items?.map(item => <article className="extension-item" key={item.id}>
      <div className="browser-setting-heading"><div><strong>{item.name}</strong><span className="extension-version">{item.version}</span></div>
        <label className="extension-enable"><input type="checkbox" aria-label={`Enable ${item.name}`} checked={Boolean(item.enabled)} disabled={Boolean(busy) || item.mayDisable === false} onChange={() => act(item.enabled ? 'disable' : 'enable', item.id)} />{item.enabled ? 'Enabled' : 'Disabled'}</label></div>
      {item.description && <p>{item.description}</p>}{item.error && <p role="alert" className="browser-settings-error">{item.error}</p>}
      <Permissions item={item} />
      <div className="extension-item-footer"><span>{item.id}</span><div className="browser-setting-actions">
        {item.optionsUrl && <button disabled={Boolean(busy) || !item.enabled} onClick={() => act('options', item.id)}>Extension options</button>}
        <button disabled={Boolean(busy) || item.mayDisable === false} onClick={() => act('remove', item.id)}><Trash2 size={14} />{item.managed ? 'Remove' : 'Manage'}</button>
      </div></div>
    </article>)}
    <div className="browser-settings-links"><button onClick={() => onInternal('extensions')}><ExternalLink size={15} />Chromium extension manager</button>
      <button onClick={() => onOpenPage({ url: 'https://chromewebstore.google.com/', kind: 'web' })}><ExternalLink size={15} />Open extension store</button></div>
  </div>;
}
