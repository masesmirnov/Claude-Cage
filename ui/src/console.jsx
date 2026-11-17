import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { AccountProvider, AccountGate } from "./account";
import { AppearanceProvider } from "./appearance";
import { ClientRoot } from "./remote-hosts";
import { TerminalView } from "./views";
import "./style.css";

function Console() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const open = (await api("/terminals")).find((item) => item.kind === "shell" && !item.closed);
        if (open) return setSession(open);
        const status = await api("/status");
        setSession(await api("/terminals", { workspace: status.workspace || "", kind: "shell" }));
      } catch (e) {
        setError(e.message);
      }
    })();
  }, []);
  if (!session) return <div className="client-loading" role={error ? "alert" : "status"}>{error || "Opening the terminal…"}</div>;
  return <div className="pane-body" style={{ height: "100vh" }}><TerminalView session={session} visible onStatus={setError} /></div>;
}

createRoot(document.getElementById("root")).render(
  <ClientRoot><AccountProvider><AppearanceProvider><AccountGate><Console /></AccountGate></AppearanceProvider></AccountProvider></ClientRoot>,
);
