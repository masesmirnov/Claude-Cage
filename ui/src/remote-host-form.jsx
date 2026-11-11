import React, { useState } from "react";
import { api } from "./api";
import { InlineSelect } from "./inline-select";
import { Modal } from "./modal";

const emptyHost = () => ({
  name: "",
  host: "",
  port: 22,
  user: "",
  auth: { kind: "key_file", identity_file: "" },
  executable: "cage",
  config_path: "",
});

export function HostForm({ initial, platform, onSaved, onClose }) {
  const [form, setForm] = useState(() =>
    initial ? structuredClone(initial) : emptyHost(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (field, value) =>
    setForm((old) => ({
      ...old,
      [field]: value,
      ...(["host", "port"].includes(field) ? { host_key: undefined } : {}),
    }));
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api(
        form.id ? `/client/hosts/${form.id}` : "/client/hosts",
        { ...form, port: Number(form.port) },
        form.id ? "PUT" : "POST",
      );
      await onSaved(saved);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={form.id ? "Edit remote host" : "Add remote host"}
      onClose={busy ? undefined : onClose}
    >
      <form className="remote-host-form" onSubmit={save}>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy}>
          <label>
            Host name
            <input
              required
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="For example: Tokyo dev machine"
              maxLength={200}
            />
          </label>
          <div className="remote-form-row">
            <label>
              Server address
              <input
                required
                value={form.host}
                onChange={(event) => update("host", event.target.value)}
                placeholder="IP address or domain"
                autoComplete="off"
                spellCheck="false"
              />
            </label>
            <label className="remote-port">
              SSH port
              <input
                required
                type="number"
                min="1"
                max="65535"
                value={form.port}
                onChange={(event) => update("port", event.target.value)}
              />
            </label>
          </div>
          <label>
            SSH username
            <input
              required
              value={form.user}
              onChange={(event) => update("user", event.target.value)}
              placeholder="cage"
              autoComplete="off"
              spellCheck="false"
            />
          </label>
          <label>
            SSH sign-in method
            <InlineSelect
              aria-label="SSH sign-in method"
              value={form.auth.kind}
              onValueChange={(kind) =>
                update("auth", {
                  kind,
                  identity_file:
                    kind === "key_file" ? form.auth.identity_file || "" : "",
                })
              }
            >
              <option value="key_file">Local key file</option>
              <option value="agent">Local SSH agent</option>
            </InlineSelect>
          </label>
          {form.auth.kind === "key_file" && (
            <label>
              Local private key file
              <input
                aria-label="Local private key file"
                required
                value={form.auth.identity_file}
                onChange={(event) =>
                  update("auth", {
                    ...form.auth,
                    identity_file: event.target.value,
                  })
                }
                placeholder={
                  platform === "windows"
                    ? "C:\\Users\\your-name\\.ssh\\id_ed25519"
                    : "/Users/your-name/.ssh/id_ed25519"
                }
                autoComplete="off"
                spellCheck="false"
              />
              <small>Enter an absolute path. The key stays on this computer and is not uploaded to the cloud.</small>
            </label>
          )}
          <details>
            <summary>Cloud install paths</summary>
            <div className="remote-advanced">
              <label>
                Cage program path
                <input
                  value={form.executable || ""}
                  onChange={(event) => update("executable", event.target.value)}
                  placeholder="cage"
                  spellCheck="false"
                />
                <small>Defaults to cage; you can also enter the absolute path of the cloud program.</small>
              </label>
              <label>
                Cage config file
                <input
                  value={form.config_path || ""}
                  onChange={(event) =>
                    update("config_path", event.target.value)
                  }
                  placeholder="Defaults to ~/.claude-cage/config.json of the cloud account"
                  spellCheck="false"
                />
                <small>For a custom path, enter the absolute cloud path.</small>
              </label>
            </div>
          </details>
          <div className="remote-button-row">
            <button className="primary" type="submit">
              Save host
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
