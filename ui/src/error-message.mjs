export function operationName(path = "", method = "GET") {
  const reading = method === "GET";
  if (path.startsWith("/api/mobile/cli")) return reading ? "Reading session messages" : "Submitting a session action";
  if (path.startsWith("/api/mobile/browser")) return "Connecting to the browser on your computer";
  if (path.startsWith("/api/mobile/desktop")) return "Connecting to Claude Desktop on your computer";
  if (path.startsWith("/environment/resources")) return reading ? "Reading resource settings" : "Applying resource settings";
  if (path === "/environment/initialization") return reading ? "Reading setup progress" : "Saving setup state";
  if (path.startsWith("/environment/versions")) return "Reading environment component versions";
  if (path.startsWith("/environment/")) return "Updating the environment";
  if (path.startsWith("/input/files") || path.startsWith("/browser/files")) return "Transferring files";
  if (path.startsWith("/tailscale")) return reading ? "Reading Tailscale status" : "Running a Tailscale action";
  if (path.startsWith("/browser")) return "Using the browser";
  if (path.startsWith("/proxy")) return reading ? "Reading proxy settings" : "Applying proxy settings";
  if (path.startsWith("/safety")) return "Checking network conditions";
  if (path.startsWith("/settings/probe")) return "Verifying the proxy exit";
  if (path.startsWith("/settings")) return reading ? "Reading settings" : "Saving settings";
  if (path.startsWith("/diagnostics/export")) return "Exporting diagnostic logs";
  if (path.startsWith("/diagnostics")) return "Reading diagnostic logs";
  if (path.startsWith("/projects")) return "Connecting to the project directory";
  if (path.startsWith("/account")) return "Handling an account action";
  if (path.startsWith("/claude-desktop")) return "Using Claude Desktop";
  if (path.startsWith("/terminals")) return "Connecting to the terminal";
  if (path === "/start") return "Starting the environment";
  if (path === "/stop") return "Stopping the environment";
  return "Connecting to the Cage workbench";
}

export function httpErrorMessage(path, status, text = "", contentType = "", method = "GET") {
  // Proxy HTML pages, stack traces and untranslated runtime errors are not UI
  // explanations. Preserve short messages supplied by Cage itself.
  const message = text.trim();
  if (contentType.startsWith("text/plain") && message.length <= 2000 && /^\p{Lu}/u.test(message) && !/<(?:html|body|script|!doctype)\b/i.test(message)) return message;
  if (path === "/settings" && method === "POST" && status === 503) {
    return "Could not confirm whether settings were saved (HTTP 503). Once the connection is back, check the settings and the operation details before deciding whether to save again.";
  }
  const action = operationName(path, method);
  const reasons = {
    400: "The backend did not accept this request. Check what you entered; if it still fails, export a diagnostics bundle in Settings.",
    401: "The workbench sign-in session has expired. Reconnect to Cage, then try again.",
    403: "The backend denied this access. Reopen the workbench from the Cage app.",
    404: "The backend does not provide the required feature. Make sure the app and the backend are both up to date.",
    409: "The environment state has changed or another operation is still running. Refresh the status and wait for it to finish.",
    413: "The file or request is larger than allowed. Use a smaller file or split the work into batches.",
    423: "Cage is locked. Unlock your account first, then try again.",
    429: "Too many requests. Wait a moment and avoid clicking repeatedly.",
    500: "The backend hit an error while handling the request. Export a diagnostics bundle in Settings and include the action you just took.",
    502: "The backend could not reach the service inside the environment. Make sure the environment is running, then check the environment components.",
    503: "The backend service is not ready or is restarting. Wait for the connection to recover, then try again.",
    504: "Timed out waiting for the backend to respond. Check the environment load, and once the connection is back, verify whether the action took effect.",
  };
  return `${action} failed (HTTP ${status}): ${reasons[status] || "No recognizable cause was returned. Export a diagnostics bundle in Settings."}`;
}

export function connectionErrorMessage(path, method = "GET") {
  return `${operationName(path, method)} failed: the connection between the workbench and the Cage backend was interrupted. Click reconnect; if you were saving or uploading, check the result after recovery before retrying.`;
}

export function nativeFailureMessage(action, message = "") {
  if (/^\p{Lu}/u.test(message) && !["File operation failed", "Native operation timed out. Try again.", "Operation failed"].includes(message)) return message;
  const names = { chooseFolder: "Choosing a local folder", chooseUploadFiles: "Choosing files to upload", uploadHostFiles: "Uploading local files", openHostPath: "Opening a local file", exportDiagnostics: "Exporting the diagnostics bundle", appUpdate: "Checking for or installing app updates", clipboardRead: "Reading the clipboard", clipboardWrite: "Writing to the clipboard", refreshSession: "Restoring the workbench sign-in session" };
  return `${names[action] || "Running a local action"} failed: ${/timeout|timed out/i.test(message) ? "timed out waiting for the local component to respond" : "the local component returned no recognizable cause"}. Reconnect to Cage; if it still fails, export a diagnostics bundle in Settings.`;
}
