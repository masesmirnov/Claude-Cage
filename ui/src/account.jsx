import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Camera,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Fingerprint,
  LockKeyhole,
  LogOut,
  Settings,
} from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import { getClientContext, isRemoteClient } from "./client-context.mjs";
import logo from "./logo.png";
import "./account.css";

const AccountContext = createContext(null);
export const useAccount = () => useContext(AccountContext);
const localDesktop = () => getClientContext().desktop_gateway && !isRemoteClient();
const trustedLogin = (action, password) => api("/client/trusted-login", {
  action, password, connection_id: getClientContext().connection_id,
});
const credentialPresent = (status) => status === "available" || status === "authentication_required";

export function AccountProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState("");
  const [deviceCheck, setDeviceCheck] = useState(null);
  const deviceKey = JSON.stringify([account?.device_binding, account?.devices?.automatic, account?.devices?.biometric]);
  const deviceSupport = deviceCheck?.key === deviceKey ? deviceCheck.value : null;
  const [deviceNotice, setDeviceNotice] = useState("");
  const sequence = useRef(0);
  const refresh = async () => {
    const current = ++sequence.current;
    try {
      const value = await api("/account");
      if (sequence.current === current) {
        setAccount(value);
        setError("");
      }
      return value;
    } catch (e) {
      if (sequence.current === current) setError(e.message);
      throw e;
    }
  };
  const act = async (action, input = {}) => {
    const current = ++sequence.current;
    const value = await api(`/account/${action}`, input);
    if (action !== "logout" && sequence.current === current) setAccount(value);
    return value;
  };
  useEffect(() => {
    if (!account || deviceSupport !== null) return;
    if (!nativeAvailable()) { setDeviceCheck({ key: deviceKey, value: { supported: false } }); return; }
    let live = true;
    native("accountDevice", { operation: "status" })
      .then((value) => { if (live) setDeviceCheck({ key: deviceKey, value: value || { supported: false } }); })
      .catch(() => { if (live) setDeviceCheck({ key: deviceKey, value: { supported: false } }); });
    return () => { live = false; };
  }, [Boolean(account), deviceKey, deviceSupport]);
  const deviceAction = async (operation, kind) => {
    if (!deviceSupport?.device_status) throw new Error("The app launcher needs an update. Reinstall the full Cage app, then set up quick sign-in.");
    try {
      await native("accountDevice", { operation, kind });
    } finally {
      // Failed enrollment may have revoked its server record. Reconcile both
      // sides after failures too, including a credential removed while open.
      await refresh();
      setDeviceCheck(null);
    }
  };
  useEffect(() => {
    let live = true,
      timer;
    const poll = async () => {
      try {
        await refresh();
      } catch {
        /* Keep the last state while disconnected. */
      }
      if (live) timer = setTimeout(poll, document.hidden ? 10000 : 2500);
    };
    const start = async () => {
      try {
        if (location.hash) {
          await api("/session", { token: location.hash.slice(1) });
          history.replaceState(null, "", location.pathname);
        }
        window.dispatchEvent(new Event("cage-session-ready"));
        if (live) await poll();
      } catch (e) {
        if (live) setError(e.message);
      }
    };
    const locked = () => {
      // A 423 can follow a controller restart or directory change. Do not
      // auto-unlock using the previous account's cached Keychain status.
      setDeviceCheck(null);
      setAccount((previous) =>
        previous ? { ...previous, unlocked: false } : previous,
      );
      refresh().catch(() => {});
    };
    start();
    window.addEventListener("cage-account-locked", locked);
    return () => {
      live = false;
      sequence.current++;
      clearTimeout(timer);
      window.removeEventListener("cage-account-locked", locked);
    };
  }, []);
  return (
    <AccountContext.Provider value={{ account, error, refresh, act, deviceSupport, deviceAction, deviceNotice, setDeviceNotice, recheckDevices: () => setDeviceCheck(null) }}>
      {children}
    </AccountContext.Provider>
  );
}

export function AccountAvatar({ account, large = false }) {
  const initial = Array.from(
    account?.username?.trim() || "C",
  )[0].toLocaleUpperCase();
  return (
    <span
      className={`account-avatar ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      {account?.avatar ? <img src={account.avatar} alt="" /> : initial}
    </span>
  );
}

export function MacOSAccountGate({ children }) {
  const { account, act } = useAccount();
  const [name, setName] = useState(account?.macos_guest_user || account?.username || "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!account?.macos_account_host || account.macos_credentials_ready) return children;
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setBusy(true); setError("");
    try { await act("prepare-macos", { username:name, password, confirm_password:confirmation }); setPassword(""); setConfirmation(""); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <main className="account-gate"><div className="account-brand"><img src={logo} alt="" />Cage</div><section className="account-entry">
    <h1>Set up the shared Cage and macOS credentials</h1>
    <p className="account-entry-intro">{account.trusted_local ? "Set a Cage username and password, then continue the guest installation. Existing accounts, files and sign-in state are kept." : "Enter your current Cage password to confirm it for the macOS guest. An existing guest keeps its username and home folder."}</p>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label className="account-field">Username<input required value={name} onChange={event => setName(event.target.value)} maxLength={31} pattern="[a-z][a-z0-9_]{0,30}" readOnly={Boolean(account.macos_guest_user)} autoComplete="username" /></label>
      <p className="field-help">Start with a lowercase letter, then use 1–31 lowercase letters, digits or underscores. The password can use 8–256 characters typeable on a US keyboard.</p>
      <PasswordField label={account.trusted_local ? "Set password" : "Current Cage password"} value={password} onChange={setPassword} autoComplete={account.trusted_local ? "new-password" : "current-password"} />
      <PasswordField label="Confirm password" value={confirmation} onChange={setConfirmation} autoComplete={account.trusted_local ? "new-password" : "current-password"} />
      {error && <p role="alert" className="account-error">{error}</p>}
      <button className="primary account-submit" disabled={busy}>{busy ? "Saving…" : "Save credentials and continue"}</button>
    </fieldset></form>
  </section></main>;
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete = "current-password",
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="account-field">
      <label htmlFor={id}>{label}</label>
      <span className="password-input">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          maxLength={1024}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={`${visible ? "Hide" : "Show"} ${label}`}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
    </div>
  );
}

export function AccountGate({ children }) {
  const { account, error: connectionError, refresh, act, deviceSupport, deviceAction, setDeviceNotice } = useAccount();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [rememberLogin, setRememberLogin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const automaticAttempt = useRef("");
  const gateAcknowledged = useRef(false);
  const trustedAttempt = useRef(false);
  const enterTrusted = async (action) => {
    setBusy(true); setError("");
    try { await trustedLogin(action); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (account?.unlocked) { trustedAttempt.current = false; setRememberLogin(null); return; }
    if (!account || !localDesktop() || trustedAttempt.current || account.require_authentication) return;
    if (!(account.trusted_local || account.trusted_login)) return;
    trustedAttempt.current = true;
    void enterTrusted("resume");
  }, [account?.unlocked, account?.exists, account?.guest_system, account?.trusted_local, account?.trusted_login, account?.require_authentication]);
  useEffect(() => {
    if (!account || account.unlocked || connectionError || gateAcknowledged.current || !nativeAvailable()) return;
    // A working lock/setup screen is a valid upgraded UI. Waiting for the
    // user's password would incorrectly leave the native update unconfirmed.
    native("workbenchReady").then((accepted) => {
      if (accepted === true) gateAcknowledged.current = true;
    }).catch(() => {});
  }, [Boolean(account), account?.unlocked, connectionError]);
  useEffect(() => {
    const id = account?.devices?.automatic;
    if ((account?.trusted_login && localDesktop()) || !id || account.unlocked || account.require_authentication || !deviceSupport?.supported || deviceSupport.device_status?.automatic !== "available" || automaticAttempt.current === id) return;
    automaticAttempt.current = id;
    setBusy(true);
    deviceAction("unlock", "automatic").catch((e) => setError(e.message)).finally(() => setBusy(false));
  }, [account?.unlocked, account?.devices?.automatic, account?.require_authentication, deviceSupport]);
  if (account?.unlocked) return children;
  const creating = account && !account.exists;
  const rememberThisDevice = rememberLogin ?? Boolean(creating || account?.trusted_login || account?.devices?.automatic);
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (creating && password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await act(
        creating ? "create" : "unlock",
        creating
          ? { username, password, confirm_password: confirmation }
          : { password },
      );
      if (localDesktop()) {
        try {
          await trustedLogin(rememberThisDevice ? "enable" : "disable", password);
          await refresh();
        } catch (e) {
          setDeviceNotice(`Signed in, but Remember me could not be ${rememberThisDevice ? "turned on" : "turned off"}: ${e.message}. Try again in Settings → Account.`);
        }
      } else if (creating && rememberThisDevice && deviceSupport?.supported && deviceSupport.device_status) {
        try { await deviceAction("enable", "automatic"); }
        catch (e) { setDeviceNotice(`Account created, but Remember sign-in could not be turned on: ${e.message}. Try again in Settings → Account.`); }
      }
      setPassword("");
      setConfirmation("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="account-gate">
      <div className="account-brand">
        <img src={logo} alt="" />
        Cage
      </div>
      <section
        className="account-entry"
        aria-label={creating ? isRemoteClient() ? "Create cloud account" : "Create local account" : "Unlock Cage"}
      >
        {creating ? (
          <img className="account-welcome-logo" src={logo} alt="" />
        ) : (
          account && <AccountAvatar account={account} large />
        )}
        <h1>
          {creating
            ? "Register a Cage account"
            : account
              ? `Welcome back, ${account.username}`
              : "Connecting to Cage"}
        </h1>
        <p className="account-entry-intro">
          {creating
            ? isRemoteClient() ? "Create an account in the cloud to protect the work and sign-ins on this host." : "Register a username and password, then pick a guest system and install the environment. The macOS guest uses the same credentials."
            : account
              ? account.trusted_local ? "Local workspace" : "Enter your password to continue your work."
              : isRemoteClient() ? "Reading the cloud account…" : "Reading the local account…"}
        </p>
        {account?.background_running && (
          <div className="account-background">
            The background environment is still running and tasks have not stopped
          </div>
        )}
        {account?.trusted_local && <div className="account-trust-choice">
          <p>{localDesktop() ? "Use this computer's trusted credentials for the current system user to enter the workspace." : "Set the account password on a trusted desktop, then sign in here."}</p>
          {localDesktop() && <button className="quiet-button" disabled={busy} onClick={() => enterTrusted("resume")}>{busy ? "Entering…" : "Re-enter local workspace"}</button>}
        </div>}
        {account?.trusted_local && error && <p className="account-error" role="alert">{error}</p>}
        {account && !account.trusted_local && (
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              {creating && (
                <><label className="account-field">
                  Username
                  <input
                    autoFocus
                    autoComplete="username"
                    maxLength={account.macos_account_host ? 31 : 40}
                    pattern={account.macos_account_host ? "[a-z][a-z0-9_]{0,30}" : undefined}
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={account.macos_account_host ? "For example: shihao" : "What should we call you?"}
                  />
                </label>
                {account.macos_account_host && <p className="field-help">Shared with the macOS guest: start with a lowercase letter, then use 1–31 lowercase letters, digits or underscores.</p>}</>
              )}
              <PasswordField
                label={creating ? "Set password" : "Account password"}
                value={password}
                onChange={setPassword}
                autoComplete={creating ? "new-password" : "current-password"}
              />
              {creating && (
                <PasswordField
                  label="Confirm password"
                  value={confirmation}
                  onChange={setConfirmation}
                  autoComplete="new-password"
                />
              )}
              {creating && account.macos_account_host && <p className="field-help">The password can use 8–256 letters, digits, spaces or symbols typeable on a US keyboard. If installation is interrupted, keep using these credentials.</p>}
              {(error || connectionError) && (
                <p className="account-error" role="alert">
                  {error || connectionError}
                </p>
              )}
              {!creating && Object.values(deviceSupport?.device_status || {}).includes("missing") && (
                <p className="field-help" role="status">The quick sign-in credentials for this directory are missing or no longer valid. Unlock with your password, then turn it on again in Settings → Account → Sign-in and unlock.</p>
              )}
              {!creating && Object.values(deviceSupport?.device_status || {}).includes("unavailable") && (
                <p className="field-help" role="status">The system keychain cannot be checked right now. Unlock with your password first. The quick sign-in authorization record is kept.</p>
              )}
              {deviceSupport?.supported && !deviceSupport.device_status && (
                <p className="field-help" role="status">The app launcher needs an update, so quick sign-in cannot be checked right now. Sign in with your password first and reinstall the full Cage app.</p>
              )}
              {(localDesktop() || (creating && deviceSupport?.supported && deviceSupport.device_status)) && (
                <label className="account-device-option check-line">
                  <input type="checkbox" checked={rememberThisDevice} onChange={(e) => setRememberLogin(e.target.checked)} />
                  <span><strong>{localDesktop() ? "Remember me" : "Remember sign-in"}</strong><small>{localDesktop() ? "Trust this computer and open straight in next time as the current system user. Manual locking still requires verification." : "Open straight in next time. Manual locking still requires verification."}</small></span>
                </label>
              )}
              {!creating && deviceSupport?.supported && credentialPresent(deviceSupport.device_status?.biometric) && account.devices?.biometric && (
                <button type="button" className="quiet-button account-submit" disabled={busy}
                  onClick={async () => {
                    setBusy(true); setError("");
                    try { await deviceAction("unlock", "biometric"); }
                    catch (e) { setError(e.message); }
                    finally { setBusy(false); }
                  }}>
                  <Fingerprint size={18} />Unlock with Touch ID
                </button>
              )}
              <button
                className="primary account-submit"
                disabled={busy || !password || (creating && (!username.trim() || (!localDesktop() && nativeAvailable() && deviceSupport === null)))}
              >
                {busy ? "Unlocking…" : creating ? isRemoteClient() ? "Create cloud account" : "Create local account" : "Unlock Cage"}
              </button>
            </fieldset>
          </form>
        )}
        {!account && connectionError && (
          <>
            <p role="alert" className="account-error">
              {connectionError}
            </p>
            <button onClick={() => refresh().catch(() => {})}>Reconnect</button>
          </>
        )}
        <p className="account-local-note">
          <LockKeyhole size={14} />
          {isRemoteClient() ? "Account data is stored on this cloud host" : "Account data is stored only on this device"}
        </p>
        {!account?.trusted_local && <p className="account-recovery-note">
          {creating
            ? "The password needs at least 8 characters and protects the app sign-in credentials. Keep it safe; online recovery is not supported."
            : isRemoteClient() ? "Enter your cloud Cage account password; online recovery is not supported." : "Enter your local account password; online recovery is not supported."}
        </p>}
      </section>
      {nativeAvailable() && (
        <button
          className="text-button account-exit-app"
          onClick={() => native("quitNow").catch((e) => setError(e.message))}
        >
          {account?.background_running ? "Quit the app and keep the backend running" : "Quit Cage"}
        </button>
      )}
    </main>
  );
}

export function AccountMenu({ onSettings, onConfirm, onStatus, busy }) {
  const { account, act, deviceNotice, setDeviceNotice } = useAccount();
  useEffect(() => {
    if (deviceNotice) { onStatus(deviceNotice); setDeviceNotice(""); }
  }, [deviceNotice]);
  const [open, setOpen] = useState(false);
  const root = useRef();
  useEffect(() => {
    if (!open) return;
    root.current.querySelector('[role="menuitem"]').focus();
    const dismiss = (event) => {
      if (
        event.key === "Escape" ||
        (event.type === "click" && !root.current?.contains(event.target))
      ) {
        if (event.key === "Escape") root.current?.querySelector(".account-trigger")?.focus();
        setOpen(false);
      }
    };
    window.addEventListener("click", dismiss);
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("keydown", dismiss);
    };
  }, [open]);
  const perform = async (action) => {
    setOpen(false);
    if (
      action === "logout" &&
      !(await onConfirm({
        title: isRemoteClient() ? "Sign out of the cloud account?" : "Sign out of the local account?",
        body: "This stops the Cage environment and background tasks, and locks the sign-in credentials. Save your files first.",
        confirm: "Stop environment and sign out",
      }))
    )
      return;
    try {
      await act(action);
    } catch (e) {
      onStatus(e.message);
    }
  };
  return (
    <div className="account-menu-root" ref={root}>
      <button
        className="account-trigger"
        aria-label={`Account menu, ${account.username}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <AccountAvatar account={account} />
        <span className="account-trigger-name">
          <strong>{account.username}</strong>
          <small>{account.trusted_local ? "Trusted computer" : isRemoteClient() ? "Cloud account" : "Local account"}</small>
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="account-menu" role="menu" aria-label={isRemoteClient() ? "Cloud account menu" : "Local account menu"}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll("button:enabled")];
            const step = event.key === "ArrowDown" ? 1 : -1;
            items[(items.indexOf(event.target) + step + items.length) % items.length].focus();
          }}
        >
          <div className="account-menu-label">Your Cage</div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSettings("account");
            }}
          >
            <Settings size={16} />
            Settings
          </button>
          {account.trusted_local ? <button role="menuitem" onClick={() => { setOpen(false); onSettings("account"); }}>
            <LockKeyhole size={16} /> Set account password
          </button> : <>
          <div className="account-menu-divider" />
          <button role="menuitem" onClick={() => perform("lock")}>
            <LockKeyhole size={16} />
            Lock Cage<small>Tasks keep running</small>
          </button>
          <button
            role="menuitem"
            disabled={busy}
            onClick={() => perform("logout")}
          >
            <LogOut size={16} />
            Sign out
          </button></>}
        </div>
      )}
    </div>
  );
}

export function AccountSettings({ busy: environmentBusy, onDirty }) {
  const { account, act, refresh } = useAccount();
  const [name, setName] = useState(account.username),
    [avatar, setAvatar] = useState(account.avatar || "");
  const [oldPassword, setOldPassword] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [feedbackTarget, setFeedbackTarget] = useState("profile");
  const file = useRef();
  const changed =
    name !== account.username || avatar !== (account.avatar || "");
  useEffect(() => {
    onDirty?.(changed || Boolean(oldPassword || password || confirmation));
  }, [changed, oldPassword, password, confirmation]);
  useEffect(() => () => onDirty?.(false), []);
  const upload = async (event) => {
    setFeedbackTarget("profile");
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (
      selected.size > 2 * 1024 * 1024 ||
      !["image/png", "image/jpeg"].includes(selected.type)
    ) {
      setError("Choose a PNG or JPEG image of 2 MB or less.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatar(reader.result);
      setError("");
      setMessage("");
    };
    reader.readAsDataURL(selected);
  };
  const save = async (event, changingPassword = false) => {
    event.preventDefault();
    if (busy) return;
    setFeedbackTarget(changingPassword ? "password" : "profile");
    if (changingPassword && password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (changingPassword && account.trusted_local) {
        await trustedLogin("protect", password);
        await refresh();
        setPassword(""); setConfirmation("");
        setMessage("Password set. Use it to sign in the next time you open Cage.");
        return;
      }
      const value = await act(
        changingPassword ? "password" : "profile",
        changingPassword
          ? {
              old_password: oldPassword,
              password,
              confirm_password: confirmation,
            }
          : { username: name, avatar },
      );
      if (changingPassword) {
        setOldPassword("");
        setPassword("");
        setConfirmation("");
        setMessage(value.macos_password_pending ? "Cage password changed. The guest password is waiting to sync and will retry on the next start; until then the guest may still need the old password." : "Password changed. The app sign-in state is unchanged.");
      } else {
        setName(value.username);
        setAvatar(value.avatar || "");
        setMessage("Account details saved.");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const feedback = (
    <>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="account-saved" role="status">
          <Check size={15} />
          {message}
        </p>
      )}
    </>
  );
  if (account.macos_account_host && account.guest_system === "macos" && !account.macos_credentials_ready) return <MacOSAccountGate />;
  return (
    <div className="account-settings">
      <div className="section-title">
        <h3>Account</h3>
        <p>Give your workspace a bit of you.</p>
      </div>
      <form onSubmit={(event) => save(event)}>
        <fieldset disabled={busy || environmentBusy}>
          <div className="account-profile-heading">
            <AccountAvatar account={{ username: name, avatar }} large />
            <div>
              <button
                type="button"
                className="quiet-button"
                onClick={() => file.current.click()}
              >
                <Camera size={16} />
                Change avatar
              </button>
              {avatar && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setAvatar("")}
                >
                  Restore default
                </button>
              )}
              <p className="field-help">
                PNG or JPEG, up to 2 MB, automatically centered and cropped.
              </p>
            </div>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={upload}
            aria-label="Choose avatar image"
          />
          <label className="account-field">
            Username
            <input
              value={name}
              maxLength={40}
              autoComplete="username"
              onChange={(e) => setName(e.target.value)}
              required
              readOnly={account.macos_username_bound}
            />
          </label>
          {account.macos_username_bound && <p className="field-help">This username is already used by the macOS guest. Keep it to continue using the existing account and files.</p>}
          <button
            className="primary"
            disabled={!changed || !name.trim() || busy}
          >
            <Check size={16} />
            Save details
          </button>
        </fieldset>
      </form>
      {feedbackTarget === "profile" && feedback}
      <div className="account-section-divider" />
      <form onSubmit={(event) => save(event, true)}>
        <fieldset disabled={busy || environmentBusy}>
          <h4>Account password</h4>
          <p className="field-help">
            Changing the password does not clear Claude's sign-in state. {account.macos_credentials_ready ? "Cage and the macOS guest share the password; if the guest is off, it syncs after the next start." : isRemoteClient() ? "The password unlocks this cloud Cage and cannot be recovered online." : "The password unlocks this computer and cannot be recovered online."}
          </p>
          {!account.trusted_local && <PasswordField
            label="Current password"
            value={oldPassword}
            onChange={setOldPassword}
          />}
          <PasswordField
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <PasswordField
            label="Confirm new password"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
          />
          <button
            className="quiet-button"
            disabled={busy || (!account.trusted_local && !oldPassword) || !password || !confirmation}
          >
            {account.trusted_local ? "Set password and turn off account-free sign-in" : "Change password"}
          </button>
        </fieldset>
      </form>

      {feedbackTarget === "password" && feedback}
      {localDesktop() && !account.trusted_local && <TrustedDeviceSettings />}
      {!account.trusted_local && <AccountDeviceSettings />}
      <p className="account-settings-note">
        <LockKeyhole size={15} />
        {isRemoteClient() ? "Account, app data and sign-in credentials are stored on this cloud host." : "One local account, one persistent environment. Data and credentials are not uploaded to Cage servers."}
      </p>
    </div>
  );
}

function TrustedDeviceSettings() {
  const { account, refresh } = useAccount();
  const enabled = Boolean(account.trusted_login || account.devices?.automatic);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const update = async (event) => {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      await trustedLogin(enabled ? "disable" : "enable", password);
      setPassword("");
      await refresh();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <form onSubmit={update}>
    <fieldset disabled={busy}>
      <h4>Remember me</h4>
      <p className="field-help">{enabled ? "This computer is trusted and opens straight in as the current system user. Manual locking still requires verification, and signing out revokes trust." : "Verify your account password once to trust this computer and open straight in next time as the current system user."}</p>
      {!enabled && <PasswordField label="Verify account password" value={password} onChange={setPassword} autoComplete="current-password" />}
      <button className="quiet-button" disabled={!enabled && !password}>{enabled ? "Turn off Remember me" : "Trust this computer"}</button>
      {message && <p className="account-error" role="alert">{message}</p>}
    </fieldset>
  </form>;
}

function AccountDeviceSettings() {
  const { account, deviceSupport, deviceAction, recheckDevices } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  if (!deviceSupport?.supported) return null;
  if (!deviceSupport.device_status) return <section className="account-device-settings" aria-label="Sign-in and unlock">
    <h4>Sign-in and unlock</h4>
    <p className="field-help" role="status">The app launcher needs an update, so quick sign-in cannot be checked. Reinstall the full Cage app, then set it up; existing authorizations are kept.</p>
  </section>;
  const states = deviceSupport.device_status || {};
  const description = (kind, fallback) => states[kind] === "missing"
    ? "The credentials for this directory are missing or no longer valid. Turn it on again."
    : states[kind] === "unavailable"
      ? "The system keychain cannot be checked right now; the authorization record is kept. Check again later."
      : states[kind] === "authentication_required"
        ? "The credentials require Touch ID verification, and unlocking will ask for your fingerprint."
        : fallback;
  const change = async (kind, enabled) => {
    setBusy(true); setError(""); setMessage("");
    try {
      await deviceAction(enabled ? "enable" : "disable", kind);
      setMessage(enabled ? "Turned on. The unlock credentials are stored in this Mac's system keychain." : "Quick sign-in authorization turned off.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="account-device-settings" aria-label="Sign-in and unlock">
    <h4>Sign-in and unlock</h4>
    {!localDesktop() && <label className="account-device-option check-line">
      <input type="checkbox" checked={Boolean(account.devices?.automatic) && states.automatic === "available"} disabled={busy || states.automatic === "unavailable"}
        onChange={(event) => change("automatic", event.target.checked)} />
      <span><strong>Remember sign-in</strong><small>{description("automatic", "Open straight in on relaunch. Manual locking still requires your fingerprint or password.")}</small></span>
    </label>}
    <label className="account-device-option check-line">
      <input type="checkbox" checked={Boolean(account.devices?.biometric) && credentialPresent(states.biometric)} disabled={busy || states.biometric === "unavailable" || (!deviceSupport.biometric_available && !credentialPresent(states.biometric))}
        onChange={(event) => change("biometric", event.target.checked)} />
      <span><strong>Unlock with Touch ID</strong><small>{description("biometric", deviceSupport.biometric_available ? "After a manual lock, verify with your fingerprint through the system to enter." : "Set up Touch ID in macOS System Settings first.")}</small></span>
    </label>
    {Object.values(states).includes("unavailable") && <button type="button" className="quiet-button" disabled={busy} onClick={recheckDevices}>Check quick sign-in again</button>}
    <p className="field-help">Signing out revokes this computer's quick sign-in authorization. The password can always be used to unlock.</p>
    {error && <p className="account-error" role="alert">{error}</p>}
    {message && <p className="account-saved" role="status">{message}</p>}
  </section>;
}
