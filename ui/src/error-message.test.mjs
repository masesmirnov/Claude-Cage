import test from "node:test";
import assert from "node:assert/strict";
import { httpErrorMessage, connectionErrorMessage, nativeFailureMessage } from "./error-message.mjs";

test("HTTP failures name the operation and avoid upstream HTML or opaque runtime output", () => {
  for (const [status, reason] of [[401, "sign-in session"], [409, "operation"], [413, "larger than allowed"], [503, "not ready"], [504, "Timed out"]]) {
    const message = httpErrorMessage("/environment/resources", status, "<html>token=private</html>", "text/html");
    assert.match(message, /resource settings/);
    assert.ok(message.includes(reason));
    assert.ok(!message.includes("private"));
  }
  const specific = "The upload window was closed. Click the web upload button again.";
  assert.equal(httpErrorMessage("/input/files", 409, specific, "text/plain; charset=utf-8"), specific);
  assert.match(connectionErrorMessage("/input/files"), /Transferring files.*connection.*interrupted.*check the result/);
  assert.match(httpErrorMessage("/settings", 503, "", "", "POST"), /Could not confirm whether settings were saved.*check the settings/);
});

test("native errors retain precise rules and explain opaque failures in context", () => {
  assert.match(nativeFailureMessage("exportDiagnostics", "native operation timeout"), /Exporting the diagnostics bundle.*timed out/);
  assert.match(nativeFailureMessage("uploadHostFiles", "operation failed token=private"), /Uploading local files failed.*no recognizable cause/);
  assert.ok(!nativeFailureMessage("uploadHostFiles", "operation failed token=private").includes("private"));
  const rule = "Choose a file inside the local project.";
  assert.equal(nativeFailureMessage("uploadHostFiles", rule), rule);
});
