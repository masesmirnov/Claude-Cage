import React, { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { api } from "./api";

export function NetworkLatency({ enabled, revision, selected }) {
  const [sample, setSample] = useState(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false,
      timer;
    const measure = async () => {
      try {
        const proxy = await api("/proxy");
        if (cancelled) return;
        if (!proxy.active || !proxy.running || !proxy.selected) {
          setSample({ label: "Latency —", detail: "The proxy is not connected" });
        } else {
          const result = await api("/proxy/delay", { node_id: proxy.selected });
          if (cancelled) return;
          const current = await api("/proxy");
          if (cancelled) return;
          if (
            !current.active ||
            !current.running ||
            current.selected !== proxy.selected ||
            current.revision !== proxy.revision
          ) {
            setSample(null);
          } else if (Number.isFinite(result.delay) && result.delay > 0) {
            setSample({
              label: `${Math.round(result.delay)} ms`,
              detail:
                "HTTP round-trip latency from the current node to www.gstatic.com (unified latency measure). It usually excludes connection setup and does not reflect how long a page takes to first load. Updates every 30 seconds; click to check again. The environment's internet status is checked separately.",
            });
          } else {
            setSample({
              label: "Latency unavailable",
              detail: "The speed test for the current node failed. Click to retry.",
            });
          }
        }
      } catch {
        if (!cancelled)
          setSample({
            label: "Latency unavailable",
            detail: "Could not measure the current node's latency. Click to retry.",
          });
      } finally {
        if (!cancelled) timer = setTimeout(measure, 30000);
      }
    };
    measure();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, revision, selected, retry]);
  return (
    <button
      className="status-latency"
      aria-label={`Network latency: ${enabled ? sample?.label || "Checking" : "Not connected"}`}
      title={
        enabled
          ? sample?.detail || "Checking the network latency of the current node"
          : "Network latency is checked once the environment starts and the proxy connects"
      }
      disabled={!enabled}
      onClick={() => {
        setSample(null);
        setRetry((value) => value + 1);
      }}
    >
      <Activity size={12} />
      <span>{enabled ? sample?.label || "Testing…" : "Latency —"}</span>
    </button>
  );
}
