import { InlineSelect } from "./inline-select";
import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  LoaderCircle,
  Monitor,
  Moon,
  Sun,
  Upload,
  RotateCcw,
  CircleCheck,
  TriangleAlert,
  CircleX,
} from "lucide-react";
import { api, native, nativeAvailable } from "./api";
import { useAppearance } from "./appearance";
import {
  colorGroups,
  colorTokens,
  terminalColorGroups,
  terminalTheme,
  customThemeLimit,
  themeFileLimit,
  parseThemeDocument,
  themeDocument,
  validateThemeName,
  sameTheme,
  presets,
  presetNames,
  presetInfo,
  presetGroups,
  themeCatalog,
  applyThemePreset,
  systemUIFont,
  systemCodeFont,
  themeVariables,
} from "./appearance-state.mjs";

function SettingRow({ label, description, children }) {
  return (
    <div className="appearance-row">
      <div>
        <span>{label}</span>
        {description && <p>{description}</p>}
      </div>
      <div className="appearance-control">{children}</div>
    </div>
  );
}
function FontSizeInput({ label, value, min, onChange }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <div className="font-size-control">
      <input
        aria-label={label}
        type="number"
        min={min}
        max="24"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const number = Number(event.target.value);
          if (Number.isInteger(number) && number >= min && number <= 24)
            onChange(number);
        }}
        onBlur={() => setText(String(value))}
      />
      <span>px</span>
    </div>
  );
}
function ColorField({ label, value, onChange, onReset }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const invalid = !/^#[0-9a-fA-F]{6}$/.test(text);
  const commit = () => {
    if (!invalid && text !== value) onChange(text.toLowerCase());
  };
  return (
    <div className="theme-color-field">
      <span>{label.replace(/^(Light|Dark) theme( terminal)? /, "")}</span>
      <div className="theme-color-value">
        <input
          type="color"
          aria-label={label + " color picker"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          aria-label={label}
          aria-invalid={invalid}
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setText(value);
            }
          }}
        />
        {onReset && (
          <button
            className="icon-button"
            aria-label={label + " reset to auto"}
            title="Reset to automatic color"
            onClick={onReset}
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>
      {invalid && (
        <small className="theme-color-error">Enter # followed by six hex digits</small>
      )}
    </div>
  );
}
function ThemeCard({ variant, value, active, onChange }) {
  const [advanced, setAdvanced] = useState(false);
  const label = variant === "light" ? "Light theme" : "Dark theme";
  const options = presets[variant];
  const patch = (delta) => onChange({ ...value, preset: "custom", ...delta });
  const vars = themeVariables(value, variant);
  const terminal = terminalTheme(value, variant);
  const setColor = (field, key, color) => {
    const next = { ...value[field] };
    if (color === undefined) delete next[key];
    else next[key] = color;
    patch({ [field]: next });
  };
  return (
    <section
      className={`appearance-theme-card ${active ? "current" : ""}`}
      aria-label={label}
    >
      <div className="theme-card-heading">
        <strong>{label}</strong>
        {active && <small>In use</small>}
        <InlineSelect
          aria-label={label + " preset"}
          value={value.preset}
          onValueChange={(next) =>
            onChange(applyThemePreset(value, variant, next))
          }
        >
          {presetGroups.map((group) => (
            <optgroup key={group} label={group}>
              {themeCatalog
                .filter((item) => item.group === group && options[item.id])
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </optgroup>
          ))}
          {!options[value.preset] && (
            <option value={value.preset} disabled>
              {presetNames[value.preset] || "Custom"}
            </option>
          )}
        </InlineSelect>
      </div>
      <div
        className="theme-miniature"
        aria-hidden="true"
        style={{ ...vars, background: value.surface, color: value.ink }}
      >
        <div className="mini-sidebar" style={{ background: vars["--sidebar"] }}>
          <i />
          <i />
          <i />
        </div>
        <div className="mini-content">
          <span style={{ background: vars["--strong"] }} />
          <span />
          <div
            style={{ borderColor: vars["--line"], background: vars["--input"] }}
          >
            <i />
            <b style={{ background: value.accent }} />
          </div>
        </div>
      </div>
      <div className="theme-preset-summary">
        <p>
          {presetInfo[value.preset]?.description ||
            "Custom colors. Save as a theme to reuse them."}
        </p>
        <div
          className="theme-status-preview"
          aria-label={label + " status color preview"}
          style={{ background: value.surface }}
        >
          <span style={{ color: vars["--success"] }}>
            <CircleCheck size={13} />
            Success
          </span>
          <span style={{ color: vars["--warning"] }}>
            <TriangleAlert size={13} />
            Warning
          </span>
          <span style={{ color: vars["--danger"] }}>
            <CircleX size={13} />
            Error
          </span>
        </div>
      </div>
      <div className="theme-base-colors">
        {[
          ["accent", "Accent"],
          ["surface", "Background"],
          ["ink", "Text"],
        ].map(([key, name]) => (
          <ColorField
            key={key}
            label={label + " " + name}
            value={value[key]}
            onChange={(color) => patch({ [key]: color })}
          />
        ))}
      </div>
      <button
        className="theme-customize"
        onClick={() => setAdvanced(!advanced)}
        aria-expanded={advanced}
      >
        Custom
        <ChevronDown size={14} className={advanced ? "rotated" : ""} />
      </button>
      {advanced && (
        <div className="theme-options">
          <p className="theme-options-hint">
            Colors you do not set individually follow the base palette automatically.
          </p>
          {colorGroups.map((group) => (
            <details className="theme-color-group" key={group.label}>
              <summary>{group.label}</summary>
              {group.entries.map(([key, name]) => (
                <ColorField
                  key={key}
                  label={label + " " + name}
                  value={vars[colorTokens[key]]}
                  onChange={(color) => setColor("colors", key, color)}
                  onReset={
                    value.colors?.[key]
                      ? () => setColor("colors", key)
                      : undefined
                  }
                />
              ))}
            </details>
          ))}
          {terminalColorGroups.map((group) => (
            <details className="theme-color-group" key={group.label}>
              <summary>{group.label}</summary>
              {group.entries.map(([key, name]) => (
                <ColorField
                  key={key}
                  label={label + " terminal " + name}
                  value={terminal[key]}
                  onChange={(color) => setColor("terminal", key, color)}
                  onReset={
                    value.terminal?.[key]
                      ? () => setColor("terminal", key)
                      : undefined
                  }
                />
              ))}
            </details>
          ))}
          <div
            className="theme-terminal-preview"
            style={{
              background: terminal.background,
              color: terminal.foreground,
            }}
            aria-label={label + " terminal preview"}
          >
            <span style={{ color: terminal.green }}>~/cage</span> ${" "}
            <span style={{ color: terminal.blue }}>echo</span> hello
            <i style={{ background: terminal.cursor }} />
          </div>
          <button
            className="theme-reset-colors"
            disabled={
              !Object.keys(value.colors || {}).length &&
              !Object.keys(value.terminal || {}).length
            }
            onClick={() => patch({ colors: {}, terminal: {} })}
          >
            <RotateCcw size={13} />
            Reset all to automatic colors
          </button>
          <label>
            Contrast <output>{value.contrast}</output>
            <input
              aria-label={label + " contrast"}
              type="range"
              min="0"
              max="100"
              value={value.contrast}
              style={{ "--range-level": `${value.contrast}%` }}
              onChange={(e) => patch({ contrast: Number(e.target.value) })}
            />
          </label>
          <label>
            Interface font
            <InlineSelect editable
              aria-label={label + " interface font"}
              value={value.fonts.ui}
              placeholder="System default"
              onValueChange={(next) =>
                patch({ fonts: { ...value.fonts, ui: next } })
              }
            >
              <option value="system-ui" />
              <option value="PingFang SC" />
              <option value="Helvetica Neue" />
              <option value="Arial" />
            </InlineSelect>
          </label>
          <label>
            Code font
            <InlineSelect editable
              aria-label={label + " code font"}
              value={value.fonts.code}
              placeholder="System monospace font"
              onValueChange={(next) =>
                patch({ fonts: { ...value.fonts, code: next } })
              }
            >
              <option value="SF Mono" />
              <option value="Menlo" />
              <option value="Monaco" />
              <option value="JetBrains Mono" />
            </InlineSelect>
          </label>
          <label className="appearance-switch">
            <span>Translucent sidebar</span>
            <input
              type="checkbox"
              role="switch"
              aria-label={label + " translucent sidebar"}
              checked={!value.opaqueWindows}
              onChange={(e) => patch({ opaqueWindows: !e.target.checked })}
            />
          </label>
        </div>
      )}
    </section>
  );
}
function ThemeLibrary({ appearance, update, saving, onError }) {
  const themes = appearance.customThemes;
  const matching = themes.find((item) => sameTheme(item, appearance));
  const [selectedId, setSelectedId] = useState(matching?.id || "");
  const [name, setName] = useState(matching?.name || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const input = useRef(null);
  const selected = themes.find((item) => item.id === selectedId);
  const current = selected || matching;
  const dirty = current && !sameTheme(current, appearance);
  const run = async (task) => {
    setBusy(true);
    setNotice("");
    onError("");
    try {
      await task();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const apply = (item) => {
    setSelectedId(item.id);
    setName(item.name);
    setNotice("");
    onError("");
    void update((previous) => ({
      ...previous,
      lightTheme: structuredClone(item.lightTheme),
      darkTheme: structuredClone(item.darkTheme),
    }));
  };
  const save = (replace) =>
    run(async () => {
      const title = validateThemeName(name);
      if (!replace && themes.length >= customThemeLimit)
        throw new Error("You can save at most 50 custom themes. Delete one you do not need first.");
      const document = themeDocument(title, appearance);
      const item = {
        id: replace ? current.id : crypto.randomUUID(),
        name: title,
        lightTheme: document.lightTheme,
        darkTheme: document.darkTheme,
      };
      if (
        await update((previous) => ({
          ...previous,
          customThemes: replace
            ? previous.customThemes.map((old) =>
                old.id === item.id ? item : old,
              )
            : [...previous.customThemes, item],
        }))
      ) {
        setSelectedId(item.id);
        setName(title);
        setNotice("Theme saved");
      }
    });
  const importText = async (text) => {
    const document = parseThemeDocument(text);
    if (themes.length >= customThemeLimit)
      throw new Error("You can save at most 50 custom themes. Delete one you do not need first.");
    const item = {
      id: crypto.randomUUID(),
      name: document.name,
      lightTheme: document.lightTheme,
      darkTheme: document.darkTheme,
    };
    if (
      await update((previous) => ({
        ...previous,
        lightTheme: item.lightTheme,
        darkTheme: item.darkTheme,
        customThemes: [...previous.customThemes, item],
      }))
    ) {
      setSelectedId(item.id);
      setName(item.name);
      setNotice("Theme imported and applied");
    }
  };
  const importFile = () => {
    if (!nativeAvailable()) {
      input.current.click();
      return;
    }
    void run(async () => {
      const text = await native("importTheme");
      if (text) await importText(text);
    });
  };
  const exportFile = () =>
    run(async () => {
      const title = name.trim() || matching?.name || "My theme";
      const text =
        JSON.stringify(themeDocument(title, appearance), null, 2) + "\n";
      const filename =
        title
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
          .replace(/[. ]+$/, "")
          .slice(0, 80) + ".cage-theme.json";
      if (nativeAvailable()) {
        if (await native("exportTheme", { text, filename }))
          setNotice("Theme exported");
      } else {
        const url = URL.createObjectURL(
          new Blob([text], { type: "application/json" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice("Theme file download started");
      }
    });
  return (
    <section className="theme-library" aria-label="My themes">
      <div className="theme-library-heading">
        <div>
          <h4>My themes</h4>
          <p>Save light and dark palettes and fonts together, then switch or share them anytime.</p>
        </div>
        <div className="theme-file-actions">
          <button disabled={busy || saving} onClick={importFile}>
            <Upload size={14} />
            Import theme
          </button>
          <button disabled={busy} onClick={exportFile}>
            <Download size={14} />
            Export theme
          </button>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Choose theme file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void run(async () => {
              if (file.size > themeFileLimit)
                throw new Error("The theme file cannot exceed 256 KB.");
              await importText(await file.text());
            });
        }}
      />
      <div className="theme-library-fields">
        <InlineSelect
          aria-label="Saved themes"
          value={current?.id || ""}
          disabled={busy || saving}
          onValueChange={(next) => {
            const item = themes.find((theme) => theme.id === next);
            if (item) apply(item);
          }}
        >
          <option value="" disabled>
            {themes.length ? "Choose a saved theme" : "No custom themes yet"}
          </option>
          {themes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.id === current?.id && dirty ? " · Modified" : ""}
            </option>
          ))}
        </InlineSelect>
        <input
          aria-label="Theme name"
          placeholder="Name the current palette"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          disabled={busy || saving || !name.trim()}
          onClick={() => save(false)}
        >
          Save as theme
        </button>
      </div>
      {current && (
        <div className="theme-library-manage">
          <span>
            {dirty ? "The current palette has changes not saved to the theme" : "The current palette matches the saved theme"}
          </span>
          {dirty && (
            <button disabled={busy || saving} onClick={() => apply(current)}>
              Restore saved palette
            </button>
          )}
          <button
            disabled={busy || saving || !name.trim()}
            onClick={() => save(true)}
          >
            Update this theme
          </button>
          <button
            disabled={busy || saving}
            onClick={() =>
              run(async () => {
                if (!confirm(`Delete the theme "${current.name}"? The current palette will be kept.`))
                  return;
                if (
                  await update((previous) => ({
                    ...previous,
                    customThemes: previous.customThemes.filter(
                      (item) => item.id !== current.id,
                    ),
                  }))
                ) {
                  setSelectedId("");
                  setName("");
                  setNotice("Theme deleted. The current palette was kept.");
                }
              })
            }
          >
            Delete
          </button>
        </div>
      )}
      {notice && (
        <p className="theme-library-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
export function AppearanceSettings() {
  const { appearance, theme, variant, loading, saving, error, update, retry } =
    useAppearance();
  const [syncing, setSyncing] = useState(false),
    [syncError, setSyncError] = useState(""),
    [synced, setSynced] = useState(false),
    [themeError, setThemeError] = useState("");
  const patch = (delta) => update((previous) => ({ ...previous, ...delta }));
  const sync = async () => {
    setSyncing(true);
    setSyncError("");
    setSynced(false);
    try {
      const value = await api("/appearance/codex");
      if (
        await update((previous) => ({
          ...value,
          customThemes: previous.customThemes,
        }))
      )
        setSynced(true);
    } catch (e) {
      setSyncError(e.message);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="appearance-settings">
      <div className="section-title">
        <h3>Appearance</h3>
        <p>Changes are saved automatically and apply immediately, with no project restart.</p>
      </div>
      <fieldset disabled={loading || syncing} className="appearance-fields">
        <SettingRow
          label="Theme"
          description="Follow the system, or always use the light or dark appearance."
        >
          <div className="appearance-mode" role="group" aria-label="Theme mode">
            {[
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
              ["system", "Follow system", Monitor],
            ].map(([mode, label, Icon]) => (
              <button
                key={mode}
                aria-pressed={appearance.mode === mode}
                onClick={() => patch({ mode })}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        </SettingRow>
        <ThemeLibrary
          key={String(loading)}
          appearance={appearance}
          update={update}
          saving={saving}
          onError={setThemeError}
        />
        {themeError && (
          <div className="error-message" role="alert">
            {themeError}
          </div>
        )}
        <div className="theme-card-grid">
          {["light", "dark"].map((key) => (
            <ThemeCard
              key={key}
              variant={key}
              value={appearance[key + "Theme"]}
              active={variant === key}
              onChange={(value) => patch({ [key + "Theme"]: value })}
            />
          ))}
        </div>
        <h4>Fonts</h4>
        <SettingRow
          label="Interface font size"
          description="Adjust the text size in navigation, tabs and settings."
        >
          <FontSizeInput
            label="Interface font size"
            value={appearance.uiFontSize}
            min={12}
            onChange={(value) => patch({ uiFontSize: value })}
          />
        </SettingRow>
        <SettingRow
          label="Code font size"
          description="Adjust the text size in the built-in terminal and code previews."
        >
          <FontSizeInput
            label="Code font size"
            value={appearance.codeFontSize}
            min={10}
            onChange={(value) => patch({ codeFontSize: value })}
          />
        </SettingRow>
        <div
          className="appearance-sample"
          style={{ fontFamily: theme.fonts.ui || systemUIFont }}
        >
          <span>Focus on the next step in a workspace you know.</span>
          <code
            style={{
              fontFamily: theme.fonts.code || systemCodeFont,
              fontSize: appearance.codeFontSize,
            }}
          >
            const workspace = "Cage";
          </code>
        </div>
        <h4>Display and interaction</h4>
        <SettingRow
          label="Use pointer cursor"
          description="Show a hand cursor when hovering over buttons and other interactive elements."
        >
          <label className="appearance-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="Use pointer cursor"
              checked={appearance.pointerCursors}
              onChange={(e) => patch({ pointerCursors: e.target.checked })}
            />
          </label>
        </SettingRow>
        <SettingRow label="Font smoothing">
          <label className="appearance-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="Font smoothing"
              checked={appearance.fontSmoothing}
              onChange={(e) => patch({ fontSmoothing: e.target.checked })}
            />
          </label>
        </SettingRow>
        <SettingRow label="Reduce motion">
          <InlineSelect
            aria-label="Reduce motion"
            value={appearance.reducedMotion}
            onValueChange={(next) => patch({ reducedMotion: next })}
          >
            <option value="system">Follow system</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </InlineSelect>
        </SettingRow>
        <div className="appearance-import">
          <div>
            <strong>Reuse Codex's appearance</strong>
            <p>Import the current theme, palette and font preferences from Codex on this computer.</p>
          </div>
          <button onClick={sync}>
            {syncing ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Download size={15} />
            )}
            Sync from local Codex
          </button>
        </div>
      </fieldset>
      <div className="appearance-save-state" role="status">
        {saving ? (
          <>
            <LoaderCircle size={13} className="spin" />
            Saving…
          </>
        ) : error ? (
          <>
            <span>Not saved</span>
            <button className="text-button" onClick={retry}>
              Retry save
            </button>
          </>
        ) : (
          <>
            <Check size={14} />
            {synced ? "Codex appearance synced" : "Changes are saved automatically and apply immediately"}
          </>
        )}
      </div>
      {(error || syncError) && (
        <div className="error-message" role="alert">
          {syncError || error}
        </div>
      )}
    </div>
  );
}
