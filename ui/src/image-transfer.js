import { api, native, nativeAvailable } from "./api";

export const imageLimit = 20 * 1024 * 1024;
const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function transferFiles(data) {
  const files = Array.from(data?.files || []);
  if (files.length) return files;
  return Array.from(data?.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

export function hasFiles(data) {
  return (
    Array.from(data?.types || []).includes("Files") ||
    transferFiles(data).length > 0
  );
}

export async function imagePayload(file) {
  if (!imageTypes.has(file.type))
    throw new Error("Choose a PNG, JPEG, WebP or GIF image.");
  if (!file.size || file.size > imageLimit)
    throw new Error("Each image must be 20 MB or smaller.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () =>
        reject(new Error("The image could not be read. Copy or choose it again."));
      image.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > 40_000_000)
      throw new Error("The image cannot exceed 40 megapixels.");
    // Normalize host bitmap formats and animated images to one PNG frame.
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const png = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png || png.size > imageLimit)
      throw new Error("The converted image exceeds 20 MB. Use a smaller image and try again.");
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ png: reader.result.split(",")[1] });
      reader.onerror = () => reject(new Error("The image could not be read."));
      reader.readAsDataURL(png);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readClipboardContent() {
  if (nativeAvailable()) {
    const value = await native("clipboardReadContent");
    if (
      !value ||
      (typeof value.png !== "string" && typeof value.text !== "string" && typeof value.fileSelection !== "string")
    )
      throw new Error("Reading the clipboard failed. Reopen the latest Cage and try again.");
    return value;
  }
  if (navigator.clipboard.read) {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((type) => imageTypes.has(type));
      if (type) return imagePayload(await item.getType(type));
    }
    for (const item of items) {
      if (item.types.includes("text/plain"))
        return { text: await (await item.getType("text/plain")).text() };
    }
    throw new Error("The clipboard has no image or text to paste.");
  }
  return { text: await navigator.clipboard.readText() };
}

export function prepareClipboardPaste(target, id, { windowTarget, valid = () => true } = {}) {
  let disposed = false, sent = false;
  const destination = { target, id, pid: windowTarget?.pid, window: windowTarget?.window };
  const check = () => {
    if (disposed || !valid()) throw new Error("The paste destination has changed. Paste again.");
  };
  const prepared = api("/input/paste/start", destination).then(result => {
    if (result?.available !== true || typeof result.transfer !== "string" && typeof result.context !== "string")
      throw new Error("The guest has not confirmed the paste destination. Sync the environment components and try again.");
    return { transfer: result.transfer, context: result.context };
  });
  // Source reading starts independently. A sender using this binding observes
  // preparation errors, and every content path disposes its preparation.
  void prepared.catch(() => {});
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    void prepared.then(binding => api("/input/paste/cancel", { ...destination, ...binding })).catch(() => {});
  };
  return {
    async send(payload) {
      check();
      const binding = await prepared;
      check();
      if (sent) throw new Error("This paste was already submitted. Check the result at the destination.");
      sent = true;
      try { return await api(typeof payload.text === "string" ? "/input/text" : "/input/image", { ...payload, ...destination, ...binding }); }
      finally { dispose(); }
    },
    dispose,
  };
}

export const sendImage = (payload, target, id, options = {}) =>
  (options.prepared || prepareClipboardPaste(target, id, options)).send(payload);
