import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { installDiagnostics } from "./diagnostics.mjs";
import { DiagnosticBoundary } from "./diagnostics.jsx";
import { ClientRoot } from "./remote-hosts";
import { native } from "./api";
import { WindowControls } from "./window-controls";
import "./style.css";

const Workbench = lazy(() => import("./main.jsx"));

installDiagnostics();
// Keep the native menu usable while the workbench is loading or disconnected.
window.cageNativeAction = (command) => {
  if (window.cageWorkbenchAction) return window.cageWorkbenchAction(command);
  if (command === "quit") return native("quitNow");
};
createRoot(document.getElementById("root")).render(
  <>
    <WindowControls />
    <DiagnosticBoundary>
      <ClientRoot>
        <Suspense
          fallback={
            <div className="client-loading" role="status">
              Opening the workbench…
            </div>
          }
        >
          <Workbench />
        </Suspense>
      </ClientRoot>
    </DiagnosticBoundary>
  </>,
);

window.addEventListener("hashchange", () => {
  if (location.hash) location.reload();
});
