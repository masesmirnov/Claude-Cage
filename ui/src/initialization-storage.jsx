import React, { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { api, native, nativeAvailable } from "./api";

export function InitializationStorage({ value, onChange, disabled }) {
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (value) return;
    let live = true;
    api("/environment/storage").then(location => {
      if (live) onChange({ location, directory: location.suggested_directory || location.directory });
    }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [Boolean(value), onChange, attempt]);
  const locked = disabled || !value || value.location.has_environment;
  async function choose() {
    try {
      const directory = await native("chooseFolder", { purpose: "environmentStorage" });
      if (directory) { onChange({ ...value, directory }); setError(""); }
    } catch (error) { setError(error.message); }
  }
  return <section className="initialization-storage" aria-label="Environment storage directory">
    <label htmlFor="initialization-directory">Storage directory</label>
    <p>The system image, download cache and virtual disk are stored here. The default directory is filled in; you can also choose a dedicated empty folder on another local disk.</p>
    <p>This is Cage's environment data directory. Updating, reinstalling or uninstalling the app keeps the data here; do not delete it manually.</p>
    <div className="initialization-directory-control">
      <input id="initialization-directory" value={value?.directory || ""} disabled={locked} spellCheck={false} placeholder={value ? "Enter the full path of the storage directory" : "Reading the default directory…"} onChange={event => onChange({ ...value, directory: event.target.value })} />
      {nativeAvailable() && <button type="button" disabled={locked} onClick={choose}><FolderOpen size={16} />Choose folder</button>}
    </div>
    {value?.location.has_environment && <p>A virtual disk already exists, so the original storage directory stays in use. You can migrate it in Settings after setup finishes.</p>}
    {error && <p role="alert">{error}<button onClick={() => { setError(""); retry(value => value + 1); }}>Reload</button></p>}
  </section>;
}
