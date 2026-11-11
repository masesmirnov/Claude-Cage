import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, KeyRound, LoaderCircle, Monitor, Network, RefreshCw, Search, Smartphone, Terminal, Trash2 } from "lucide-react";
import { api, writeClipboard } from "./api";
import { Modal } from "./modal";
import "./tailscale.css";

const labels = { Running: "Connected", NeedsLogin: "Waiting for sign-in", NeedsMachineAuth: "Waiting for administrator approval", Starting: "Connecting", Stopped: "Disconnected", NotInstalled: "Not installed" };
const descriptions = {
  Stopped: "Sign in to Tailscale to let Cage join your private network. Other devices that join the same network will show up here.",
  NeedsLogin: "Finish signing in on the Tailscale page that opened and authorize this device, then come back here.",
  NeedsMachineAuth: "Sign-in is done. Ask the network's administrator to approve the Cage device in the Tailscale admin console.",
  Starting: "Connecting to Tailscale. The device list updates automatically once connected.",
};
const deviceName = peer => peer.hostname || peer.name?.split(".")[0] || peer.ip;
function DeviceIcon({ os }) { return ["android", "iOS"].includes(os) ? <Smartphone size={20} /> : <Monitor size={20} />; }

export function TailscalePanel({ status, onClose, onOpenBrowser, onInstall, onConfirm }) {
  const [state, setState] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [key, setKey] = useState(""), [notice, setNotice] = useState(""), [query, setQuery] = useState("");
  const [sshOpen, setSSHOpen] = useState(false), [selected, setSelected] = useState(""), [username, setUsername] = useState("");
  const [port, setPort] = useState("80"), [appsOpen, setAppsOpen] = useState(false);
  const mounted = useRef(true), inflight = useRef(false), loginRequested = useRef(false), revision = useRef(0);
  const ready = status.ready && !status.job?.running;
  const connected = ready && state?.backend === "Running";
  const address = state?.ips?.find(ip => !ip.includes(":"));
  const peers = [...(state?.peers || [])].sort((a, b) => Number(b.online) - Number(a.online) || deviceName(a).localeCompare(deviceName(b)));
  const visible = peers.filter(peer => [deviceName(peer), peer.name, peer.ip, peer.os].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())));
  const openLogin = async url => {
    loginRequested.current = false;
    try { if (await onOpenBrowser(url) === false && mounted.current) setError("The sign-in page could not be opened. Click Open sign-in page to retry."); }
    catch { if (mounted.current) setError("The sign-in page could not be opened. Click Open sign-in page to retry."); }
  };
  const refresh = async () => {
    if (inflight.current || !ready) return;
    inflight.current = true;
    const current = ++revision.current;
    try {
      const value = await api("/tailscale");
      if (mounted.current && current === revision.current) {
        setState(value); setError("");
        if (loginRequested.current && value.auth_url) await openLogin(value.auth_url);
        if (value.backend === "Running") loginRequested.current = false;
      }
      return value;
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { inflight.current = false; }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { mounted.current = false; revision.current++; clearInterval(timer); };
  }, [ready]);
  const act = async (action, body = {}) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice(""); revision.current++;
    try {
      inflight.current = true;
      const value = await api(`/tailscale/${action}`, body);
      if (mounted.current) { setState(value); if (action === "add-key") setKey(""); }
      return value;
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { inflight.current = false; if (mounted.current) setBusy(false); }
  };
  const login = async () => {
    loginRequested.current = true;
    const result = await act(state?.enabled ? "login" : "connect");
    if (result?.auth_url) await openLogin(result.auth_url);
    else if (!result || result.backend === "Running") loginRequested.current = false;
  };
  const copy = async (text, message = "Copied") => {
    try { await writeClipboard(text); setNotice(message); }
    catch { setNotice("Copy failed. Select the text and copy it manually."); }
  };
  const stop = async logout => {
    if (!await onConfirm({ title: logout ? "Sign out of Tailscale?" : "Disconnect Tailscale?", body: logout ? "The private network connection will be interrupted, and you will need to sign in again next time. SSH public keys you added are kept." : "The private network connection in use will be interrupted. The sign-in state and SSH public keys are kept.", confirm: logout ? "Sign out" : "Disconnect" })) return;
    loginRequested.current = false;
    if (await act(logout ? "logout" : "disconnect")) { setSelected(""); setSSHOpen(false); }
  };
  return <Modal title="Tailscale" onClose={onClose} wide>
    <div className="modal-body tailscale-panel">
      <div className={`tailscale-overview${connected ? " connected" : ""}`}>
        <div className="tailscale-state" role="status">
          <div className="tailscale-network-icon"><Network size={24} /></div>
          <div><strong>{!ready ? "Waiting for the Cage environment to be ready" : labels[state?.backend] || (state ? "Connection status unconfirmed" : "Reading status…")}</strong>
            <span>{connected ? (state.tailnet || "Tailscale private network") : "Your devices, connected together"}</span>
          </div>
          <button className="icon-button" aria-label="Refresh Tailscale status" disabled={!ready || busy} onClick={refresh}><RefreshCw size={16} /></button>
        </div>
        <p className="field-help">{!ready ? "Start the Cage environment to sign in and connect to the private network." : connected ? "Cage has joined the private network. Pick a device to see its address and use its services." : descriptions[state?.backend] || "Reading the Tailscale status of the current environment."}</p>
        {state?.account && connected && <p className="tailscale-account">Signed in as · {state.account}</p>}
        {ready && state && <div className="tailscale-actions">
          {!state.installed ? <button className="primary-button" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            try { await onInstall(); } catch (e) { setError(e.message); }
            finally { if (mounted.current) setBusy(false); }
          }}>{["macos", "windows-11"].includes(status.guest_system) ? "Update environment components to install" : "Install Tailscale"}</button> : <>
            {!connected && !["NeedsMachineAuth", "Starting"].includes(state.backend) && <button className="primary-button" disabled={busy} onClick={login}>{busy ? <LoaderCircle size={15} className="spin" /> : <ExternalLink size={15} />}{state.enabled ? "Sign in again" : "Connect and sign in"}</button>}
            {state.auth_url && !connected && <button className="quiet-button" disabled={busy} onClick={() => openLogin(state.auth_url)}>Open sign-in page</button>}
            {state.enabled && <button className="quiet-button" disabled={busy} onClick={() => stop(false)}>Disconnect</button>}
            {connected && <button className="quiet-button" disabled={busy} onClick={() => stop(true)}>Sign out</button>}
          </>}
        </div>}
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {connected && state.health?.length > 0 && <div className="tailscale-health" role="status"><strong>The network needs attention</strong>{state.health.map((message, i) => <p key={i}>{message}</p>)}</div>}
      {connected && <section className="tailscale-self" aria-label="This Cage device">
        <DeviceIcon os={state.os} />
        <div><strong>{state.hostname || state.name?.split(".")[0] || "Cage"} <span className="tailscale-badge">Current environment</span></strong><span className="tailscale-address">{address || "Assigning an address…"}{state.os ? ` · ${state.os}` : ""}</span></div>
        {address && <button className="quiet-button" onClick={() => copy(address, "Cage private network address copied")}><Copy size={14} />Copy address</button>}
      </section>}
      <section className="tailscale-section tailscale-devices" aria-labelledby="tailscale-devices-title">
        <div className="tailscale-section-heading"><h3 id="tailscale-devices-title">Devices on the network{connected && <span>{peers.length}</span>}</h3>{connected && peers.length > 0 && <span className="field-help">{peers.filter(peer => peer.online).length} online</span>}</div>
        {connected && peers.length > 0 && <label className="tailscale-search"><Search size={16} /><input aria-label="Search devices" type="search" placeholder="Search by device name or address" value={query} onChange={e => setQuery(e.target.value)} /></label>}
        {!connected ? <div className="tailscale-empty"><Monitor size={26} /><strong>Connect to see your devices</strong><p>Finish signing in in the browser, and the device list appears automatically.</p></div>
          : peers.length === 0 ? <div className="tailscale-empty"><Monitor size={26} /><strong>The private network is connected, but no other devices were found</strong><p>Install Tailscale on a computer or phone and join the same network. Only devices this network allows Cage to discover are shown here.</p></div>
          : visible.length === 0 ? <p className="tailscale-empty">No matching devices. Try another name or address.</p>
          : <div className="tailscale-peers">{visible.map(peer => <article className="tailscale-peer" key={peer.id || peer.ip}>
            <div className="tailscale-peer-row"><DeviceIcon os={peer.os} /><div className="tailscale-peer-info"><strong>{deviceName(peer)}</strong><span>{peer.ip}{peer.os ? ` · ${peer.os}` : ""}</span></div>
              <span className={`tailscale-presence${peer.online ? " online" : ""}`}><i />{peer.online ? "Online" : "Offline"}</span>
              <button className="icon-button" aria-label={`Copy the address of ${deviceName(peer)}`} onClick={() => copy(peer.ip, "Device private network address copied")}><Copy size={15} /></button>
              <button className="quiet-button" aria-expanded={selected === peer.ip} aria-controls={`tailnet-device-${peer.ip}`} onClick={() => { setSelected(selected === peer.ip ? "" : peer.ip); setUsername(""); setPort("80"); }}>Use device<ChevronDown size={14} /></button>
            </div>
            {selected === peer.ip && <div className="tailscale-device-detail" id={`tailnet-device-${peer.ip}`}>
              {peer.name && <p className="field-help tailscale-dns">{peer.name}</p>}
              {!peer.online && <p className="field-help">The device is offline. Connect Tailscale on that device first.</p>}
              <label className="field-label" htmlFor="tailnet-service-port">Access a service on the device</label>
              <p className="field-help">Enter the service port to create a local connection address for the browser, database clients or other apps inside Cage.</p>
              <div className="tailscale-connect-form"><input id="tailnet-service-port" aria-label="Service port" type="number" min="1" max="65535" inputMode="numeric" value={port} onChange={e => setPort(e.target.value)} /><button className="quiet-button" disabled={busy || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535} onClick={async () => { if (await act("open-service", { host: peer.ip, port: Number(port) })) setNotice("The local connection address is ready. Use it inside the Cage environment."); }}>Create connection address</button></div>
              {(state.forwards || []).filter(entry => entry.host === peer.ip).map(entry => <div className="tailscale-forward" key={`${entry.host}:${entry.port}`}><span><strong>Port {entry.port}</strong><code>{entry.address}</code></span><button className="icon-button" aria-label={`Copy the connection address for port ${entry.port}`} onClick={() => copy(entry.address, "Connection address usable inside Cage copied")}><Copy size={14} /></button><button className="quiet-button" onClick={async () => { try { if (await onOpenBrowser(`http://${entry.address}`) === false) setError("The service page could not be opened. Try again."); } catch { setError("The service page could not be opened. Try again."); } }}>Open HTTP page</button></div>)}
              <label className="field-label" htmlFor="tailnet-ssh-user"><Terminal size={14} />SSH connection</label>
              <p className="field-help">Enter the system username on this device. SSH must be enabled on the target device and allow the current account to sign in.</p>
              <div className="tailscale-connect-form"><input id="tailnet-ssh-user" value={username} onChange={e => setUsername(e.target.value)} placeholder="The device's system username" autoComplete="off" maxLength={128} /><button className="quiet-button" disabled={!username.trim() || !/^[a-zA-Z0-9_.@\\-]+$/.test(username.trim())} onClick={() => copy(`ssh -l '${username.trim()}' ${peer.ip}`, "SSH command copied. Run it in a Cage terminal.")}>Copy SSH command</button></div>
              <p className="field-help">SSH, SFTP and tools that use OpenSSH can use the private network address above directly. For other apps, see "Apps using the private network" below.</p>
            </div>}
          </article>)}</div>}
      </section>
      {connected && <section className="tailscale-section">
        <button className="tailscale-disclosure" aria-expanded={sshOpen} aria-controls="tailnet-inbound-ssh" onClick={() => setSSHOpen(!sshOpen)}><span><KeyRound size={16} />SSH into Cage from other devices</span><ChevronDown size={16} /></button>
        {sshOpen && <div id="tailnet-inbound-ssh" className="tailscale-detail">
          <p className="field-help">Configure this only when you need a remote terminal, SFTP or an editor connection. Add the connecting device's SSH public key here; the private key stays on the original device.</p>
          {address && <div className="tailscale-command"><code>{`ssh ${state.user}@${address}`}</code><button className="icon-button" aria-label="Copy the command to connect to Cage" onClick={() => copy(`ssh ${state.user}@${address}`)}><Copy size={15} /></button></div>}
          <label className="field-label" htmlFor="tailscale-key">SSH public key of the connecting device</label>
          <textarea id="tailscale-key" rows={3} placeholder="ssh-ed25519 AAAA…" value={key} onChange={e => setKey(e.target.value)} maxLength={8192} spellCheck={false} />
          <button className="quiet-button" disabled={busy || !key.trim()} onClick={() => act("add-key", { key: key.trim() })}>Add public key</button>
          <div className="tailscale-keys">{(state.keys || []).map(entry => <div className="tailscale-key" key={entry}><code title={entry}>{entry}</code><button className="icon-button" disabled={busy} aria-label="Remove SSH public key" onClick={() => act("remove-key", { key: entry })}><Trash2 size={14} /></button></div>)}</div>
        </div>}
      </section>}
      {connected && state.proxy_url && <section className="tailscale-section">
        <button className="tailscale-disclosure" aria-expanded={appsOpen} aria-controls="tailnet-apps" onClick={() => setAppsOpen(!appsOpen)}><span><Network size={16} />Apps using the private network</span><ChevronDown size={16} /></button>
        {appsOpen && <div id="tailnet-apps" className="tailscale-detail"><p className="field-help">When you need device domain names, HTTPS or several ports directly, configure an HTTP proxy in the app inside Cage. It only allows access to devices visible in this private network; the public internet keeps using the existing exit.</p><button className="quiet-button" onClick={() => copy(state.proxy_url, "Private network HTTP proxy address copied (includes local access credentials)")}>Copy private network proxy address</button><p className="field-help">The proxy address includes local access credentials, so use it only for apps inside Cage. This method supports TCP services; UDP, system VPN and subnet routes are not enabled.</p></div>}
      </section>}
      <p className="field-help tailscale-footer">Other devices must install Tailscale and join the same network. Device access is governed by network permissions; pausing Cage's internet access or stopping the environment interrupts the private network connection.</p>
      {notice && <p className="tailscale-notice" role="status"><Check size={14} />{notice}</p>}
    </div>
  </Modal>;
}
