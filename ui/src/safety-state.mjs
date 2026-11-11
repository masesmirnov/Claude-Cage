export function isSafetyCheckMessage(message) {
  return typeof message === "string" && /Internet access (?:stays|remains) (?:off|closed|paused)|Complete the critical checks|[Cc]ritical checks? (?:have not|has not|did not) pass|[Cc]ritical check (?:failed|evidence)|[Nn]etwork check (?:failed|lacks valid evidence)|browser configuration check did not pass/i.test(message);
}

export function networkState(status, now = Date.now()) {
  if (!status?.vm_running) return { mode: "stopped", label: "Environment stopped" };
  const gate = status.safety?.gate;
  if (!gate) return { mode: "unknown", label: "Internet access status unconfirmed" };
  const until = Date.parse(gate.until);
  if (gate.mode === "open" && Number.isFinite(until) && until > now)
    return { mode: "open", label: "Internet access allowed" };
  if (gate.mode === "checking" && Number.isFinite(until) && until > now)
    return { mode: "checking", label: "Checking" };
  if (gate.mode === "closed" || (Number.isFinite(until) && until <= now))
    return { mode: "closed", label: "Internet access off" };
  return { mode: "unknown", label: "Internet access status unconfirmed" };
}

export function canonicalExitPolicy(value = {}) {
  return {
    mode: value.mode || "dynamic",
    scope: value.scope || "country",
    ip: (value.ip || "").trim(),
    country_code: (value.country_code || "").trim().toUpperCase(),
    region: (value.region || "").trim().replace(/\s+/g, " "),
    city: (value.city || "").trim().replace(/\s+/g, " "),
  };
}

export function reportForSharing(report) {
  return {
    policy: report.policy,
    created_at: report.created_at,
    checks: report.checks,
    scope: "Sampling and runtime policy checks; not a statement of platform account eligibility or a full virtualization audit",
  };
}

export function isGuestLocalURL(value) {
  if (value === "about:blank") return true;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
