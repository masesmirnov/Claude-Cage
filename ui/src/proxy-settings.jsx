import { InlineSelect } from "./inline-select";
import React, { useEffect, useRef, useState } from "react";
import {
  Download,
  Plus,
  Search,
  RefreshCw,
  Check,
  Activity,
  Server,
  Trash2,
  Pencil,
  LoaderCircle,
  Square,
  CircleHelp,
  ArrowRight,
  X,
  Route,
} from "lucide-react";
import { api } from "./api";
import { SafetyMessage } from "./safety-message";
import { ProxyYAMLInput } from "./proxy-yaml-input";
import "./proxy.css";

const bytes = (v) => {
  const n = Math.max(0, Number(v) || 0);
  if (n < 1024) return `${n.toFixed(0)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
};
function usageLabel(raw) {
  const values = Object.fromEntries(
    (raw || "").split(";").map((v) => v.trim().split("=")),
  );
  const used = Number(values.upload || 0) + Number(values.download || 0);
  return [
    values.total ? `${bytes(used)} / ${bytes(values.total)}` : "",
    Number(values.expire) > 0
      ? `Expires ${new Date(Number(values.expire) * 1000).toLocaleDateString()}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
const emptyForm = {
  name: "",
  url: "",
  content: "",
  interval_hours: 24,
  host_download: false,
};
export function ProxySettings({ status, onApplied, onConfirm, onDirty, initializing = false }) {
  const [proxy, setProxy] = useState(null),
    [tab, setTab] = useState("nodes"),
    [search, setSearch] = useState(""),
    [source, setSource] = useState(""),
    [form, setForm] = useState(null),
    [mode, setMode] = useState("url"),
    [error, setError] = useState(""),
    [pending, setPending] = useState(""),
    [notice, setNotice] = useState(""),
    [delays, setDelays] = useState({}),
    [connections, setConnections] = useState({ connections: [] }),
    [logs, setLogs] = useState([]),
    [port, setPort] = useState("17896"),
    [rates, setRates] = useState({ up: 0, down: 0 });
  const [manual, setManual] = useState({
    name: "",
    type: "socks5",
    server: "",
    port: "1080",
    username: "",
    password: "",
  });
  const [routeDraft, setRouteDraft] = useState(null);
  const [hostRefresh, setHostRefresh] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const alive = useRef(true),
    loading = useRef(false),
    latest = useRef(null),
    measuring = useRef(false),
    portDirty = useRef(false);
  const reload = async () => {
    const value = await api("/proxy");
    if (alive.current) {
      setProxy(value);
      if (!portDirty.current) setPort(String(value.port));
    }
    return value;
  };
  useEffect(() => {
    alive.current = true;
    const tick = async () => {
      if (loading.current) return;
      loading.current = true;
      try {
        await reload();
      } catch (e) {
        if (alive.current) setError(e.message);
      } finally {
        loading.current = false;
      }
    };
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (tab !== "connections" && tab !== "diagnostics") return;
    let cancelled = false;
    const tick = async () => {
      try {
        if (tab === "diagnostics") {
          const result = await api("/proxy/logs");
          if (!cancelled) setLogs(result.lines);
        } else {
          const result = await api("/proxy/connections"),
            now = Date.now();
          if (cancelled) return;
          if (latest.current) {
            const seconds = (now - latest.current.time) / 1000;
            if (seconds > 0)
              setRates({
                up: Math.max(
                  0,
                  (result.uploadTotal - latest.current.uploadTotal) / seconds,
                ),
                down: Math.max(
                  0,
                  (result.downloadTotal - latest.current.downloadTotal) /
                    seconds,
                ),
              });
          }
          latest.current = { ...result, time: now };
          setConnections(result);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      latest.current = null;
    };
  }, [tab]);
  const busy = Boolean(pending) || Boolean(status.job?.running);
  const mutate = async (action, input = {}) => {
    setError("");
    setNotice("");
    setPending(action);
    try {
      const job = await api(`/proxy/${action}`, input);
      let current;
      do {
        await new Promise((resolve) => setTimeout(resolve, 500));
        current = (await api("/status")).job;
        if (current.id !== job.id)
          throw new Error("The operation was replaced by another task. Check the current status.");
      } while (current.running);
      portDirty.current = false;
      const updated = await reload();
      await onApplied();
      if (current.error) throw new Error(current.error);
      if (alive.current) {
        setForm(null);
        if (action === "route" || action === "select") setRouteDraft(null);
        const importedSource =
          action === "import"
            ? updated.sources.at(-1)
            : action === "refresh"
              ? updated.sources.find((source) => source.id === input.id)
              : null;
        setNotice(
          importedSource
            ? `Imported ${importedSource.nodes.length} ${importedSource.nodes.length === 1 ? "node" : "nodes"}, skipped ${importedSource.skipped?.length || 0}${importedSource.skipped?.length ? "; see the reasons under the source" : ""}`
            : current.message || "Done",
        );
        setDelays({});
      }
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setPending("");
    }
  };
  const applyRoute = async (nodeIDs) => {
    if (
      !proxy.active &&
      status.vm_running &&
      !(await onConfirm({
        title: "Enable the built-in proxy and restart the environment?",
        body: "Enabling it for the first time or changing the proxy port needs a restart, and the current terminals will end. Later node switches keep terminal processes, but network connections are re-established.",
        confirm: "Enable and restart",
      }))
    )
      return;
    mutate("route", { node_ids: nodeIDs, port: Number(port) });
  };
  const measure = async (ids) => {
    if (measuring.current) return;
    measuring.current = true;
    setPending("delay");
    setError("");
    try {
      // A small worker pool bounds probes without changing the selected group.
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
          while (index < ids.length && alive.current) {
            const id = ids[index++];
            try {
              const result = await api("/proxy/delay", { node_id: id });
              if (alive.current)
                setDelays((old) => ({ ...old, [id]: `${result.delay} ms` }));
            } catch {
              if (alive.current)
                setDelays((old) => ({ ...old, [id]: "Unavailable / not loaded" }));
            }
          }
        }),
      );
    } finally {
      measuring.current = false;
      if (alive.current) setPending("");
    }
  };
  const submit = () => {
    let value = {
      id: form.id || "",
      name: form.name,
      url: form.url,
      content: form.content,
      interval_hours: form.interval_hours,
      host_download: form.host_download,
    };
    if (mode === "manual" && !form.id) {
      const node = { ...manual, port: Number(manual.port) };
      value = {
        ...form,
        name: form.name || manual.name,
        url: "",
        content: JSON.stringify({ proxies: [node] }),
        interval_hours: 0,
      };
    }
    mutate(form.id ? "edit" : "import", value);
  };
  const savedRoute = proxy?.route?.length
    ? proxy.route
    : proxy?.selected
      ? [proxy.selected]
      : [""];
  const route = routeDraft ?? savedRoute;
  const routeChanged = JSON.stringify(route) !== JSON.stringify(savedRoute);
  useEffect(() => {
    onDirty?.(routeChanged || initializing && Boolean(form));
    return () => onDirty?.(false);
  }, [onDirty, routeChanged, initializing, Boolean(form)]);
  if (!proxy)
    return <div className="proxy-loading" role={error ? "alert" : "status"}>{error || "Reading the proxy configuration…"}</div>;
  const allNodes = proxy.sources.flatMap((s) =>
    s.nodes.map((n) => ({ ...n, source: s.name, sourceID: s.id })),
  );
  const selected = allNodes.find((n) => n.id === proxy.selected);
  const routeValid =
    route.every((id) => allNodes.some((n) => n.id === id)) &&
    new Set(route).size === route.length;
  const routeName = (id) => allNodes.find((n) => n.id === id)?.name || "To be selected";
  const updateHop = (index, id) =>
    setRouteDraft(route.map((current, i) => (i === index ? id : current)));
  const nodes = allNodes.filter(
    (n) =>
      (!source || n.sourceID === source) &&
      `${n.name} ${n.source} ${n.type}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="proxy-manager">
      <div className="section-title">
        <div className="proxy-heading">
          <h3>Built-in proxy</h3>
          <button
            type="button"
            className="icon-button proxy-help-toggle"
            aria-label="Proxy usage guide"
            title={helpOpen ? "Hide the proxy usage guide" : "Show the proxy usage guide"}
            aria-expanded={helpOpen}
            aria-controls="proxy-help"
            onClick={() => setHelpOpen((open) => !open)}
          >
            <CircleHelp size={17} aria-hidden="true" />
          </button>
        </div>
        <p>Choose the final exit and add relays as needed, shared by everything inside Cage.</p>
      </div>
      {helpOpen && (
        <section
          id="proxy-help"
          className="proxy-help"
          aria-labelledby="proxy-help-title"
        >
          <h4 id="proxy-help-title">Proxy usage guide</h4>
          <p className="proxy-help-intro">
            Cage ships with its own proxy core, so there is nothing else to install, such as
            Clash. Have your existing proxy subscription or node details ready; Cage does not provide proxy nodes.
          </p>
          <ol className="proxy-help-steps">
            <li>
              <strong>Import your proxy</strong>
              <p>Open Subscriptions → Add source, enter a source name, then choose one method:</p>
              <ul>
                <li>
                  <strong>Subscription link:</strong> Copy the Clash/Mihomo-format
                  HTTPS
                  subscription URL from your proxy provider, paste it, then click Import and verify. If there are no usable nodes yet, tick "Download this subscription over the host network"; the host must be able to reach that address.
                </li>
                <li>
                  <strong>Local YAML:</strong> Drag in or choose a config file, or paste a YAML config containing nodes,
                  then click Import and verify. You can export the config from an existing proxy client.
                </li>
                <li>
                  <strong>Manual node:</strong> For HTTP CONNECT or
                  SOCKS5. Enter the node name, server address, port, and the username and password from your provider (if any), then click Import and verify.
                </li>
              </ul>
            </li>
            <li>
              <strong>Choose a node and enable it</strong>
              <p>
                After importing, switch to Nodes, choose the final exit, then click Apply proxy. If a residential proxy cannot be reached from your network, choose Chained proxy and add a reachable relay node in front of it; the nodes can come from different subscriptions. If the environment is running when you enable it for the first time, it needs a restart; later switches only rebuild network connections.
              </p>
            </li>
            <li>
              <strong>Confirm you can get online</strong>
              <p>
                {initializing ? "Click Start installation and wait for the guest installation and network checks to finish. The check results on the setup screen are authoritative. " : "Go back to the workbench, start the environment and wait for the network checks to pass. The internet status on the workbench is authoritative. "}Speed test only measures node latency. The browser, terminals and developer tools in Cage
                share the selected node, so there is no need to configure a proxy for each.
              </p>
            </li>
          </ol>
          <div className="proxy-help-notes">
            <strong>Import failed or cannot get online?</strong>
            <p>
              Make sure you copied the subscription URL, not your provider's sign-in or admin page. Single share links, Base64
              node lists, and configs that only reference a remote node list are not supported yet; ask your provider for a
              Clash/Mihomo YAML that contains nodes.
            </p>
            <p>
              If the subscription download fails, check whether the host can reach the subscription address, or use a local
              YAML instead. If a node is unavailable, pick another one and check Diagnostics; after changing nodes you still need to pass the exit
              IP and region checks.
            </p>
          </div>
        </section>
      )}
      <div className="proxy-summary">
        <Server size={22} />
        <div>
          <strong>
            {selected ? `Final exit · ${selected.name}` : "No proxy node configured yet"}
          </strong>
          {savedRoute.length > 1 && (
            <span className="proxy-current-route">
              Current route: {savedRoute.map(routeName).join(" → ")}
            </span>
          )}
          <span>
            {proxy.active
              ? proxy.running
                ? "Cage's built-in core is running"
                : "Core not ready"
              : "Choose a node and apply it; without one, there is no internet access"}{" "}
            · Dedicated port {proxy.port}
          </span>
        </div>
        <span className={`proxy-badge ${proxy.network_open ? "online" : ""}`}>
          {proxy.state_label}
        </span>
      </div>
      {proxy.active && status.location && (
        <p className="field-help">
          Last detected exit: {status.location.ip} · {status.location.country}{" "}
          {status.location.city}. Whether internet access is allowed follows the workbench check status.
        </p>
      )}
      {!proxy.core_available && (
        <div role="alert" className="error-message">
          The installer is missing the bundled proxy core. Rebuild, or install the full Cage app.
        </div>
      )}
      <p className="field-help">
        Only IPv4 TCP and DNS forwarded through a node are allowed; public UDP, IPv6 and ICMP
        stay blocked. Switching closes the old network connections and checks the exit again.
      </p>
      <div role="tablist" aria-label="Proxy management" className="proxy-tabs">
        {[
          ["nodes", "Nodes"],
          ["sources", "Subscriptions"],
          ["connections", "Connections"],
          ["diagnostics", "Diagnostics"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "nodes" && (
        <>
          {allNodes.length > 0 && (
            <section
              className="proxy-route"
              aria-labelledby="proxy-route-title"
            >
              <div className="proxy-route-heading">
                <div>
                  <h4 id="proxy-route-title">Configure the connection method</h4>
                  <p>Use a single exit directly, or reach a residential proxy through a relay.</p>
                </div>
                <div
                  className="proxy-route-mode"
                  role="group"
                  aria-label="Connection method"
                >
                  <button
                    type="button"
                    aria-pressed={route.length === 1}
                    disabled={busy}
                    onClick={() => setRouteDraft([route.at(-1)])}
                  >
                    Single node
                  </button>
                  <button
                    type="button"
                    aria-pressed={route.length > 1}
                    disabled={busy}
                    onClick={() => {
                      if (route.length === 1) setRouteDraft(["", route[0]]);
                    }}
                  >
                    Chained proxy
                  </button>
                </div>
              </div>
              <ol className="proxy-route-hops">
                {route.map((id, index) => {
                  const final = index === route.length - 1;
                  const label = final
                    ? "Final exit"
                    : `Relay node${route.length > 2 ? ` ${index + 1}` : ""}`;
                  return (
                    <li
                      key={index}
                      className={`proxy-route-hop ${final ? "is-exit" : ""}`}
                    >
                      <span className="proxy-hop-number" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="proxy-hop-control">
                        <label htmlFor={`proxy-hop-${index}`}>{label}</label>
                        <InlineSelect
                          id={`proxy-hop-${index}`}
                          aria-label={label}
                          value={id}
                          disabled={busy}
                          onValueChange={(next) => updateHop(index, next)}
                        >
                          <option value="" disabled>
                            Choose the {label.toLowerCase()}
                          </option>
                          {Boolean(id) &&
                            !allNodes.some((n) => n.id === id) && (
                              <option value={id} disabled>
                                The node was removed. Choose again.
                              </option>
                            )}
                          {proxy.sources.map((src) => (
                            <optgroup key={src.id} label={src.name}>
                              {src.nodes.map((n) => (
                                <option
                                  key={n.id}
                                  value={n.id}
                                  disabled={route.some(
                                    (hop, i) => i !== index && hop === n.id,
                                  )}
                                >
                                  {n.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </InlineSelect>
                        {final && <small>Target sites see this node's exit IP</small>}
                      </div>
                      {!final && (
                        <button
                          className="icon-button proxy-hop-remove"
                          type="button"
                          disabled={busy}
                          aria-label={`Remove ${label.toLowerCase()}`}
                          title={`Remove ${label.toLowerCase()}`}
                          onClick={() =>
                            setRouteDraft(route.filter((_, i) => i !== index))
                          }
                        >
                          <X size={15} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
              {route.length > 1 && route.length < allNodes.length && (
                <button
                  type="button"
                  className="proxy-route-add"
                  disabled={busy || route.length >= allNodes.length}
                  onClick={() =>
                    setRouteDraft([...route.slice(0, -1), "", route.at(-1)])
                  }
                >
                  <Plus size={14} />
                  Add relay
                </button>
              )}
              <div className="proxy-route-preview" aria-label="Route to be applied">
                <Route size={16} aria-hidden="true" />
                <span>Cage</span>
                {route.map((id, index) => (
                  <React.Fragment key={index}>
                    <ArrowRight size={13} aria-hidden="true" />
                    <strong>{routeName(id)}</strong>
                  </React.Fragment>
                ))}
                <ArrowRight size={13} aria-hidden="true" />
                <span>Target site</span>
              </div>
              <div className="proxy-route-actions">
                <span aria-live="polite">
                  {routeChanged
                    ? "There are proxy changes that have not been applied"
                    : proxy.active
                      ? "The current configuration is applied"
                      : "Apply the proxy once your selection is done"}
                </span>
                <div>
                  {routeDraft !== null && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRouteDraft(null)}
                    >
                      Undo changes
                    </button>
                  )}
                  <button
                    type="button"
                    className={routeChanged || !proxy.active ? "primary" : ""}
                    disabled={busy || !proxy.core_available || !routeValid}
                    onClick={() => applyRoute(route)}
                  >
                    {pending === "route" ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : !routeChanged && proxy.active ? (
                      <RefreshCw size={14} />
                    ) : (
                      <Check size={14} />
                    )}
                    {routeChanged || !proxy.active ? "Apply proxy" : "Apply again"}
                  </button>
                </div>
              </div>
              {proxy.route_error && (
                <p role="alert" className="proxy-source-error">
                  <SafetyMessage message={proxy.route_error} />
                </p>
              )}
              {error && (
                <div role="alert" className="error-message">
                  <SafetyMessage message={error} />
                </div>
              )}
            </section>
          )}
          {allNodes.length > 0 && (
            <div className="proxy-node-heading">
              <h4>Available nodes</h4>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setTab("sources");
                  setForm({ ...emptyForm });
                  setMode("url");
                }}
              >
                <Plus size={14} />
                Add source
              </button>
            </div>
          )}
          <div className="proxy-toolbar">
            <label className="proxy-search">
              <Search size={15} />
              <input
                aria-label="Search nodes"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search nodes, sources or protocols"
              />
            </label>
            <InlineSelect
              aria-label="Node source"
              value={source}
              onValueChange={(next) => setSource(next)}
            >
              <option value="">All sources</option>
              {proxy.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </InlineSelect>
            <button
              disabled={busy || !proxy.running || !nodes.length}
              title="Measures HTTP round-trip latency. It usually excludes connection setup and does not reflect how long a page takes to first load."
              onClick={() => measure(nodes.map((n) => n.id))}
            >
              <Activity size={14} />
              Speed test
            </button>
          </div>
          {!allNodes.length ? (
            <div className="proxy-empty">
              <Download size={26} />
              <strong>Add your first node source</strong>
              <p>Clash/Mihomo YAML subscriptions, local configs and manual nodes are supported.</p>
              <button
                onClick={() => {
                  setTab("sources");
                  setForm({ ...emptyForm });
                  setMode("url");
                }}
              >
                <Plus size={15} />
                Add source
              </button>
            </div>
          ) : (
            <div className="proxy-node-list">
              {nodes.map((n) => (
                <div
                  className={`proxy-node ${n.id === route.at(-1) ? "selected" : ""}`}
                  key={n.id}
                >
                  <button
                    className="proxy-node-choice"
                    disabled={
                      busy ||
                      !proxy.core_available ||
                      route.slice(0, -1).includes(n.id)
                    }
                    title={
                      route.slice(0, -1).includes(n.id)
                        ? "This node is already used as a relay"
                        : "Select as the final exit; it takes effect after you click Apply proxy"
                    }
                    onClick={() => updateHop(route.length - 1, n.id)}
                    aria-pressed={n.id === route.at(-1)}
                    aria-label={`Select node ${n.name}`}
                  >
                    <span className="proxy-radio">
                      {n.id === route.at(-1) && <Check size={12} />}
                    </span>
                    <span>
                      <strong>{n.name}</strong>
                      <small>
                        {n.source} · {n.type.toUpperCase()}
                      </small>
                    </span>
                  </button>
                  {savedRoute.includes(n.id) && (
                    <span className="proxy-node-role">
                      {n.id === proxy.selected ? "Current exit" : "Current relay"}
                    </span>
                  )}
                  <span className="proxy-delay">
                    {delays[n.id] || "Not tested"}
                  </span>
                  <button
                    aria-label={`Test speed of ${n.name}`}
                    title="Measures HTTP round-trip latency from this node to www.gstatic.com. It usually excludes connection setup and does not reflect how long a page takes to first load."
                    disabled={busy || !proxy.running}
                    onClick={() => measure([n.id])}
                  >
                    <Activity size={14} />
                  </button>
                </div>
              ))}
              {!nodes.length && (
                <p className="field-help">No nodes match the search.</p>
              )}
            </div>
          )}
        </>
      )}
      {tab === "sources" && (
        <>
          <label className="check-line">
            <input
              type="checkbox"
              checked={hostRefresh}
              onChange={(e) => setHostRefresh(e.target.checked)}
            />
            Download subscriptions over the host network when updating manually
          </label>
          <p className="field-help">
            Automatic updates always use the currently configured proxy and never switch to a host download.
          </p>
          <div className="proxy-toolbar">
            <span>
              {proxy.sources.length} {proxy.sources.length === 1 ? "source" : "sources"} · {allNodes.length} {allNodes.length === 1 ? "node" : "nodes"}
            </span>
            <button
              disabled={busy}
              onClick={() => {
                setForm({ ...emptyForm });
                setMode("url");
              }}
            >
              <Plus size={14} />
              Add source
            </button>
          </div>
          {proxy.sources.map((s) => (
            <div className="proxy-source" key={s.id}>
              <div>
                <strong>{s.name}</strong>
                <small>
                  {s.remote ? s.host : "Local import"} · {s.nodes.length} {s.nodes.length === 1 ? "node" : "nodes"} ·{" "}
                  {s.interval_hours && s.remote
                    ? `Updates every ${s.interval_hours} h`
                    : "Manual updates"}
                </small>
                <small>
                  Updated {new Date(s.updated_at).toLocaleString()}
                  {usageLabel(s.usage) && ` · ${usageLabel(s.usage)}`}
                </small>
                {s.error && (
                  <span className="proxy-source-error">{s.error}</span>
                )}
                {s.skipped?.length > 0 && (
                  <details className="proxy-source-skipped">
                    <summary>
                      Imported {s.nodes.length} {s.nodes.length === 1 ? "node" : "nodes"}, skipped {s.skipped.length}
                      · See reasons
                    </summary>
                    <ul>
                      {s.skipped.map((issue) => (
                        <li key={issue.index}>
                          Node {issue.index}
                          {issue.name && ` "${issue.name}"`}
                          {issue.type && ` (${issue.type})`}: {issue.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="proxy-source-actions">
                {s.remote && (
                  <button
                    disabled={busy}
                    aria-label={`Update ${s.name}`}
                    onClick={() =>
                      mutate("refresh", {
                        id: s.id,
                        host_download: hostRefresh,
                      })
                    }
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
                <button
                  disabled={busy}
                  aria-label={`Edit ${s.name}`}
                  onClick={() => {
                    setForm({
                      ...emptyForm,
                      id: s.id,
                      name: s.name,
                      interval_hours: s.interval_hours,
                      remote: s.remote,
                    });
                    setMode("url");
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  disabled={busy}
                  aria-label={`Delete ${s.name}`}
                  onClick={async () => {
                    if (
                      await onConfirm({
                        title: `Delete the source "${s.name}"?`,
                        body: s.nodes.some((n) => n.id === proxy.selected)
                          ? "The current node comes from this source. After deleting it, Cage stays offline until you choose another node."
                          : "This source and its nodes will be removed. Local project files are not affected.",
                        confirm: "Delete source",
                      })
                    )
                      mutate("delete", { id: s.id });
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {form && (
            <div className="proxy-import">
              <h4>{form.id ? "Edit source" : "Add a node source"}</h4>
              {!form.id && (
                <div className="proxy-tabs">
                  {[
                    ["url", "Subscription link"],
                    ["file", "Local YAML"],
                    ["manual", "Manual node"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={mode === id ? "selected" : ""}
                      onClick={() => {
                        setMode(id);
                        setForm((old) => ({ ...old, content: "", url: "" }));
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <label>
                Source name
                <input
                  value={form.name}
                  maxLength={100}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="For example: Daily proxy"
                />
              </label>
              {mode === "url" && (!form.id || form.remote) && (
                <>
                  <label>
                    {form.id ? "New subscription link (leave blank to keep)" : "Subscription link"}
                    <input
                      value={form.url}
                      type="url"
                      autoComplete="off"
                      onChange={(e) =>
                        setForm({ ...form, url: e.target.value })
                      }
                      placeholder="https://…"
                    />
                  </label>
                  <label>
                    Auto-update interval
                    <InlineSelect
                      aria-label="Auto-update interval"
                      value={form.interval_hours}
                      onValueChange={(next) =>
                        setForm({
                          ...form,
                          interval_hours: Number(next),
                        })
                      }
                    >
                      {[
                        [0, "Manual updates only"],
                        [1, "Hourly"],
                        [6, "Every 6 hours"],
                        [24, "Daily"],
                        [168, "Weekly"],
                      ].map(([v, label]) => (
                        <option value={v} key={v}>
                          {label}
                        </option>
                      ))}
                    </InlineSelect>
                  </label>
                  {!form.id && (
                    <label className="check-line">
                      <input
                        type="checkbox"
                        checked={form.host_download}
                        onChange={(e) =>
                          setForm({ ...form, host_download: e.target.checked })
                        }
                      />
                      Download this subscription over the host network
                    </label>
                  )}
                  <p className="field-help">
                    Downloads go through the currently configured proxy by default. When there is no usable node yet, you can tick host download or import a local file; a failure never switches to another path automatically.
                  </p>
                </>
              )}
              {mode === "file" && !form.id && (
                <ProxyYAMLInput
                  content={form.content}
                  disabled={busy}
                  onReadingChange={setReadingFile}
                  onContentChange={(content) =>
                    setForm((old) => ({ ...old, content }))
                  }
                  onFileRead={(value, content) =>
                    setForm((old) => ({
                      ...old,
                      content,
                      name:
                        old.name ||
                        value.name.replace(/\.[^.]+$/, "").slice(0, 100),
                      interval_hours: 0,
                    }))
                  }
                />
              )}
              {mode === "manual" && !form.id && (
                <>
                  <div className="field-row">
                    <label>
                      Node name
                      <input
                        value={manual.name}
                        onChange={(e) =>
                          setManual({ ...manual, name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Protocol
                      <InlineSelect
                        aria-label="Protocol"
                        value={manual.type}
                        onValueChange={(next) =>
                          setManual({ ...manual, type: next })
                        }
                      >
                        <option value="socks5">SOCKS5</option>
                        <option value="http">HTTP CONNECT</option>
                      </InlineSelect>
                    </label>
                  </div>
                  <div className="field-row">
                    <label>
                      Server
                      <input
                        value={manual.server}
                        onChange={(e) =>
                          setManual({ ...manual, server: e.target.value })
                        }
                        placeholder="Domain or IP"
                      />
                    </label>
                    <label>
                      Port
                      <input
                        type="number"
                        min="1"
                        max="65535"
                        value={manual.port}
                        onChange={(e) =>
                          setManual({ ...manual, port: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="field-row">
                    <label>
                      Username
                      <input
                        value={manual.username}
                        autoComplete="off"
                        onChange={(e) =>
                          setManual({ ...manual, username: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        value={manual.password}
                        autoComplete="new-password"
                        onChange={(e) =>
                          setManual({ ...manual, password: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </>
              )}
              <div className="proxy-form-actions">
                <button disabled={busy} onClick={() => setForm(null)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    readingFile ||
                    (!form.id &&
                      (mode === "url"
                        ? !form.url || !form.name
                        : mode === "file"
                          ? !form.content.trim() || !form.name
                          : !manual.name || !manual.server))
                  }
                  onClick={submit}
                >
                  {form.id ? "Save source" : "Import and verify"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {tab === "connections" && (
        <>
          <div className="proxy-metrics">
            <span>
              Upload <strong>{bytes(rates.up)}/s</strong>
              <small>Total {bytes(connections.uploadTotal)}</small>
            </span>
            <span>
              Download <strong>{bytes(rates.down)}/s</strong>
              <small>Total {bytes(connections.downloadTotal)}</small>
            </span>
          </div>
          <p className="field-help">
            Shows the current core's connections and traffic, including Cage's
            own check requests; totals reset when the core restarts.
          </p>
          <div className="proxy-node-list">
            {connections.connections.map((c) => (
              <div className="proxy-connection" key={c.id}>
                <span>
                  {c.host}:{c.port}
                  <small>{c.network}</small>
                </span>
                <small>
                  ↑ {bytes(c.upload)} · ↓ {bytes(c.download)}
                </small>
              </div>
            ))}
            {!connections.connections.length && (
              <p className="proxy-empty">No active connections</p>
            )}
          </div>
        </>
      )}
      {tab === "diagnostics" && (
        <>
          <p className="field-help">
            Bundled core {proxy.version || "not running"}. Below is a summary of Cage
            status; raw core logs that risk exposing credentials are not shown on the page.
          </p>
          <div className="proxy-diagnostics" role="log">
            {logs.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
          <label>
            Dedicated proxy port
            <input
              type="number"
              min="1024"
              max="65535"
              value={port}
              onChange={(e) => {
                portDirty.current = true;
                setPort(e.target.value);
              }}
            />
          </label>
          <div className="proxy-toolbar">
            <button
              disabled={busy || !selected}
              onClick={async () => {
                if (
                  Number(port) !== proxy.port &&
                  status.vm_running &&
                  !(await onConfirm({
                    title: "Change the proxy port and restart the environment?",
                    body: "A port change needs an environment restart, and the current terminals will end.",
                    confirm: "Change and restart",
                  }))
                )
                  return;
                mutate("restart", { port: Number(port) });
              }}
            >
              <RefreshCw size={14} />
              Apply port and restart core
            </button>
            <button
              disabled={busy || !proxy.running}
              onClick={() => mutate("stop")}
            >
              <Square size={14} />
              Stop core
            </button>
          </div>
          <p className="field-help">
            Cage does not set a system proxy or host TUN. TUN from another proxy on this computer
            may still affect the core's outbound traffic, so verify it against the actual routing.
          </p>
        </>
      )}
      {pending && (
        <p className="proxy-progress" role="status">
          <LoaderCircle size={14} className="spin" />
          {pending === "delay"
            ? "Testing node latency…"
            : status.job?.message || "Working…"}
        </p>
      )}
      {error && !(tab === "nodes" && allNodes.length > 0) && (
        <div role="alert" className="error-message">
          <SafetyMessage message={error} />
        </div>
      )}
      {notice && (
        <p role="status" className="proxy-notice">
          <Check size={14} />
          {notice}
        </p>
      )}
    </div>
  );
}
