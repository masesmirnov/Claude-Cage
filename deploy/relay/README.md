# Self-hosted Cage relay

This directory is for developers who maintain their own servers. It deploys a connection forwarding service between two authorized devices. The computer and the client each connect to the server actively, and the server forwards the two WebSocket connections in the same room to each other.

After you deploy the relay, use the host connection helper to register the phone's public key fingerprint. The Android and iOS clients operate Claude Code CLI sessions through the device channel. Device trust, saved connections and revocation are handled by the endpoints. [Mobile client](../../mobile/README.md) · [Host connection helper](../../cmd/cage-mobile-link/README.md)

Regular users can use the [official relay](../../mobile/README.md) directly. Self-hosted deployments in this document require an admin token by default. If the operator wants to let any computer create rooms, enable `--public-rooms` explicitly. At the public entry point, limit creation rate and concurrent connections per source IP, and keep the relay's global room cap. Even when rooms are created publicly, the phone and computer must still trust each other's fingerprints before the workbench can be operated.

## Connection and key ownership

The relay admin token is used only to create short-lived connection rooms. Each room returns its own host token, client token and expiry time. Each end connects once with its own token. Business data between the two ends must be protected by the mutual TLS 1.3 certificate-verified channel in `internal/remotelink`. Endpoints send business data only after they verify the pre-trusted identity of the peer. A relay room token grants one connection only. It cannot replace device identity or Cage's account authorization.

HTTPS/WSS protects the outer connection from devices to the relay. End-to-end TLS protects the business content forwarded through the relay. The relay itself only forwards opaque binary frames, so it can't force any self-written client to encrypt. Clients must use the end-to-end channel. The operator can still observe connection addresses, timing and traffic volume.

Rooms exist only in memory. Connections that don't both arrive within the pairing deadline are closed. If one end disconnects, a new room must be created. A service restart also interrupts all rooms, and restoring business state is the device side's job. By default, up to 128 rooms, a 2-minute pairing deadline and a 5-minute idle timeout apply. A single WebSocket message must not exceed 64 KiB.

This service does not accept SSH clients, plain HTTP proxies, arbitrary browser WebSockets or VNC clients. Requests from a browser with an `Origin` header are rejected. Native clients set up the device channel. Cage's existing SSH remote host connection uses a different startup and authentication flow, so you can't simply replace an SSH host address with this relay address.

## Deploy on a Linux server

Prepare a Linux server with Docker Engine and Compose installed, plus a domain name that points to it. Open only TCP 80 and 443. Caddy uses the domain to obtain a trusted certificate and forwards traffic to the relay service inside the container. The deployment config does not map the relay's port 8787 to the host.

Run the following commands in the repository root. Keys are stored outside the repository, and `openssl` does not print their contents to the terminal. Run the later Compose commands as the current deployment user.

```sh
install -d -m 700 "$HOME/.config/cage-relay"
(
  umask 077
  set -C
  openssl rand -hex 32 > "$HOME/.config/cage-relay/admin-token"
)
chmod 600 "$HOME/.config/cage-relay/admin-token"
export RELAY_TOKEN_FILE="$HOME/.config/cage-relay/admin-token"
export RELAY_UID="$(id -u)"
export RELAY_GID="$(id -g)"
export RELAY_DOMAIN="relay.example.com"
docker compose -f deploy/relay/compose.yaml config --quiet
docker compose -f deploy/relay/compose.yaml up -d --build
```

Replace the example domain with your own. The key generation commands refuse to overwrite existing files, and existing deployments reuse their original files. Compose fails immediately if the domain, key paths or file owner ID are missing. The Go build image is pinned to `1.26.10`, matching the project declaration, and Caddy is pinned to `2.11.8-alpine`. To upgrade images, change and verify the config. Don't use `latest`.

Keys are mounted as read-only Compose secrets, and the relay container runs as the UID/GID of the key file's owner. For file-based secrets, Docker Compose uses a bind mount, so you can't rely on the secret's `uid`, `gid` or `mode` settings instead of the host file permissions. [Docker secrets documentation](https://docs.docker.com/compose/how-tos/use-secrets/)

The relay container uses a read-only file system, drops all Linux capabilities, and connects only to the internal network. Caddy connects to both the external network and the internal network, and its certificates are stored in the `caddy_data` volume. Access logging is not enabled. The default structured logs remove request paths and headers, so room addresses and authentication details aren't recorded. [Caddy reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

Check that HTTPS and the service listener work with a health check that doesn't use keys:

```sh
curl --fail --silent --show-error "https://${RELAY_DOMAIN}/healthz"
docker compose -f deploy/relay/compose.yaml ps
```

A health check returning `ok` only means the relay responds. You also need two test endpoints that hold each other's trust information to verify the encrypted handshake, forwarding, disconnects and identity rejection. It doesn't prove that the mobile workbench is ready.

## Local development and direct runs

Build and start it in the repository root:

```sh
go build -o /tmp/cage-relay ./cmd/cage-relay
/tmp/cage-relay --token-file "$HOME/.config/cage-relay/admin-token"
```

The program listens on `127.0.0.1:8787` by default and does not open the public internet. To change the listen address, you must pass `--listen` explicitly. For public deployments, go through a trusted TLS entry point, and never expose plain HTTP directly. Startup logs only record the listen address, and don't print tokens, invitation content or room URLs.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--listen` | `127.0.0.1:8787` | HTTP listen address |
| `--token-file` | Required | Relay admin token file |
| `--max-rooms` | `128` | Total limit for waiting and connected rooms |
| `--pair-timeout` | `2m` | Time limit for both ends to arrive |
| `--idle-timeout` | `5m` | Connection idle time limit |

A token must contain 32–4096 bytes of visible ASCII characters with no whitespace, and may end with one LF or CRLF. On macOS and Linux, files that group or other users can access are rejected, so `0600` is recommended. Windows file permissions use ACLs, and the program doesn't infer the access scope from Unix permission bits. Before running, turn off inheritance and allow only the service account and necessary system administrators. Windows and macOS can run the same Go entry point. The container deployment example targets a Linux server.

## Protocol integration

Integrators create a room with `POST /v1/rooms`, and put the admin token in the `Authorization: Bearer …` header. The response contains `id`, `host_token`, `client_token` and `expires_at`. Don't write them to logs or public pages.

The host and the client access `GET /v1/rooms/{id}/host` and `GET /v1/rooms/{id}/client` respectively, put their own room tokens in the same header, and upgrade to WebSocket. The endpoints don't accept credentials in query parameters. After pairing completes, they run end-to-end identity verification, then exchange business data. The room address itself should also be treated as sensitive connection information.

To save a device connection, the host registers a digest of the device's lookup credential with `lookup_hash`. The phone sends the original lookup credential in the Bearer header to `GET /v1/invitation`, and gets a room invitation that the host has already joined and that hasn't been used. After a disconnect, the host registers a new room, and the original lookup credential can still be used. After a relay restart, the online host registers again. Room tokens and lookup credentials are managed separately, and each session still verifies the device public key.

The relay does not forward HTTP paths to the management service on the computer. Only app operations that the device side explicitly allows can reach Cage. Successful room creation, a successful WebSocket connection and a successful end-to-end handshake each represent a different stage. Callers should keep the matching error feedback for each.

## Stop and update

```sh
docker compose -f deploy/relay/compose.yaml down
docker compose -f deploy/relay/compose.yaml up -d --build
```

Stopping the service closes all relay rooms first, then ends the HTTP listener. Both ends need to reconnect. An update keeps the tokens outside the repository and the Caddy certificate volume. The relay does not access the computer's Cage personal folder or the VM disk.

After you rotate the admin token, restart the relay. Restarting clears all rooms. Changing only the admin token does not revoke trust that devices have already saved. Device revocation must be handled by the host-side authorization layer. When you update, keep the token file's permissions, and don't loosen file permissions to fix a read failure.
