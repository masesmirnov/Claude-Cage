import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AudioControls, useAudioOutput } from "../src/audio";
import "../src/style.css";
function Fixture() {
  const [enabled, setEnabled] = useState(true);
  const audio = useAudioOutput(enabled);
  return <div className="app"><output style={{ position: "absolute", top: 0 }}>{audio.state}</output><div style={{ flex: 1 }} /><div className="status-bar"><span className="status-spacer" /><AudioControls audio={audio} /><span>Files sync with this computer</span><button onClick={() => setEnabled(false)}>Stop test environment</button></div></div>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
