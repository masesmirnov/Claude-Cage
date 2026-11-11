import React, { useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, ArrowRight, ArrowUpRight, ChevronRight, FolderOpen,
  Globe2, Cookie, Settings, Puzzle, ScanEye, Maximize2, MoreHorizontal, PanelLeftOpen, Plus, RefreshCw, X } from "lucide-react";
import { BrowserVaultBar } from "./password-vault";
import { WorkspaceTabs } from "./workspace-tabs";
import { BrowserFavorites } from "./browser-favorites";
import { BrowserDownloads } from "./browser-downloads";
import { BrowserCookies } from "./browser-cookies";
import { tabName } from "./workspace-state.mjs";
import { shortcut } from "./platform.mjs";
import logo from "./logo.png";

export const ExpandSidebar = ({ onClick }) => <button className="icon-button sidebar-expand"
  aria-label="Expand sidebar" onClick={onClick}>
  <img className="sidebar-expand-logo" src={logo} alt="" />
  <PanelLeftOpen className="sidebar-expand-icon" size={18} />
</button>;

export const ExpandPane = ({ onClick }) => <button className="icon-button expand-pane"
  aria-label="Exit split view" title="Show this page across the whole workspace" onClick={onClick}><Maximize2 size={14} /></button>;

export function TerminalHeader({ tab, contentWorkspace, project, metadata, terminalDetail, terminalDetailHint,
  onHome, busy, onClose, sidebarButton, exitButton, location, triggerRef, menu }) {
  return <header className="chrome terminal-chrome">
    <div className="content-heading">
      {sidebarButton}
      <div className="content-breadcrumb">
        <button
          onClick={onHome}
          title={contentWorkspace}
          data-terminal-location={location}
          ref={triggerRef}
        >
          <FolderOpen size={15} />
          <span>{project}</span>
        </button>
        {tab && (
          <>
            <ChevronRight size={13} />
            <span className="current-title" title={tabName(tab, metadata, project)}>
              {tabName(tab, metadata, project)}
            </span>
            {terminalDetail && <span className="terminal-detail" title={terminalDetailHint}>{terminalDetail}</span>}
          </>
        )}
      </div>
      <div className="heading-actions">
        {tab && (
          <button
            className="icon-button"
            aria-label={tab.cli_session_id ? "Archive the current session" : "Close the current tab"}
            title={shortcut(tab.cli_session_id ? "Archive the current session ⌘W" : "Close the current tab ⌘W")}
            onClick={onClose}
            disabled={busy}
          >
            {tab.cli_session_id ? <Archive size={16} /> : <X size={16} />}
          </button>
        )}
        {exitButton}
      </div>
    </div>
    {menu}
    {busy && <div className="progress-line" />}
  </header>;
}

// The selected title is primary; tab actions and the add button use the existing
// muted/hover tokens, 8px spacing and browser-tab typography in either layout.
export function BrowserTabRail({ tabs, metadata, active, ready, busy, splitDrag, sidebarButton,
  onSelect, onClose, onRename, onPin, onReorder, onNew }) {
  return <aside className="chrome browser-tab-rail" aria-label="Vertical tab bar">
    <div className="browser-tab-rail-heading">
      {sidebarButton}<strong>Tabs</strong>
      <button className="icon-button browser-new-tab" aria-label="New web page" title={shortcut("New web page ⌘T")}
        disabled={!ready || busy} onClick={onNew}><Plus size={17} /></button>
    </div>
    <WorkspaceTabs tabs={tabs} saved={metadata} active={active} label="Browser tabs" vertical
      ready={ready} busy={busy} splitDrag={splitDrag} onSelect={onSelect} onClose={onClose}
      onRename={onRename} onPin={onPin} onReorder={onReorder} />
  </aside>;
}

export function BrowserHeader({ vault, onManageVault, tab, tabs, metadata, ready, busy, focused, compact, triggerRef, vertical,
  sidebarButton, exitButton, splitDrag, onSelect, onClose, onRename, onPin, onReorder, onNew,
  location, menu, back, forward, action, onNavigate, onOpen, onNewPrivate, onNewRegular, onCloseBrowser, onSettings, onReload, downloads, onStatus, onEditor, onRecover, recoveringEditor }) {
  const [address, setAddress] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [cookiesOpen, setCookiesOpen] = useState(false);
  const toolsTrigger = useRef(), toolsMenu = useRef();
  const url = tab.url === "about:blank" ? "" : tab.url || "";
  useEffect(() => { setAddress(url); }, [tab.id, url]);
  useEffect(() => { setToolsOpen(false); setCookiesOpen(false); }, [tab.id]);
  useEffect(() => {
    if (!toolsOpen) return;
    toolsMenu.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    const dismiss = event => {
      if (!toolsMenu.current?.contains(event.target) && !toolsTrigger.current?.contains(event.target)) setToolsOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [toolsOpen]);
  const menuKey = event => {
    if (event.key === "Tab") {
      setTimeout(() => {
        if (!toolsMenu.current?.contains(document.activeElement) && document.activeElement !== toolsTrigger.current) setToolsOpen(false);
      }, 0);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); setToolsOpen(false); toolsTrigger.current?.focus();
      return;
    }
    if (event.target.getAttribute("role") !== "menuitem") return;
    const items = [...toolsMenu.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(event.target);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length :
      event.key === "ArrowUp" ? (index - 1 + items.length) % items.length :
      event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); items[next].focus(); }
  };
  const closeButton = onCloseBrowser && <button className="icon-button browser-close" aria-label="Close browser"
    title="Close the browser and return to the previous page" onClick={onCloseBrowser}><X size={16} /></button>;
  return <header className={`chrome browser-chrome ${compact ? "split-chrome" : ""}`} data-browser-tab={tab.id}>
    {!vertical && <div className="browser-tab-bar">
      {sidebarButton}
      <WorkspaceTabs
        tabs={tabs}
        saved={metadata}
        active={tab.id}
        label="Browser tabs"
        horizontal
        busy={busy}
        ready={ready}
        onSelect={onSelect}
        onClose={onClose}
        onRename={onRename}
        onPin={onPin}
        splitDrag={splitDrag}
        onReorder={onReorder}
      />
      <button
        className="icon-button browser-new-tab"
        ref={triggerRef}
        data-terminal-location={location}
        aria-label="New web page"
        title={shortcut("New web page ⌘T")}
        disabled={!ready || busy}
        onClick={onNew}
      >
        <Plus size={17} />
      </button>
      {(exitButton || closeButton) && <div className="browser-window-actions">{exitButton}{closeButton}</div>}
    </div>}
    <div className="navigation-row">
      <div className="nav-actions">
        <button
          className="icon-button"
          aria-label="Back"
          disabled={!ready || !back}
          onClick={() =>
            action("/browser/back", { id: tab.id })
          }
        >
          <ArrowLeft size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Forward"
          disabled={!ready || !forward}
          onClick={() =>
            action("/browser/forward", { id: tab.id })
          }
        >
          <ArrowRight size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Reload page"
          disabled={!ready}
          onClick={onReload || (() => action("/browser/reload", { id: tab.id }))}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <form className="address-bar" onSubmit={event => { event.preventDefault(); onNavigate(address); }}>
        {tab.incognito ? <span className="browser-private-badge" title="This session is cleared after all incognito tabs are closed"><ScanEye size={13} />Incognito</span> : <Globe2 size={13} />}
        <input
          aria-label="Web address or search"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => e.target.select()}
          placeholder={
            ready
              ? "Enter a URL or search to open it in Cage"
              : "Browse the web after starting the environment"
          }
          disabled={!ready}
          spellCheck="false"
        />
        <button
          className="address-go"
          type="submit"
          aria-label="Open address"
          disabled={!ready}
        >
          <ArrowUpRight size={15} />
        </button>
      </form>
      <BrowserFavorites current={tab} shortcuts={focused} ready={ready && !busy} onOpen={onOpen} />
      <BrowserDownloads downloads={downloads} ready={ready && !busy} onStatus={onStatus} />
      <button className="icon-button browser-more-trigger" aria-label="Browser menu" title="Browser menu"
        ref={toolsTrigger} aria-haspopup="menu"
        aria-expanded={toolsOpen} aria-controls={`browser-menu-${tab.id}`}
        onKeyDown={event => {
          if (event.key === "ArrowDown") {
            event.preventDefault(); setToolsOpen(true);
            if (toolsOpen) toolsMenu.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
          }
        }}
        onClick={() => { setCookiesOpen(false); setToolsOpen(!toolsOpen); }}><MoreHorizontal size={17} /></button>
      {vertical && exitButton}
      {vertical && closeButton}
    <div className="browser-more-menu" hidden={!toolsOpen} ref={toolsMenu}
      id={`browser-menu-${tab.id}`} role="menu" aria-label="Browser menu" onKeyDown={menuKey}
      onClick={event => {
        const item = event.target.closest('[role="menuitem"]');
        if (item && !item.closest(".vault-browser")) { setToolsOpen(false); toolsTrigger.current?.focus(); }
      }}>
      <div className="browser-more-actions">
        <button className="browser-menu-item" role="menuitem" disabled={!ready || busy} onClick={onNewPrivate}><ScanEye size={16} />New incognito tab</button>
        {tab.incognito && <button className="browser-menu-item" role="menuitem" disabled={!ready || busy} onClick={onNewRegular}><Globe2 size={16} />New regular tab</button>}
        {!tab.login && tab.kind !== "browser-settings" && <button className="browser-menu-item" role="menuitem" disabled={!ready || busy} onClick={() => setCookiesOpen(true)}><Cookie size={16} />Manage cookies</button>}
        <button className="browser-menu-item" role="menuitem" disabled={!ready || busy} onClick={() => onSettings('extensions')}><Puzzle size={16} />Extensions</button>
        <BrowserDownloads menu anchorRef={toolsTrigger} downloads={downloads} ready={ready && !busy} onStatus={onStatus} />
        {tab.kind === "editor" && <button className="browser-menu-item" role="menuitem" aria-label="Restore editor" title="Restart the editor on its own"
          disabled={!ready || busy || recoveringEditor} onClick={onRecover}>
          <RefreshCw size={16} className={recoveringEditor ? "spin" : ""} /><span>Restore editor</span>
        </button>}
      </div>
      {vault && !tab.incognito && tab.kind === "web" && <BrowserVaultBar menu tab={tab} vault={vault} ready={ready} onManage={onManageVault} />}
      <div className="browser-settings-menu-row"><button className="browser-menu-item" role="menuitem" disabled={!ready || busy} onClick={() => onSettings('general')}><Settings size={16} />Settings</button></div>
    </div>
    </div>
    {cookiesOpen && <BrowserCookies key={`${tab.id}:${tab.url}`} tab={tab} onClose={() => { setCookiesOpen(false); toolsTrigger.current?.focus(); }} />}
    {tab.incognito && <p className="browser-private-note">Incognito session · Site data is cleared after all incognito tabs are closed; downloads and favorites you saved are kept.</p>}
    {menu}
    {busy && <div className="progress-line" />}
  </header>;
}
