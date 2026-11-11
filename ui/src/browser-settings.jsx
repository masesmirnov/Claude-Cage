import React, { useEffect, useState } from 'react';
import { Globe2, Info, LayoutPanelLeft, Puzzle, Search, ShieldCheck, ExternalLink } from 'lucide-react';
import { api } from './api';
import { InlineSelect } from './inline-select';
import { BrowserCookies } from './browser-cookies';
import { BrowserExtensions } from './browser-extensions';
import './browser-settings.css';

const sections = [
  { id: 'general', title: 'New tab', icon: Globe2, search: 'startup new tab home page default address url' },
  { id: 'appearance', title: 'Appearance', icon: LayoutPanelLeft, search: 'appearance tab bar layout horizontal vertical' },
  { id: 'privacy', title: 'Privacy and site data', icon: ShieldCheck, search: 'privacy cookie site data permissions clear browsing history' },
  { id: 'extensions', title: 'Extensions', icon: Puzzle, search: 'extensions plugins manage install import edge chrome' },
  { id: 'about', title: 'About the browser', icon: Info, search: 'about browser chromium version' },
];
export function BrowserSettingsPage({ tab, tabs, currentHome, layout, onLayoutChange, onSaved, onInternal, onOpenPage, onConfirm, onSectionChange }) {
  const [section, setSection] = useState(tab.url.split('#')[1] || 'general'), [query, setQuery] = useState('');
  const [home, setHome] = useState(currentHome || 'https://www.bing.com/'), [savedHome, setSavedHome] = useState(currentHome || 'https://www.bing.com/');
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cookieSession, setCookieSession] = useState('normal');
  const [info, setInfo] = useState(null);
  useEffect(() => { let live = true; api('/browser/info', {}).then(value => { if (live) setInfo(value); }).catch(() => { if (live) setInfo({ error: true }); }); return () => { live = false; }; }, []);
  useEffect(() => { const next = tab.url.split('#')[1]; if (sections.some(item => item.id === next)) { setSection(next); setQuery(''); } }, [tab.url]);
  useEffect(() => {
    let live = true;
    api('/browser/preferences').then(result => { if (live) { setHome(result.browser_home_url); setSavedHome(result.browser_home_url); } }).catch(error => { if (live) setError(error.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  const changeSection = id => { setSection(id); setQuery(''); onSectionChange?.(id); };
  const save = async event => {
    event.preventDefault(); setSaving(true); setError(''); setSaved(false);
    try { const result = await api('/browser/preferences', { browser_home_url: home }); setHome(result.browser_home_url); setSavedHome(result.browser_home_url); setSaved(true); onSaved(result); }
    catch (error) { setError(error.message); }
    finally { setSaving(false); }
  };
  const privateTab = tabs.find(item => item.incognito && !item.login);
  const cookieTab = cookieSession === 'private' && privateTab ? privateTab : tab;
  const visible = query.trim() ? sections.filter(item => `${item.title} ${item.search}`.toLowerCase().includes(query.trim().toLowerCase())) : sections.filter(item => item.id === section);
  return <section className="browser-settings-page" aria-label="Browser settings">
    <header className="browser-settings-top"><h1>Settings</h1><label className="browser-settings-search"><Search size={16} /><input aria-label="Search browser settings" placeholder="Search settings" value={query} onChange={event => setQuery(event.target.value)} /></label></header>
    <div className="browser-settings-layout">
      <nav className="browser-settings-nav" aria-label="Browser settings categories">{sections.map(({ id, title, icon: Icon }) => <button key={id} aria-label={title} aria-description={id === 'general' && home !== savedHome ? 'Unsaved changes' : undefined} aria-current={!query && section === id ? 'page' : undefined} onClick={() => changeSection(id)}><Icon size={17} /><span>{title}</span>{id === 'general' && home !== savedHome && <span className="settings-unsaved-dot" title="Unsaved changes" />}</button>)}</nav>
      <div className="browser-settings-compact-nav"><InlineSelect aria-label="Browser settings categories" value={section} onValueChange={changeSection}>
        {sections.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
      </InlineSelect></div>
      <div className="browser-settings-content">
        {visible.length === 0 && <div className="browser-settings-no-results"><Search size={24} /><h2>No matching settings found</h2><p>Try "tab", "cookie" or "extension".</p></div>}
        {visible.map(item => <section key={item.id} className="browser-settings-section" aria-label={item.title}>
          <h2>{item.title}</h2>
          {item.id === 'general' && <><p>Choose the site that opens in a new tab.</p><form className="browser-setting-form" onSubmit={save}>
            <label className="browser-setting-field">New tab address<input type="url" aria-label="New tab address" required maxLength={8192} value={home} disabled={saving || loading} spellCheck="false" autoComplete="off" onChange={event => { setHome(event.target.value); setSaved(false); }} /></label>
            <p>Regular and incognito tabs use the same default address. It applies to new pages as soon as it is saved.</p>
            <div className="browser-setting-actions"><button className="primary" disabled={saving || loading || home === savedHome}>{saving ? 'Saving…' : 'Save address'}</button>{saved && <span role="status">Saved</span>}</div>
            {error && <p className="browser-settings-error" role="alert">{error}</p>}
          </form></>}
          {item.id === 'appearance' && <><p>Adjust the tab bar for web pages and the file editor.</p><div className="browser-setting-row"><div><h3>Tab bar layout</h3><p>Applies immediately and is saved on this computer.</p></div><InlineSelect aria-label="Tab bar layout" value={layout} onValueChange={onLayoutChange}><option value="horizontal">Horizontal (top)</option><option value="vertical">Vertical (left)</option></InlineSelect></div><p>The browser settings page follows the current Cage font and palette.</p></>}
          {item.id === 'privacy' && <><p>Manage the data and permissions that sites keep in the current browsing session.</p>
            <div className="browser-setting-row"><div><h3>Cookies and sign-in state</h3><p>Regular and incognito sessions are managed separately.</p></div><InlineSelect aria-label="Cookie browsing session" value={cookieSession} onValueChange={setCookieSession}><option value="normal">Regular session</option><option value="private" disabled={!privateTab}>Incognito session</option></InlineSelect></div>
            <BrowserCookies key={cookieTab.id} tab={cookieTab} onClose={() => changeSection('general')} />
            <div className="browser-settings-links"><button onClick={() => onInternal('permissions')}><ExternalLink size={15} />Site permissions</button><button onClick={() => onInternal('clear')}><ExternalLink size={15} />Clear regular session browsing data</button></div>
          </>}
          {item.id === 'extensions' && <><p>Add and manage the extensions used by the Cage browser.</p><BrowserExtensions onInternal={onInternal} onOpenPage={onOpenPage} onConfirm={onConfirm} /></>}
          {item.id === 'about' && <><p>The Cage browser runs on Chromium inside the environment. Web pages, extensions and site data are saved with the current Cage environment.</p><div className="browser-setting-row"><div><h3>Browser engine</h3><p>{info?.product || (info?.error ? 'Version information is temporarily unavailable' : 'Reading version…')}</p></div></div><p>Downloaded files are saved by Cage to Downloads in the default workspace, and can be saved elsewhere from the downloads panel.</p></>}

        </section>)}
      </div>
    </div>
  </section>;
}
