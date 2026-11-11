import React, { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, FileText, LoaderCircle, Upload } from "lucide-react";

// The file is the main input; editable content is secondary. Import remains
// the form's primary action. Reuse the proxy form's spacing and theme tokens.
export function ProxyYAMLInput({
  content,
  disabled,
  onContentChange,
  onFileRead,
  onReadingChange,
}) {
  const input = useRef(null);
  const request = useRef(0);
  const dragDepth = useRef(0);
  const errorID = useId();
  const helpID = useId();
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState("");
  const hasFiles = (event) =>
    Array.from(event.dataTransfer?.types || []).includes("Files");

  useEffect(() => {
    // A missed drop must not navigate the WebView away from the settings form.
    const preventFileNavigation = (event) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const resetDrag = (event) => {
      preventFileNavigation(event);
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", resetDrag);
    window.addEventListener("dragend", resetDrag);
    return () => {
      request.current++;
      onReadingChange(false);
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", resetDrag);
      window.removeEventListener("dragend", resetDrag);
    };
  }, [onReadingChange]);

  const readFiles = async (files) => {
    if (disabled || !files.length) return;
    const current = ++request.current;
    setReading(false);
    onReadingChange(false);
    setError("");
    if (files.length !== 1) {
      setError("Import only one config file at a time; add sources one by one.");
      return;
    }
    const value = files[0];
    if (!/\.(ya?ml|json)$/i.test(value.name)) {
      setError("Choose a .yaml, .yml or .json config file.");
      return;
    }
    if (value.size > 8 * 1024 * 1024) {
      setError("The file is larger than 8 MiB. Trim the config and try again.");
      return;
    }
    setReading(true);
    onReadingChange(true);
    try {
      const text = await value.text();
      if (current !== request.current) return;
      if (!text.trim()) {
        setError("The file is empty. Choose a config file that contains nodes.");
        return;
      }
      onFileRead(value, text);
      setSelected({ name: value.name, size: value.size });
      setEdited(false);
    } catch {
      if (current === request.current)
        setError("Could not read the file. Choose it again or paste the config.");
    } finally {
      if (current === request.current) {
        setReading(false);
        onReadingChange(false);
      }
    }
  };
  const fileSize =
    selected &&
    (selected.size < 1024
      ? `${selected.size} B`
      : selected.size < 1024 ** 2
        ? `${(selected.size / 1024).toFixed(1)} KiB`
        : `${(selected.size / 1024 ** 2).toFixed(1)} MiB`);

  return (
    <div
      className={`proxy-yaml-input${dragging ? " is-dragging" : ""}`}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current++;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        readFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        hidden
        type="file"
        ref={input}
        disabled={disabled}
        accept=".yaml,.yml,.json,text/yaml,application/yaml,application/json"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          readFiles(files);
        }}
      />
      <button
        type="button"
        className="proxy-yaml-dropzone"
        disabled={disabled}
        aria-label={selected ? "Choose a different YAML file" : "Choose a YAML file"}
        aria-describedby={`${helpID}${error ? ` ${errorID}` : ""}`}
        aria-busy={reading}
        onClick={() => input.current?.click()}
      >
        <span className="proxy-yaml-icon" aria-hidden="true">
          {reading ? (
            <LoaderCircle size={22} className="spin" />
          ) : selected ? (
            <FileText size={22} />
          ) : (
            <Upload size={22} />
          )}
        </span>
        <span className="proxy-yaml-file">
          <strong>
            {dragging
              ? "Release to read the config file"
              : reading
                ? "Reading the config…"
                : selected
                  ? selected.name
                  : "Drag the config file here"}
          </strong>
          <span>
            {selected ? "Click or drag in another file to replace it" : "Or click to choose a file"}
          </span>
        </span>
        <span className="proxy-yaml-choose" aria-hidden="true">
          {selected ? "Change file" : "Choose file"}
        </span>
      </button>
      <p id={helpID} className="proxy-yaml-help">
        Supports YAML / YML / JSON, up to 8 MiB per file
      </p>
      <p className="proxy-yaml-status" role="status">
        {reading
          ? "Reading the file. Please wait."
          : selected
            ? `${fileSize} · ${edited ? "Content edited" : "File read"}, waiting for import and verification`
            : ""}
      </p>
      {error && (
        <p id={errorID} className="proxy-yaml-error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          {error}
        </p>
      )}
      <label>
        {selected ? "Config content" : "Or paste the config directly"}
        <textarea
          aria-label="Node YAML"
          rows={7}
          value={content}
          disabled={disabled || reading}
          onChange={(event) => {
            setError("");
            setEdited(true);
            onContentChange(event.target.value);
          }}
          spellCheck={false}
          placeholder="proxies: …"
        />
      </label>
      <p className="field-help">
        Only nodes and explicit proxy chains are imported; Cage manages DNS, listening ports and outbound rules itself.
      </p>
    </div>
  );
}
