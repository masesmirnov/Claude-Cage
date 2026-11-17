import { MobilePairSettings } from "./mobile-pair-settings";
import { ArchivedSessions } from "./cli-sessions";
import { Smartphone } from "lucide-react";
import { PasswordVaultSettings } from "./password-vault";
import { KeyRound } from "lucide-react";
import { InlineSelect } from "./inline-select";
import { clientKeyboard, isRemoteClient, saveClientKeyboard } from "./client-context.mjs";
import { shortcut, usesControl } from "./platform.mjs";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Globe2,
  Clock3,
  FolderOpen,
  Check,
  LoaderCircle,
  RotateCcw,
  ArrowLeft,
  Settings,
  Palette,
  UserRound,
  Archive,
  Info,
} from "lucide-react";
import { api } from "./api";
import "./settings.css";
import { SafetyMessage } from "./safety-message";
import { AppearanceSettings } from "./appearance-settings";
import { ProxySettings } from "./proxy-settings";
import { ExitPolicyFields } from "./exit-policy";
import { canonicalExitPolicy } from "./safety-state.mjs";
import { EnvironmentVersions } from "./environment-versions";
import { EnvironmentStorage } from "./environment-storage";
import { EnvironmentCache } from "./environment-cache";
import { ResourceSettings } from "./resources";
import { DiagnosticSettings } from "./diagnostics.jsx";
import { MacOSLogin } from "./macos-login";
import { ScreenSharingChecks } from "./macos-screen-sharing";
import { AccountSettings } from "./account";
import { AboutSettings } from "./about-settings";
const sections = [
  ["account", "Account", UserRound],
  ["vault", "Password vault", KeyRound],
  ["archived-sessions", "Archived sessions", Archive],
  ["keyboard", "General", Settings],
  ["appearance", "Appearance", Palette],
  ["mobile", "Remote connection", Smartphone],
  ["network", "Network and proxy", Globe2],
  ["region", "Time zone and language", Clock3],
  ["project", "Environment and recovery", RotateCcw],
  ["about", "About", Info],
];
export function SettingsPanel({
  current,
  status,
  onClose,
  onSaved,
  onConfirm,
  initialSection = "keyboard",
}) {
  const [localKeyboard, setLocalKeyboard] = useState(() => clientKeyboard(current.keyboard));
  const [accountDirty, setAccountDirty] = useState(false);
  const [proxyDirty, setProxyDirty] = useState(false);
  const [resourceDirty, setResourceDirty] = useState(false);
  const [draft, setDraft] = useState({ ...current }),
    [section, setSection] = useState(initialSection),
    [probe, setProbe] = useState(null),
    [probing, setProbing] = useState(false),
    [probeFailed, setProbeFailed] = useState(false),
    [error, setError] = useState(""),
    [jobId, setJobId] = useState(""),
    [submitting, setSubmitting] = useState(false);
  const changed =
    JSON.stringify({
      ...draft,
      browser_home_url: undefined,
      exit_policy: canonicalExitPolicy(draft.exit_policy),
    }) !==
    JSON.stringify({
      ...current,
      browser_home_url: undefined,
      exit_policy: canonicalExitPolicy(current.exit_policy),
    });
  const environmentChanged = [
    "dns_url",
    "timezone",
    "locale",
    "browser_language",
    "auto_timezone",
    "auto_language",
    "exit_policy",
  ].some((k) =>
    k === "exit_policy"
      ? JSON.stringify(canonicalExitPolicy(draft[k])) !==
        JSON.stringify(canonicalExitPolicy(current[k]))
      : draft[k] !== current[k],
  );
  const busy =
    Boolean(status.job?.running) || Boolean(status.storage_recovery?.required) || probing || submitting || Boolean(jobId);
  // Project folders of the other guest systems are always read directly.
  const linuxGuest = !/^(windows|macos)/.test(status.guest_system || "");
  const update = (key, value) => {
    setDraft((p) => ({ ...p, [key]: value }));
    if (["dns_url"].includes(key)) setProbe(null);
    setError("");
  };
  const close = async () => {
    if (submitting) return;
    if (status.job?.running && jobId) {
      onClose();
      return;
    }
    if (
      (!changed && !accountDirty && !proxyDirty && !resourceDirty) ||
      (await onConfirm({
        title: "Discard unsaved changes?",
        body: "The current environment will not change. Closing discards this form's changes.",
        confirm: "Discard changes",
      }))
    )
      onClose();
  };
  useEffect(() => {
    if (jobId && status.job?.id === jobId && !status.job.running) {
      setJobId("");
      if (status.job.error || status.job.canceled) {
        if (status.job.settings_saved) onSaved();
        setError(status.job.error || status.job.message);
      } else {
        onSaved();
        if (!proxyDirty) onClose();
      }
    }
  }, [status.job, jobId]);
  const check = async () => {
    setProbing(true);
    setProbeFailed(false);
    setError("");
    try {
      const result = await api("/settings/probe", draft);
      setProbe(result);
      if (draft.auto_timezone)
        setDraft((previous) => ({ ...previous, timezone: result.timezone }));
      if (draft.auto_language && result.suggested_locale)
        setDraft((previous) => ({
          ...previous,
          locale: result.suggested_locale,
          browser_language: result.suggested_browser_language,
        }));
    } catch (e) {
      setError(e.message);
      setProbeFailed(true);
    } finally {
      setProbing(false);
    }
  };
  const save = async () => {
    if (busy) return;
    if (
      environmentChanged &&
      status.vm_running &&
      !(await onConfirm({
        title: "Apply settings and restart the environment?",
        body: "Save the files in the editor first. The current terminal sessions will end; browser pages and sign-in state are kept.",
        confirm: "Save and restart",
      }))
    )
      return;
    setError("");
    setSubmitting(true);
    try {
      const payload = { ...draft };
      delete payload.browser_home_url;
      const result = await api("/settings", payload);
      setJobId(result.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };
  const zones = useMemo(
    () => [
      ...new Set([
        "Etc/UTC",
        current.timezone,
        ...(Intl.supportedValuesOf?.("timeZone") || []),
      ]),
    ],
    [],
  );
  const contentRef = useRef();
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [section]);
  const currentLoc = probe || status.location;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement;
    document.getElementById("settings-back")?.focus();
    const dismiss = (event) => {
      if (document.querySelector('[role="dialog"]')) return;
      if (event.type === "cage-close-modal" || event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("cage-close-modal", dismiss);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("cage-close-modal", dismiss);
      previous?.focus?.();
    };
  }, []);
  return (
    <section className="settings-page" aria-label="Settings">
      <aside className="settings-sidebar">
        <button
          id="settings-back"
          className="back-to-workspace"
          onClick={close}
        >
          <ArrowLeft size={17} />
          Back to the workbench
        </button>
        <h2>Settings</h2>
        <nav aria-label="Settings groups">
          {sections.map(([id, label, Icon]) => (
            <button
              key={id}
              className={section === id ? "selected" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={async () => {
                if (id !== section && accountDirty && !(await onConfirm({ title: "Discard unsaved changes?", body: "Saved details and password stay unchanged.", confirm: "Discard changes" }))) return;
                if (id !== section && proxyDirty && !(await onConfirm({ title: "Discard proxy changes that have not been applied?", body: "The current proxy keeps running on the applied route. Leaving discards this node selection.", confirm: "Discard changes" }))) return;
                setSection(id);
              }}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="settings-main">
        <div className={section === "archived-sessions" ? "settings-content settings-content--archives" : section === "mobile" ? "settings-content settings-content--remote" : "settings-content"} ref={contentRef}>
          {section === "appearance" && <AppearanceSettings />}
          {section === "about" && <AboutSettings />}
          {section === "archived-sessions" && <ArchivedSessions ready={status.ready && !busy} />}
          {section === "vault" && <PasswordVaultSettings onConfirm={onConfirm} onDirty={setAccountDirty} />}
          {section === "account" && <AccountSettings busy={busy} onDirty={setAccountDirty} />}
          <fieldset className="settings-fields" disabled={busy && !(section === "project" && status.storage_recovery?.required)}>
            {section === "mobile" && (isRemoteClient()
              ? <section className="section-title"><h3>Connect to this computer</h3><p>Switch to this computer's local environment first, then generate or manage phone pairing codes.</p></section>
              : <MobilePairSettings relay={draft.mobile_relay ?? ""} savedRelay={current.mobile_relay ?? ""} onChange={value => update("mobile_relay",value)} onConfirm={onConfirm} />)}
            {section === "network" && (
              <>
                <ProxySettings
                  onDirty={setProxyDirty}
                  status={status}
                  onConfirm={onConfirm}
                  onApplied={async () => {
                    setProbe(null);
                    const applied = await api("/settings");
                    if (JSON.stringify(canonicalExitPolicy(applied.exit_policy)) !==
                        JSON.stringify(canonicalExitPolicy(current.exit_policy))) {
                      setDraft(previous => ({ ...previous, exit_policy: applied.exit_policy }));
                    }
                    await onSaved();
                  }}
                />
                <label>
                  Encrypted DNS
                  <input
                    value={draft.dns_url}
                    onChange={(e) => update("dns_url", e.target.value)}
                    spellCheck="false"
                  />
                </label>
                <div className="probe-line">
                  <button disabled={busy} onClick={check}>
                    {probing ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Globe2 size={15} />
                    )}
                    Verify exit
                  </button>
                  <span>Look up the IP and location through the current node</span>
                </div>
                {currentLoc && (
                  <div className={`location-result ${probe ? "fresh" : ""}`}>
                    <span className="result-icon">
                      <Globe2 size={19} />
                    </span>
                    <div>
                      <strong>
                        {currentLoc.country} · {currentLoc.city}
                      </strong>
                      <code>{currentLoc.ip}</code>
                      <small>
                        {currentLoc.timezone} ·{" "}
                        {new Date(currentLoc.checked_at).toLocaleTimeString(
                          "en-US",
                          { hour: "2-digit", minute: "2-digit" },
                        )}{" "}
                        {probe ? "Verified" : "Current environment · Last check"}
                      </small>
                    </div>
                    {probe && <Check size={18} />}
                  </div>
                )}
                <p className="footnote">
                  When the proxy is unavailable, Cage stops all outbound internet access. Verify again after changing the form.
                </p>
                <section className="network-exit-policy" aria-label="IP change rules">
                  <ExitPolicyFields
                    value={draft.exit_policy}
                    onChange={(value) => update("exit_policy", value)}
                    observation={probe}
                    onProbe={check}
                    busy={busy}
                    probing={probing}
                  />
                </section>
              </>
            )}
            {section === "region" && (
              <>
                <div className="section-title">
                  <h3>Time zone and language</h3>
                  <p>These settings apply to the system, CLI and browser inside Cage.</p>
                </div>
                {!draft.auto_timezone && !draft.auto_language && (
                  <p className="field-help">
                    The time zone and language use the values you choose manually below. Every exit still has its country or region looked up to confirm it is not in mainland China; static IPs and any-region cannot skip this check.
                  </p>
                )}
                <label className="toggle-row">
                  <span>
                    <strong>Follow the time zone of the exit IP</strong>
                    <small>
                      Looked up again at start or when settings are applied; running tasks are not restarted silently.
                    </small>
                  </span>
                  <input
                    role="switch"
                    type="checkbox"
                    checked={draft.auto_timezone}
                    onChange={(e) => update("auto_timezone", e.target.checked)}
                  />
                </label>
                <label>
                  {draft.auto_timezone ? "Time zone to apply" : "System time zone"}
                  <InlineSelect editable
                    aria-label={draft.auto_timezone ? "Time zone to apply" : "System time zone"}
                    value={draft.timezone}
                    disabled={draft.auto_timezone}
                    onValueChange={(next) => update("timezone", next)}
                  >
                    {zones.map((zone) => (
                      <option key={zone} value={zone} />
                    ))}
                  </InlineSelect>
                </label>
                {draft.auto_timezone && (
                  <div className="inline-info">
                    <Clock3 size={16} />
                    <span>
                      {probe
                        ? `Suggested time zone for the exit: ${probe.timezone}, applied on save.`
                        : "On save, the location is looked up through the proxy; if the lookup fails, the existing setting is kept."}
                    </span>
                    <button
                      className="text-button"
                      onClick={check}
                      disabled={busy}
                    >
                      Check now
                    </button>
                  </div>
                )}
                <label className="toggle-row">
                  <span>
                    <strong>Follow the language suggested for the exit region</strong>
                    <small>
                      Updated at start or when settings are applied. Multilingual regions use the built-in default; with no suggestion, the selected language is kept.
                    </small>
                  </span>
                  <input
                    role="switch"
                    type="checkbox"
                    checked={Boolean(draft.auto_language)}
                    onChange={(e) => update("auto_language", e.target.checked)}
                  />
                </label>
                {draft.auto_language && (
                  <div className="inline-info">
                    <Globe2 size={16} />
                    <span>
                      {currentLoc?.suggested_locale
                        ? `Region suggestion: ${currentLoc.suggested_locale} / ${currentLoc.suggested_browser_language}`
                        : "Check the exit to get a region suggestion, or turn off automatic and choose manually."}
                    </span>
                    <button
                      className="text-button"
                      onClick={check}
                      disabled={busy}
                    >
                      Check now
                    </button>
                  </div>
                )}
                <label>
                  System language
                  <InlineSelect
                    aria-label="System language"
                    value={draft.locale}
                    disabled={draft.auto_language}
                    onValueChange={(next) => update("locale", next)}
                  >
                    {[
                      ["en_US.UTF-8", "English (United States)"],
                      ["zh_CN.UTF-8", "Chinese (Simplified)"],
                      ["zh_TW.UTF-8", "Chinese (Traditional)"],
                      ["ja_JP.UTF-8", "Japanese"],
                      ["de_DE.UTF-8", "Deutsch"],
                      ["fr_FR.UTF-8", "Français"],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                    {![
                      "en_US.UTF-8",
                      "zh_CN.UTF-8",
                      "zh_TW.UTF-8",
                      "ja_JP.UTF-8",
                      "de_DE.UTF-8",
                      "fr_FR.UTF-8",
                    ].includes(draft.locale) && (
                      <option value={draft.locale}>{draft.locale}</option>
                    )}
                  </InlineSelect>
                </label>
                <label>
                  Preferred web language
                  <InlineSelect
                    aria-label="Preferred web language"
                    value={draft.browser_language}
                    disabled={draft.auto_language}
                    onValueChange={(next) => update("browser_language", next)}
                  >
                    {[
                      ["en-US", "English (United States)"],
                      ["zh-CN", "Chinese (Simplified)"],
                      ["zh-TW", "Chinese (Traditional)"],
                      ["ja-JP", "Japanese"],
                      ["de-DE", "Deutsch"],
                      ["fr-FR", "Français"],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                    {![
                      "en-US",
                      "zh-CN",
                      "zh-TW",
                      "ja-JP",
                      "de-DE",
                      "fr-FR",
                    ].includes(draft.browser_language) && (
                      <option value={draft.browser_language}>
                        {draft.browser_language}
                      </option>
                    )}
                  </InlineSelect>
                </label>
                <p className="footnote">
                  Web pages can still choose their language by their own rules. The workbench interface uses English.
                </p>
              </>
            )}
            {section === "keyboard" && (
              <>
                <div className="section-title">
                  <h3>General</h3>
                  <p>Manage the workbench's key conventions and everyday actions.</p>
                </div>
                <label>
                  Time format
                  <InlineSelect inline
                    aria-label="Time format"
                    value={draft.clock_12_hour ? "12" : "24"}
                    onValueChange={(next) => update("clock_12_hour", next === "12")}
                  >
                    <option value="24">24-hour</option>
                    <option value="12">12-hour (AM/PM)</option>
                  </InlineSelect>
                </label>
                <p className="field-help">
                  Uses the 24-hour format by default. Saving updates the clock at the bottom of the workbench with no environment restart; the 12-hour format uses AM/PM to tell morning and afternoon apart.
                </p>
                <label>
                  Claude terminal startup command
                  <input
                    value={draft.claude_terminal_command ?? "claude"}
                    onChange={(e) => update("claude_terminal_command", e.target.value)}
                    placeholder="claude"
                    maxLength={4096}
                    spellCheck="false"
                    autoComplete="off"
                  />
                </label>
                <p className="field-help">
                  After choosing "Claude terminal", this command runs in the selected project, for example claude --continue.
                  Leave blank to use claude. Saving only affects newly created Claude terminals; after you exit Claude you can keep using the shell.
                </p>
                {typeof current.balanced_display === "boolean" && <label className="toggle-row">
                  <span>
                    <strong>Prefer smoothness</strong>
                    <small>Lowers the sharpness of the browser and Claude Desktop; in Linux environments it also reduces Claude Desktop motion. Takes effect on the next environment start.</small>
                  </span>
                  <input type="checkbox" role="switch" checked={draft.balanced_display}
                    onChange={(event) => update("balanced_display", event.target.checked)} />
                </label>}
                {typeof current.project_file_cache === "boolean" && linuxGuest && <label className="toggle-row">
                  <span>
                    <strong>Project file cache</strong>
                    <small>Reduces round trips to this computer when reading project files. Changes made on this computer become visible in the environment after up to 20 seconds, or you can click "Refresh project files" in the project bar to sync right away. Takes effect on the next environment start.</small>
                  </span>
                  <input type="checkbox" role="switch" checked={draft.project_file_cache}
                    onChange={(event) => update("project_file_cache", event.target.checked)} />
                </label>}
                <h4>Keyboard style</h4>
                <div className="choice-list">
                  {[
                    [
                      "mac",
                      "Mac shortcuts",
                      "Use ⌘ for web pages and the editor. Linux and Windows guests use the matching Ctrl shortcuts, and macOS guests keep Command.",
                    ],
                    [
                      "native",
                      "Guest-native shortcuts",
                      "Follow the guest system's conventions for Control, Command and other key combinations.",
                    ],
                  ].map(([value, title, help]) => (
                    <label
                      className={`choice ${(isRemoteClient() ? localKeyboard : draft.keyboard) === value ? "checked" : ""}`}
                      key={value}
                    >
                      <input
                        type="radio"
                        name="keyboard"
                        value={value}
                        checked={(isRemoteClient() ? localKeyboard : draft.keyboard) === value}
                        onChange={() => {
                          if (!isRemoteClient()) { update("keyboard", value); return; }
                          try { saveClientKeyboard(value); setLocalKeyboard(value); setError(""); }
                          catch { setError("Could not save the local keyboard style. Check the local storage space."); }
                        }}
                      />
                      <span>
                        <strong>{title}</strong>
                        <small>{help}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="field-help">
                  The terminal uses {usesControl ? "Ctrl+Shift+C / Ctrl+Shift+V" : "⌘C / ⌘V"} to copy and paste; Ctrl+C is always used to interrupt a command.
                  {isRemoteClient() && "The keyboard style takes effect immediately and is saved only on this client; it does not change cloud settings."}
                </p>
                <h4>Workbench shortcuts</h4>
                <div className="shortcut-list">
                  {[
                    ["Open project", "⌘O"],
                    ["New web page", "⌘T"],
                    ["New terminal", "⌘⇧↵"],
                    ["Address bar", "⌘L"],
                    ["Close current tab", "⌘W"],
                    ["Switch tab", "⌘1–9"],
                    ["Settings", "⌘,"],
                  ].map(([label, key]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <kbd>{shortcut(key)}</kbd>
                    </div>
                  ))}
                </div>
              </>
            )}
            {section === "project" && (
              <>
                <div className="section-title">
                  <h3>Environment and recovery</h3>
                  <p>{isRemoteClient() ? "The project is in the cloud, and changes made in Cage are saved directly to cloud files." : "Changes on this computer and in Cage sync both ways."}</p>
                </div>
                {status.local_vm_storage && !isRemoteClient() && <EnvironmentStorage status={status} onConfirm={onConfirm} />}
                <div className="setting-summary-row">
                  <span>Current project</span>
                  <strong title={current.workspace}>
                    {current.workspace || "No project selected yet"}
                  </strong>
                </div>
                <p className="field-help">
                  {isRemoteClient() ? "Click the plus next to the Projects heading in the sidebar to browse and choose a cloud folder." : "Click the plus next to the Projects heading in the sidebar to choose another local folder."}
                </p>
                <div className="project-explanation">
                  <FolderOpen size={22} />
                  <div>
                    <strong>All projects share one Cage environment</strong>
                    <p>
                      Project folders you explicitly open are shared into the same environment. The host's Claude
                      sign-in, SSH keys and personal configuration are not imported automatically. Browser downloads are all saved to the
                      A separate download staging folder; you can view files or use Save as from the download panel.
                    </p>
                  </div>
                </div>
                <p className="footnote">
                  Switching projects only changes where new terminals and the file editor start; existing terminals, web pages and sign-in state are kept.
                </p>
                {!status.storage_recovery?.required && <EnvironmentVersions status={status} onConfirm={onConfirm} />}
                {!status.storage_recovery?.required && <EnvironmentCache status={status} onConfirm={onConfirm} />}
                {status.guest_system === "macos" && <section aria-label="Guest system permissions">
                  <h4>Guest system permissions</h4>
                  <p className="field-help">Finish the authorization in the restricted guest System Settings window, and Cage checks automatically and reconnects the project.</p>
                  <div className="project-recovery-actions">
                    <MacOSLogin maintenance="projects" label="File sharing permission" disabled={!status.ready || busy} />
                    <MacOSLogin maintenance="screen" label="Screen recording permission" disabled={!status.ready || busy} />
                    <MacOSLogin maintenance="input" label="Accessibility permission" disabled={!status.ready || busy} />
                  </div>
                </section>}
                {status.guest_system === "macos" && !isRemoteClient() && <MacOSScreenSharingSettings disabled={!status.ready || busy} onError={setError} />}
                {!status.storage_recovery?.required && <ResourceSettings status={status} onConfirm={onConfirm} onDirtyChange={setResourceDirty} />}
 <DiagnosticSettings />
                {status.can_restore && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await onConfirm({
                          title: "Restore the previous configuration?",
                          body: "The current environment will stop and the settings from before the last apply will be restored. Terminal processes that have already ended cannot be recovered.",
                          confirm: "Restore and restart",
                        })
                      ) {
                        try {
                          const result = await api("/restore", {});
                          setJobId(result.id);
                        } catch (e) {
                          setError(e.message);
                        }
                      }
                    }}
                  >
                    <RotateCcw size={14} />
                    Restore the previous configuration
                  </button>
                )}
              </>
            )}
          </fieldset>
          {error && (
            <div role="alert" className="error-message">
              <SafetyMessage message={error} />
              {probeFailed && (draft.auto_timezone || draft.auto_language) && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setDraft((previous) => ({
                      ...previous,
                      auto_timezone: false,
                      auto_language: false,
                    }));
                    setProbeFailed(false);
                    setError("");
                    setSection("region");
                  }}
                >
                  Set the time zone and language manually
                </button>
              )}
            </div>
          )}
        </div>
        {(!["appearance", "browser", "account", "vault", "mobile", "archived-sessions", "project", "about"].includes(section) || changed) && (
          <footer className="settings-footer">
            {" "}
            <>
              <span className="save-note">
                {status.job?.running
                  ? status.job.message
                  : proxyDirty
                    ? "Proxy changes are waiting to be applied. Click Apply proxy"
                    : changed
                    ? environmentChanged && status.vm_running
                      ? "Network and system settings need a restart"
                      : "You have unsaved changes"
                    : "No unsaved changes"}
              </span>
              <button onClick={close}>Back to the workbench</button>
              <button
                className="primary"
                disabled={!changed || busy}
                onClick={save}
              >
                {busy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Check size={15} />
                )}{" "}
                {environmentChanged && status.vm_running
                  ? "Save and restart"
                  : "Save settings"}
              </button>
            </>
          </footer>
        )}
      </div>
    </section>
  );
}

function MacOSScreenSharingSettings({ disabled, onError }) {
  const [sharingBusy, setSharingBusy] = useState("");
  const [sharingStatus, setSharingStatus] = useState(null);
  async function run(action) {
    setSharingBusy(action);
    onError("");
    try {
      const result = await api("/environment/macos-screen-sharing", { action });
      if (action !== "open") setSharingStatus(result);
    } catch (error) {
      onError(error.message);
    } finally {
      setSharingBusy("");
    }
  }
  return (
    <section aria-label="Guest Screen Sharing">
      <h4>Guest Screen Sharing</h4>
      <p className="field-help">Everyday "Open guest Screen Sharing" only sets up an SSH loopback forward on this computer and gives the guest no extra internet exit, so you do not need to go offline first. The first installation enables the service during provisioning and checks in the system authorization guide that it actually works; macOS 26 also needs it turned on once by hand in "System Settings → General → Sharing". After that, to re-enable the service or open that settings page again, you must pause the internet in the workbench first.</p>
      <ScreenSharingChecks status={sharingStatus} />
      <div className="project-recovery-actions">
        <button
          type="button"
          className="text-button"
          disabled={disabled || Boolean(sharingBusy)}
          onClick={() => run("check")}
        >
          {sharingBusy === "check" ? <LoaderCircle size={14} /> : null}
          Check Screen Sharing status
        </button>
        <button
          type="button"
          className="text-button"
          disabled={disabled || Boolean(sharingBusy)}
          onClick={() => run("open")}
        >
          {sharingBusy === "open" ? <LoaderCircle size={14} /> : null}
          Open guest Screen Sharing
        </button>
        <button
          type="button"
          className="text-button"
          disabled={disabled || Boolean(sharingBusy)}
          onClick={() => run("enable")}
        >
          {sharingBusy === "enable" ? <LoaderCircle size={14} /> : null}
          Re-enable Screen Sharing service
        </button>
        <MacOSLogin maintenance="sharing" label="Open Screen Sharing settings" disabled={disabled || Boolean(sharingBusy)} />
      </div>
    </section>
  );
}
