---
title: Network and proxy
description: Import nodes and subscriptions, set up multi-hop relays, and understand the rules for network checks, time zone and exit changes.
group: Getting started
order: 2
keywords: Clash Mihomo YAML VLESS REALITY ML-KEM SOCKS5 SSH 私钥 住宅 IP DNS DoH 暂停 断网 代理链 订阅
---
<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/proxy-subscription.jpg" target="_blank" rel="noopener" aria-label="View original: adding a subscription link and the first-time host download option"><img src="../../www/public/docs/screenshots/proxy-subscription.jpg" alt="Adding a subscription link and the first-time host download option" width="2560" height="1764" loading="lazy" decoding="async" /></a>
  <figcaption>Adding a subscription link and the first-time host download option. Screenshot version: 0.1.7-rc.1 (development build) · UI test stand on Windows 11 x64 · 2026-11-11. <a href="../../www/public/docs/screenshots/proxy-subscription.jpg" target="_blank" rel="noopener">View original (2560 × 1764) ↗</a></figcaption>
</figure>

## Import your own proxy

Open it from "Set up network and proxy" on the home page, or go to "Settings → Network and proxy". Click "Add source" and choose an import method:

| Source | How to fill it in |
| --- | --- |
| Subscription link | Enter a name and an HTTPS node subscription URL. If there are no usable nodes the first time, you can explicitly tick "Download this subscription over the host network". |
| Local YAML | Drag in or click to select an exported YAML, YML or JSON file (up to 8 MiB each), or paste Clash/Mihomo YAML content directly. After it is read, you can edit it. Click "Import and verify" to finish the import. |
| 手动节点 | 选择 HTTP、SOCKS5 或 SSH，填写服务器、端口和认证信息。SSH 默认端口为 22，用户名必填；可选择密码或私钥认证。私钥认证须粘贴完整私钥内容，加密私钥还需填写私钥口令。 |

Click "Import and verify", then go to "Nodes", choose the final exit, and click "Apply proxy". "Save settings" is for other settings and cannot replace applying the proxy. Selections that have not been applied are only drafts.

“导入并验证”检查节点格式和核心配置，成功后仍需验证实际连接与出口：

1. 应用节点后，在“设置 → 网络与代理”点击“验证出口”。该检查通过所选代理发起真实 HTTPS 请求，确认能取得出口 IP 和位置，并与预期出口核对；主机上其他代理客户端能够访问外网，不能代替这一步。
2. 启动工作环境，查看底部网络状态及检查结果。宿主、客机终端和浏览器的出口采样及其他关键检查通过后，才会显示“已联网”。失败项的处理见[为什么应用了节点仍然离线](#为什么应用了节点仍然离线)。

订阅或本地配置必须包含 `proxies` 或 `payload` 节点。Base64 列表、单个 `vless://` 等分享链接、Xray/v2rayN 原生 JSON、只引用远程 provider 的配置暂不支持。只有分享链接时，先从原客户端导出 Clash/Mihomo YAML；更改文件后缀不能完成转换。导入只采用支持的节点与代理链，不采用订阅中的主机系统代理、TUN、监听端口或直连规则。

Ordinary node parameters are kept and passed to the Mihomo core bundled with Cage for validation. For example, a VLESS node copied from FlClash can keep `xudp: true` without changing it to another field by hand. The core may ignore unknown fields. After configuration validation passes, you still need to apply the node and check the actual exit. The guest's public UDP blocking rule is not affected by these protocol options.

VMess, VLESS and Trojan WebSocket nodes can import the legacy fields `ws-path` and `ws-headers`. The node must explicitly set `network: ws`. Cage converts the path and headers to `ws-opts.path` and `ws-opts.headers`, and saved legacy nodes are converted when the proxy is applied. The new and legacy fields may coexist, but the paths must match, and headers are merged by name, ignoring letter case in names. If the values of the same header conflict, the field is written twice, or a legacy field is used for another transport, the source shows the specific reason, and you need to edit that node and import it again.

Hysteria2 nodes can use `mport` to specify a port-hopping range and `pinSHA256` to specify a certificate fingerprint. On import, these are converted to fields the core supports, and the features are kept. If a node uses an unsupported protocol, references a local file or network interface, has duplicate management fields, has conflicting alias parameters, or a proxy chain is unavailable, the node is skipped, and the source shows the number imported, the number skipped and the reasons. Click "See reasons" to expand the specific nodes. Proxy chains that depend on failed nodes are also skipped. If all nodes are skipped, the import fails. When an update affects the current exit or a relay node, the original configuration is kept, so apply another node first and then update. The remaining nodes must also pass the core configuration validation as a whole. If validation fails, the original configuration stays unchanged, and you can export a diagnostics bundle from "Logs and diagnostics" in settings to see the validation record.

手动添加 SSH 节点时，可在“服务器公钥”中填写可信公钥，每行一条；留空时不校验服务器身份。

SSH 节点（`type: ssh`）可以把自己的 VPS 直接作为固定出口，服务器上只需开启 SSH，无需另外部署代理服务。可用 `password` 或 `private-key` 认证；`private-key` 须直接填写 PEM 私钥内容（含 `-----BEGIN ... PRIVATE KEY-----`），引用本机私钥文件路径的节点会被跳过，加密私钥可配合 `private-key-passphrase`。建议用 `host-key` 固定服务器公钥（`ssh-keyscan` 输出中的 `ssh-ed25519 AAAA...` 部分），未填写时核心不校验服务器身份。SSH 节点仅转发 TCP。示例：

```yaml
proxies:
  - name: my-vps
    type: ssh
    server: 203.0.113.10
    port: 22
    username: root
    private-key: |
      -----BEGIN OPENSSH PRIVATE KEY-----
      ...
      -----END OPENSSH PRIVATE KEY-----
    host-key:
      - "ssh-ed25519 AAAA..."
```

The same subscription URL may return different formats depending on the client identity it requests. Cage downloads with a Clash client identity, so YAML from the provider can be imported. If the provider returns a Base64 or share-link list, you still need to get a Clash/Mihomo YAML from the provider.

<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/proxy-manual.jpg" target="_blank" rel="noopener" aria-label="View original: entering an HTTP / SOCKS5 node manually"><img src="../../www/public/docs/screenshots/proxy-manual.jpg" alt="Entering an HTTP / SOCKS5 node manually" width="2560" height="1764" loading="lazy" decoding="async" /></a>
  <figcaption>Entering an HTTP / SOCKS5 node manually. Screenshot version: 0.1.7-rc.1 (development build) · UI test stand on Windows 11 x64 · 2026-11-11. <a href="../../www/public/docs/screenshots/proxy-manual.jpg" target="_blank" rel="noopener">View original (2560 × 1764) ↗</a></figcaption>
</figure>

## 通过本机代理客户端转发

节点依赖 Xray 等客户端支持的传输或握手参数、转换为 Mihomo YAML 后仍无法连接时，可将该客户端的本机 SOCKS5 监听作为 Cage 的上游。此时连接顺序为 `Cage → 本机 SOCKS5 监听 → 原客户端所选节点 → 目标网站`；原客户端须保持运行，并让这些请求经过预期节点，避免其直连规则或自动回退改变出口。

1. 在原客户端启用只监听本机的 SOCKS5 端口，记录实际地址、端口及认证信息。此处的本机指运行 Cage 控制服务的主机；连接远程 Cage 时，`127.0.0.1` 指远程主机，无法使用你电脑上的监听。
2. 在 Cage 手动添加 SOCKS5 节点，或导入以下完整 YAML。示例端口 `10808` 须替换为客户端实际的 SOCKS5 端口；启用认证时，补上该监听要求的 `username` 和 `password`。

```yaml
proxies:
  - name: local-client
    type: socks5
    server: 127.0.0.1
    port: 10808
    udp: false
```

3. 选择并应用该节点，在“设置 → 网络与代理”点击“验证出口”，与原客户端的预期出口核对；随后完成环境联网检查。客户端选中其他节点、规则变化或停止运行都会影响此路径，须重新验证。

Cage 仍通过受管核心转发客机出站，原客户端负责连接上游 VLESS 等服务；这条路径不会开放客机到主机的任意直连，也不放宽出口规则或公网 UDP 限制。各主机上的监听能否被核心实际访问，以“验证出口”和环境检查结果为准。

## Reach a residential exit through a relay

If a residential node cannot connect directly, switch to "Chained proxy" on the "Nodes" page. Choose the relays in connection order, set the residential node as the "Final exit", and click "Add relay" when you need multiple relays. Nodes can come from different sources.

Check the preview before applying, for example: `Cage → Relay node → Residential proxy → Target website`. The target website sees the final exit. Subscription updates do not overwrite saved combinations. If a node in use is removed, the original configuration is kept and an error is shown, and you need to choose again.

<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/network-settings.jpg" target="_blank" rel="noopener" aria-label="View original: network and proxy page and exit change rules"><img src="../../www/public/docs/screenshots/network-settings.jpg" alt="Network and proxy page and exit change rules" width="2560" height="1764" loading="lazy" decoding="async" /></a>
  <figcaption>Network and proxy page and exit change rules. Screenshot version: 0.1.7-rc.1 (development build) · UI test stand on Windows 11 x64 · 2026-11-11. <a href="../../www/public/docs/screenshots/network-settings.jpg" target="_blank" rel="noopener">View original (2560 × 1764) ↗</a></figcaption>
</figure>

## Why the node is applied but still offline

Proxy core readiness and the working environment being allowed to connect to the internet are two separate steps. After the environment starts, internet access for the business stays off while the critical checks run: exit, DNS, system and browser configuration, shared directories, host management interfaces and network blocking. For Linux guests, the DNS item also requires the resolver to point only to an address inside the environment, and direct UDP/53, TCP/53 and DoT/853 connections to public DNS must not bypass the gateway. The host management interface item also probes link-local metadata addresses and the configured user proxy port. The IPv6 item requires the guest to have zero global IPv6 addresses, and checks routing or reject records. If a probe result is missing, the state shows unknown. If any critical item fails or evidence is missing, internet access stays off.

macOS 主机只从 `networksetup` 报告的硬件端口中选择具有可用 IPv4 地址的物理出口；`utun`、`bridge`、`vmen`、`vmenet`、`vmnet`、`tap`、`lima`、`awdl`、`llw`、`p2p`、`gif`、`stf`、`anpi`、`ap` 等隧道、桥接和虚拟机接口即使带有地址或默认路由，也不会被绑定为代理出口。macOS 客机的 IPv6 链路入口检查只向宿主回报已验证的布尔结果，安全报告显示“客机以太网卡”。如果 IPv6 默认路由经过这张网卡，IPv6 检查显示“未知”，业务外网保持关闭。宿主诊断日志保留该路由的验证结果，省略网卡名。

Exit detection reads the public IPv4 address through the selected proxy, using `https://ipv4.icanhazip.com/` first and the backup service `https://api.ipify.org/` next. Dual-stack nodes use their IPv4 exit to complete the check. The host, guest terminal and browser use the same detection method. If the startup check cannot get a valid address, internet access for the business stays off. You can retry later or check the node.

Click the network status at the bottom to see the failed items, fix them, then check again. When the core is running but the environment has not started, it shows "Waiting to start environment". "Connected" is shown only when the critical checks pass and the network access authorization is valid.

"Exit sampling is incomplete" lists the paths that did not get a result, namely the host, the virtual machine terminal or the browser, along with reasons such as a timeout, the HTTP status returned by the detection channel, or a missing address. A passing terminal proxy check only proves that this terminal sample succeeded. The host and browser must each still get results. The dynamic IP rule decides which exit addresses are acceptable. When sampling fails, you still need to detect again.

If the browser's exit sampling gets no response or returns HTTP 503, Cage waits one second and retries once. Internet access stays off during the retry. If it keeps failing, the last detection result is kept. If the browser configuration does not match, or the response lacks an exit address, first fix the corresponding failed item. When the environment is ready but only the network check failed, the page shows "Environment started, but the network check did not pass", and you can recheck the network directly.

While offline, you can still use terminals, shared files and local services inside the environment. In the browser address bar, `localhost` refers to the current Cage guest. Start development servers in the Cage terminal.

<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/region-settings.jpg" target="_blank" rel="noopener" aria-label="View original: time zone and language settings that follow the exit IP"><img src="../../www/public/docs/screenshots/region-settings.jpg" alt="Time zone and language settings that follow the exit IP" width="2560" height="1764" loading="lazy" decoding="async" /></a>
  <figcaption>Time zone and language settings that follow the exit IP. Screenshot version: 0.1.7-rc.1 (development build) · UI test stand on Windows 11 x64 · 2026-11-11. <a href="../../www/public/docs/screenshots/region-settings.jpg" target="_blank" rel="noopener">View original (2560 × 1764) ↗</a></figcaption>
</figure>

## Download network for system images

System images, the image version catalog, and the macOS app and development toolkit prepared on the host use the host network, separate from the proxy nodes of the Cage guest. Software such as Clash can take over these downloads with only "System proxy" turned on, without TUN. Download connections are not bound to a physical network interface, and they do not change the nodes or rules of the proxy software. If the host proxy rules set a download site to direct, Cage follows that rule. When no proxy is configured on the host, direct connections are used.

- macOS: reads the system HTTP, HTTPS and SOCKS proxies and PAC. Each request and redirect is resolved by its target address.
- Windows: reads the current user's system proxy. PAC and auto-detection are resolved by target address through WinHTTP.
- Linux: supports proxy environment variables, the GNOME manual desktop proxy and host TUN. In this build, if GNOME automatic PAC is encountered, it stops and asks you to switch to TUN or proxy environment variables. For other desktop environments, set proxy environment variables or turn on TUN.

When started from a terminal, the `HTTP_PROXY` and `HTTPS_PROXY` for the target protocol take precedence over system settings, `ALL_PROXY` acts as the default proxy, and the matching `NO_PROXY` exceptions apply. These host settings are not passed into the guest. If the proxy cannot connect or the configured PAC fails to resolve, the download stops and does not switch to a direct connection because of the failure. After you fix the host proxy, continue the installation from the initialization screen, and existing downloads try to resume.

System images and development tools prefer official sources. If the Debian image download fails, Cage tries a mirror in mainland China of the same fixed version. Debian package sources and Linux tools try backup mirrors when official sources are unavailable. Each download path keeps its original digest, package signature or app signature checks, and custom Debian package sources are kept as they are.

Guest processes and development tools downloaded inside the guest still go through Cage's own proxy. A successful system image download does not mean that the guest network check has passed. Entering the workbench still requires the guest's network and isolation checks to complete.

## Time zone, language and exit rules

Under "Settings → Time zone and language", choose to follow the exit or set it manually. Automatic mode looks up the exit location through the proxy and does not use the host location instead. If location lookup fails, you can retry or switch nodes. When you set the time zone and language manually, you still need to confirm the exit country or region.

The "IP change rules" on the network page are saved per final exit node. They support a static IP, and a dynamic IP within the same city, the same state or province, the same country or region, or any region. City mode also checks the country and state or province. Switching the final exit restores that node's rule automatically. A node used for the first time takes over the current static or dynamic mode and allowed range, and binds its own IP or region after it is checked through the proxy and confirmed as an exit outside mainland China. Changing only the relay, refreshing a subscription, rechecking or restarting keeps that node's baseline.

For example, residential nodes 001 and 003 are each bound to their own fixed IP, and switching back and forth uses the matching address automatically. If the same residential node changes its IP unexpectedly, internet access is still paused, and you need to confirm and edit the rule explicitly. When an older configuration did not record which node the exit baseline belongs to, the original rule stays in effect until you explicitly apply a node, which is then checked and bound.

Exits in mainland China are not allowed. When the detected address matches the built-in mainland China network list, or the location result is mainland China, internet access for the business stays off. Neither a static IP nor "any region" can be exempted. If the exit country or region cannot be confirmed, it also stays off, while offline terminals and files remain usable. Location and the network list may have errors. Sampling runs periodically in the background, and it cannot guarantee that every connection of a third-party proxy uses the same exit.

Saving settings that affect the system environment may require a restart, so save your files first. A running task is not silently restarted just because the backend detects a location change.

## Pause, resume and network switching

Click the status at the bottom to pause internet access manually. Pausing cuts existing external connections and keeps local tasks and file operations. Closing and reopening Cage, or refreshing a subscription, does not lift a manual pause.

The backend periodically checks the exit and environment configuration. When both exit detection services time out, Cage keeps retrying before the current network permission expires, without extending it. If it is still unconfirmed when it expires, internet access is turned off and a full recheck is attempted. If the exit or environment configuration is found to break the rules, it pauses immediately. After the host switches networks, Cage tries to restore the connection and run a full recheck. A state that was paused manually still needs to be resumed manually. If the control service loses contact, existing network authorization expires and internet access is turned off. A fixed exit also depends on the proxy service itself, since periodic sampling cannot prove that every connection uses the same IP.

The first automatic full recheck is attempted 15 seconds later. After a failure, it waits 30, 60, 120 and 240 seconds in turn, and then 300 seconds each time. The actual start time also depends on environment readiness, the current operation and memory pressure. The network state shows the remaining wait time or the reason for waiting. A recheck must obtain all critical evidence, and automatic recovery does not change the saved exit rules.

## DNS and diagnostics

Business DNS is forwarded through the selected proxy. The startup resolution of node domains belongs to communication preparation and is separate from the guest's business DNS setting. Cage does not change the host's system proxy or TUN, nor does it change the nodes of other proxy software on this computer.

On the proxy page, "Diagnostics" can check the core status, restart the Cage core, or choose an independent listening port. If a port is in use, select an unused port, then restart the environment as prompted. For specific symptoms, see [Troubleshooting](troubleshooting.md#node-applied-but-no-internet-access).

### VLESS REALITY 握手失败

从 V2rayN 等客户端迁入 VLESS + TCP + REALITY 节点后，可能出现配置校验通过、真实 HTTPS 请求失败，核心日志报 `REALITY authentication failed` 的情况。先逐项对照原客户端与服务端参数，包括服务器、端口、UUID、传输方式、SNI、客户端指纹、flow、公钥和 short-id；配置语法正确仍可能存在握手兼容问题。

参数核对一致后，可按 [Mihomo 官方 TLS 文档](https://wiki.metacubex.one/config/proxies/tls/#reality-optssupport-x25519mlkem768)检查 `reality-opts.support-x25519mlkem768`，该选项用于支持 X25519-MLKEM768 密钥交换。对于需要此兼容选项的节点，在该节点现有的 `reality-opts` 中保留原公钥和 short-id，并添加：

```yaml
reality-opts:
  public-key: <原节点公钥>
  short-id: <原节点 short-id>
  support-x25519mlkem768: true
```

这是节点内的配置片段，需放回完整的 Clash/Mihomo YAML 后重新导入、应用。保留原配置，每次只调整这一项，再重复相同的 HTTPS 与出口检查。部分节点在启用此项后可以恢复连接；请按原节点与服务端要求使用，不要对所有 REALITY 节点无条件添加或重写参数。若仍失败，保留日志继续排查，不能仅凭该错误判断服务端版本或设置，也不要通过关闭证书校验、放宽出口规则或启用直连回退处理。

## Use SSH over the Tailscale private network

Open "Tailscale" below "Browser" in the sidebar. After authorizing in the Cage browser, you can make SSH work in both directions over the private network between this computer and the Cage environment. For connection steps, public keys and local SSH service requirements, see [Tailscale and private-network SSH](tailscale.md).

Private-network access is enabled by you and is limited by device and SSH authorization. Outer traffic still goes through Cage's controlled exit, and pausing internet access or a proxy interruption affects the connection. This entry is handled separately from the host and LAN direct connections that are blocked by default, and it does not open public listening on the host or subnet routing.
