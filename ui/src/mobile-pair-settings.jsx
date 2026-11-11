import React, { useEffect, useRef, useState } from "react";
import { api, writeClipboard } from "./api";
import { QrCode } from "lucide-react";

export function MobilePairSettings({ relay, savedRelay, onChange, onConfirm }) {
  const [custom, setCustom] = useState(Boolean(relay));
  const [token, setToken] = useState("");
  const [code, setCode] = useState(null);
  const [paired, setPaired] = useState(false);
  const [device, setDevice] = useState(null);
  const [power, setPower] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const statusRevision = useRef(0);
  useEffect(() => {
    let active = true;
    const check = async () => {
      const revision = statusRevision.current;
      try {
        const state = await api("/mobile-pair");
        if (!active || revision !== statusRevision.current) return;
        setPaired(state.paired);
        setDevice(state.paired ? state.device ?? null : null);
        setPower(state.paired ? state.keep_awake ?? null : null);
        if (state.paired) setCode(null);
        else if (code && Date.now() >= Date.parse(code.expires)) {
          setCode(null);
          setNotice("The QR code has expired. Generate a new one.");
        } else if (code && state.status.includes("not completed")) {
          setCode(null);
          setNotice(state.status);
        }
      } catch (e) {
        if (active && revision === statusRevision.current) setNotice(e.message);
      }
    };
    check();
    const timer = setInterval(check, code ? 1500 : 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [code]);
  async function generate() {
    setBusy(true);
    setNotice("");
    setCode(null);
    try {
      setCode(
        await api("/mobile-pair", {
          relay: savedRelay,
          admin: custom ? token : "",
        }),
      );
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !(await onConfirm({
        title: "Remove the paired phone?",
        body: device?.model
          ? `After removing ${device.model}, this phone must scan the QR code again to reach the workbench.`
          : "This phone must scan the QR code again to reach the workbench.",
        confirm: "Remove phone",
      }))
    )
      return;
    setBusy(true);
    try {
      await api("/mobile-pair", {}, "DELETE");
      statusRevision.current++;
      setPaired(false);
      setDevice(null);
      setPower(null);
      setNotice("");
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  // Center the QR and its actions. Relay controls use the same theme below.
  return (
    <section className="remote-link-settings" aria-label="Remote connection">
      <div className="section-title">
        <h3>Remote connection</h3>
        <p>
          Once a phone is paired, it can open the remote browser and Claude Desktop, continue Claude Code sessions and handle tool approvals.
        </p>
      </div>
      <section className="remote-pair-card" aria-label="Phone pairing">
        <h4>{paired ? "Phone paired" : "Connect to Cage with your phone"}</h4>
        {paired && (
          <p className="remote-pair-device" aria-label="Paired phone">
            {device?.model ? (
              <>
                <strong>{device.model}</strong>
                <span>{device.platform === "ios" ? "iOS" : "Android"}</span>
              </>
            ) : (
              <span>Model not available yet. Update Cage on the phone and reconnect.</span>
            )}
          </p>
        )}
        {paired ? (
          <p role="status">Tap Reconnect on the phone to open the workbench.</p>
        ) : (
          <p className="remote-pair-instruction">
            Open Cage on the phone, choose Connect computer, then scan the QR code with Scan QR code, or choose Use pairing code and paste the pairing code copied on this computer.
          </p>
        )}
        {paired && power?.active && <p className="note">Remote standby has asked the host to stay awake; the screen can still turn off. The original system sleep policy is restored after you remove the pairing or stop the backend service.</p>}
        {paired && power?.error && <p role="alert">Preventing host sleep did not take effect: {power.error}</p>}
        {code && (
          <div className="remote-pair-code">
            <img
              src={code.image}
              alt="Phone pairing QR code"
              width="320"
              height="320"
            />
            <p className="field-help">The QR code is valid for about two minutes. Refresh it once it expires.</p>
          </div>
        )}
        {!code && !paired && (
          <div className="remote-pair-placeholder" aria-hidden="true">
            <QrCode size={64} strokeWidth={1.25} />
          </div>
        )}
        <div className="remote-pair-actions">
          {paired ? (
            <button type="button" disabled={busy} onClick={remove}>
              Remove paired phone
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy || relay !== savedRelay || (custom && !relay)}
              onClick={generate}
            >
              <QrCode size={18} />
              {busy ? "Generating…" : code ? "Refresh QR code" : "Generate pairing QR code"}
            </button>
          )}
          {code && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await writeClipboard(code.manual);
                  setNotice("The one-time pairing code was copied. Paste it on the phone.");
                } catch {
                  setNotice("Copy failed. Use the QR code instead.");
                }
              }}
            >
              Copy pairing code
            </button>
          )}
        </div>
        {!paired && (
          <p className="remote-pair-privacy">
            Give the QR code or pairing code only to the phone you want to authorize.
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
      <section className="remote-relay-settings" aria-label="Relay settings">
        <div className="remote-relay-row">
          <div>
            <h4>Relay service</h4>
            <p className="field-help">
              The phone and computer connect through a relay; you can use the official one or your own.
            </p>
          </div>
          <div
            className="remote-relay-options"
            role="group"
            aria-label="Relay service"
          >
            <button
              type="button"
              aria-pressed={!custom}
              onClick={() => {
                setCustom(false);
                setToken("");
                onChange("");
                setCode(null);
              }}
            >
              Official Cage relay
            </button>
            <button
              type="button"
              aria-pressed={custom}
              onClick={() => setCustom(true)}
            >
              Self-hosted relay
            </button>
          </div>
        </div>
        {custom && (
          <>
            <label>
              Self-hosted relay address
              <input
                value={relay}
                placeholder="https://relay.example.com"
                onChange={(e) => {
                  onChange(e.target.value);
                  setToken("");
                  setCode(null);
                }}
              />
            </label>
            <label>
              Admin token (optional)
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
          </>
        )}
        {relay !== savedRelay && (
          <small>After saving the settings, you can generate pairing codes with the new relay.</small>
        )}
      </section>
    </section>
  );
}
