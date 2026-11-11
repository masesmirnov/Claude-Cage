import { InlineSelect } from "./inline-select";
import React from "react";
import { Globe2, LoaderCircle } from "lucide-react";
import { canonicalExitPolicy } from "./safety-state.mjs";

const countries =
  "US GB CA DE FR NL SE FI IE CH AU NZ JP SG KR HK MO TW IN BR".split(" ");
const names = new Intl.DisplayNames(["en-US"], { type: "region" });

export function ExitPolicyFields({
  value,
  onChange,
  observation,
  onProbe,
  busy,
  probing,
}) {
  const policy = { ...canonicalExitPolicy(), ...value };
  const update = (key, next) => onChange({ ...policy, [key]: next });
  const bind = () =>
    onChange(
      policy.mode === "static"
        ? { ...policy, ip: observation.ip }
        : {
            ...policy,
            country_code: observation.country_code || "",
            ...(policy.scope === "city" || policy.scope === "region"
              ? {
                  region: observation.region || "",
                  ...(policy.scope === "city" ? { city: observation.city || "" } : {}),
                }
              : {}),
          },
    );
  return (
    <>
      <div className="section-title">
        <h3>IP change rules</h3>
        <p>Exits in mainland China are never allowed; static IPs and any-region also require confirming the exit country.</p>
      </div>
      <label className="toggle-row">
        <span>
          <strong>Static IP</strong>
          <small>When on, detecting a different IPv4 address pauses internet access.</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={policy.mode === "static"}
          onChange={(e) =>
            update("mode", e.target.checked ? "static" : "dynamic")
          }
        />
      </label>
      {policy.mode === "static" ? (
        <label>
          Bound IPv4 address
          <input
            value={policy.ip}
            placeholder="The detected address is bound on first save"
            spellCheck="false"
            onChange={(e) => update("ip", e.target.value)}
          />
        </label>
      ) : (
        <>
          <label>
            Allowed range for dynamic IPs
            <InlineSelect
              aria-label="Allowed range for dynamic IPs"
              value={policy.scope}
              onValueChange={(next) => update("scope", next)}
            >
              <option value="city">Same city</option>
              <option value="region">Same state/province</option>
              <option value="country">Same country/region</option>
              <option value="any">Any region (except mainland China)</option>
            </InlineSelect>
          </label>
          {policy.scope !== "any" && (
            <>
              <label>
                Allowed country/region code
                <InlineSelect editable
                  aria-label="Allowed country/region code"
                  value={policy.country_code}
                  onValueChange={(next) =>
                    update("country_code", next.toUpperCase())
                  }
                  placeholder="For example US; leave blank to bind on first save"
                  maxLength={2}
                  spellCheck="false"
                >
                  {countries.map((code) => (
                    <option key={code} value={code}>
                      {names.of(code)}
                    </option>
                  ))}
                </InlineSelect>
              </label>
              {(policy.scope === "city" || policy.scope === "region") && (
                <div className="field-row">
                  <label>
                    State/province
                    <input
                      value={policy.region}
                      onChange={(e) => update("region", e.target.value)}
                      placeholder="For example California"
                    />
                  </label>
                  {policy.scope === "city" && (
                    <label>
                      Allowed city
                      <input
                        value={policy.city}
                        onChange={(e) => update("city", e.target.value)}
                        placeholder="For example Los Angeles"
                      />
                    </label>
                  )}
                </div>
              )}
              <p className="field-help">
                {policy.scope === "city"
                  ? "A city must match both its country and state/province. Names follow the geolocation result, so fill them in from the check result."
                  : policy.scope === "region"
                    ? "A state/province must match its country, including Japanese prefectures. Names follow the check result."
                    : "Check the exit first, then fill in the detected country/region."}
              </p>
            </>
          )}
        </>
      )}
      <div className="probe-line">
        <button disabled={busy} onClick={onProbe}>
          {probing ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Globe2 size={15} />
          )}
          Check current exit
        </button>
        <button
          disabled={
            busy ||
            !observation ||
            (policy.mode === "dynamic" && policy.scope === "any")
          }
          onClick={bind}
        >
          Fill in from check result
        </button>
      </div>
      {observation && (
        <div className="exit-observation">
          <strong>
            {observation.country} · {observation.region} · {observation.city}
          </strong>
          <code>{observation.ip}</code>
          <small>
            {observation.country_code} ·{" "}
            {new Date(observation.checked_at).toLocaleTimeString("en-US")}
          </small>
        </div>
      )}
      <p className="footnote">
        An existing binding is kept; rechecking and restarting never replace the baseline automatically. Internet access is paused when the exit hits a mainland China range, is located in mainland China, its region cannot be confirmed, or it falls outside the saved range. Offline terminals and files remain usable.
      </p>
      <p className="field-help">
        The range is based on approximate IP database geolocation. The backend samples about every 30
        seconds, which cannot replace the proxy's own routing constraints.
      </p>
    </>
  );
}
