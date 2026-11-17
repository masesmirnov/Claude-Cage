import React from "react";
import "./initialization.css";

const labels = { passed: "Passed", failed: "Failed", unknown: "Not finished yet" };

export function ScreenSharingChecks({ checks = [], summary, status }) {
  const items = checks.length ? checks : status?.checks || [];
  const text = summary || status?.summary;
  if (!text && items.length === 0) return null;
  return <>
    {text && <p role="status">{text}</p>}
    {items.length > 0 && <ol className="initialization-checks" aria-label="Screen Sharing check results">
      {items.map(check => <li key={check.id}>
        <strong>{check.title} · {labels[check.state] || "Not finished yet"}</strong>
        <p>{check.evidence}</p>
        {check.state !== "passed" && check.remedy && <p>{check.remedy}</p>}
      </li>)}
    </ol>}
  </>;
}
