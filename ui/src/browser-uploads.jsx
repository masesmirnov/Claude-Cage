import React, { useEffect, useRef, useState } from "react";
import { api, uploadFile, native, nativeAvailable } from "./api";
import { Modal } from "./views";

export function BrowserUploads({ requests = [], onStatus }) {
  const [hidden, setHidden] = useState("");
  const request = requests.find((item) => !item.directory && item.id !== hidden && (!item.kind || item.kind === "chooser"));
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [percent, setPercent] = useState(0);
  const transfer = useRef();
  useEffect(() => {
    setProgress("");
    setError("");
    return () => transfer.current?.abort();
  }, [request?.id]);
  if (!request) return null;
  const target = request.target || "browser";
  const action = (name) => target === "browser" ? `/browser/upload-${name}` : `/input/files/${name}`;
  const body = { id: request.id, ...(target === "browser" ? {} : { target }) };
  const cancel = () => {
    transfer.current?.abort();
    setHidden(request.id);
    void api(action("cancel"), body).catch(() => {});
  };
  const select = async (files) => {
    if (!files.length) return;
    if (
      files.length > (request.multiple ? 100 : 1) ||
      files.some((file) => file.size > 2 * 1024 ** 3)
    ) {
      setError("Each file must be 2 GB or smaller; you can select up to 100 files.");
      return;
    }
    const controller = new AbortController();
    transfer.current = controller;
    setError("");
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(`Transferring ${i + 1}/${files.length}: ${file.name}`);
        setPercent(0);
        await uploadFile(
          `/input/files/${target}/${request.id}?${new URLSearchParams({ name: file.name })}`,
          file,
          {
            signal: controller.signal,
            onProgress: (loaded, total) =>
              setPercent(
                total ? Math.min(100, Math.floor((loaded * 100) / total)) : 100,
              ),
          },
        );
      }
      setProgress("Handing over to the app…");
      await api(action("finish"), body);
      onStatus("The selected files were handed to the app. Confirm the upload result in the app.");
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error.message);
        setProgress("");
        // A failed batch must not retain half of the selected files.
        await api(action("cancel"), body).catch(() => {});
        onStatus(`${error.message}. Click the upload button again.`);
      }
    }
  };
  const choose = async () => {
    setError("");
    try {
      const selection = await native("chooseUploadFiles", { multiple: request.multiple });
      if (selection.canceled) { cancel(); return; }
      setProgress("Transferring the selected files…");
      await native("uploadHostFiles", { target, id: request.id, selection: selection.fileSelection });
      await api(action("finish"), body);
      setHidden(request.id);
      onStatus("The selected files were handed to the app. Confirm the upload result in the app.");
    } catch (error) {
      setError(error.message); setProgress("");
      await api(action("cancel"), body).catch(() => {});
      onStatus(`${error.message}. Click the upload button again.`);
    }
  };
  return (
    <Modal
      title="Upload local files"
      onClose={cancel}
      footer={<button onClick={cancel}>Cancel upload</button>}
    >
      <div className="modal-body browser-upload-body">
        <p>
          Choose the images, videos or documents to upload. Only the selected files are transferred; the target page or app handles the attachments.
        </p>
        {nativeAvailable() ? <button className="primary" disabled={Boolean(progress)} onClick={() => void choose()}>Choose local files</button> : <label className="field">
          Choose local files
          <input
            type="file"
            multiple={request.multiple}
            disabled={Boolean(progress)}
            onChange={(event) =>
              void select(Array.from(event.target.files || []))
            }
          />
        </label>}
        {progress && (
          <>
            <p role="status">
              {progress}{nativeAvailable() ? "" : ` · ${percent}%`}
            </p>
            <progress aria-label="File transfer progress" max="100" value={nativeAvailable() ? undefined : percent} />
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
