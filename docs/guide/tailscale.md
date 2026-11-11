---
title: Tailscale private network
description: Sign in to Tailscale, join Cage to your private network, view devices, and connect to SSH, web and other TCP services.
group: Daily use
order: 6.5
keywords: Tailscale tailnet devices private network SSH web TCP proxy
---

## Sign in and join the private network

The "Tailscale" item below "Browser" in the workbench's left column adds the current Cage environment to your Tailscale network as a separate device. Sign-in state is saved on the guest disk, and closing the panel does not disconnect it. Your computer, phone or server also needs Tailscale installed and joined to the same network.

Start the Cage environment, open the Tailscale panel, and click "Connect and sign in". Complete the sign-in on the official authorization page that opens, then reopen the Tailscale panel. After a successful connection, you can see the current account, network name, Cage's private address and the device list. If the network requires device approval, the panel shows "Waiting for administrator approval". Once a network administrator approves Cage in the Tailscale admin console, you can continue.

If Google sign-in shows "This browser or app may not be secure", first update Cage and the environment components, stop and restart the environment, then go back to the Tailscale panel and click "Sign in again". Browser startup settings only take effect after the environment restarts, so continue from the new authorization page. Web sign-in state and device identity are kept in your existing personal data.

On a Debian environment, click "Install Tailscale" the first time you use it. macOS and Windows environments include it with the guest components, and existing environments can update the environment components as the panel prompts. Tailscale already installed on Linux is also updated with the environment components, and the device identity and SSH public key are kept. Environments that do not have it installed yet install it on demand.

The device list shows the devices this network lets Cage discover. Online devices appear first, and you can search by name, system or private address. If the list is empty, first check whether other devices have joined the same network and what the network's device access rules are.

## Use services on devices

Click "Use device" next to a device and choose a connection method based on the service type. Online means the device is connected to Tailscale. Whether the service is usable still depends on whether the target device has started that service, and on the port and access permissions.

### Web, databases and other TCP services

For example, if a development website on your server listens on port `8080`, enter `8080` as "Service port" and click "Create connection address". The panel gives you an address like `127.0.0.1:32123`. Use this address in apps inside Cage to connect to port `8080` on that device. For an HTTP site, click "Open HTTP page" directly. For database clients and similar apps, enter this address and the matching port, and authenticate as the target service requires.

These addresses only work inside the current Cage environment. Opening the same loopback address on the host will not connect. The mapping does not change the target service's sign-in method. For HTTPS and other services that require the target domain and certificate to match, use the private-network proxy described below, which keeps the original target domain and certificate validation.

### Apps that need device domains, HTTPS or multiple ports

Expand "Apps using the private network", click "Copy private network proxy address", and configure it as the HTTP proxy of apps inside Cage. The proxy supports HTTP and HTTPS CONNECT, and only connects to devices visible on the current private network. Configure it only for apps that need private-network access. This dedicated proxy rejects public targets and cannot replace an app's existing public proxy.

The copied address includes local access credentials, so do not share it. After the component process restarts, copy the proxy address again.

Cage uses an embedded Tailscale node. SSH is already configured for private-network transport, and other apps reach TCP services through the local connection address or the HTTP proxy. The system VPN, apps using private addresses directly, UDP, subnet routing and exit nodes are not enabled. This feature does not take over the host's Tailscale or system network.

### SSH from Cage to other devices

The target device must have remote login or an SSH service enabled. In "SSH connection", enter the device's system username, click "Copy SSH command", and run it in the Cage terminal. Authentication uses the password or key that the target SSH service supports. Cage does not import the host's private keys automatically.

Ordinary `ssh`, SFTP and tools that use OpenSSH can also use the device's private IPv4 address, full name or short name. Cage maintains a dedicated OpenSSH transport configuration for discovered devices and keeps the user's existing rules.

## SSH from other devices to Cage

Expand "SSH into Cage from other devices" only when you need a remote terminal, SFTP or editor connection. Add the connecting device's SSH public key to the panel, and keep the private key on that device. The panel accepts one public key, not a private key or an `authorized_keys` entry with restriction options.

Copy the command shown in the panel and run it in the terminal of the connecting device, for example:

```sh
ssh cage@100.88.2.3
```

The first time you connect, verify and save the SSH server fingerprint. After signing in, you have the permissions of a regular user of the current Cage guest, and can use an interactive terminal, remote commands, SFTP and SSH local port forwarding. Removing a public key rejects new connections with that key. Disconnecting Tailscale ends existing private-network connections.

This uses standard SSH public-key authentication. Tailscale's own "Tailscale SSH" identity authentication must be configured separately, and signing in to Tailscale itself does not automatically grant system SSH access.

## Disconnect, sign out and data retention

"Disconnect" ends the private-network connection and service mappings, and keeps the sign-in state, public keys and SSH server identity. Reconnecting uses the same device, but local service addresses need to be created again. "Sign out" revokes the current sign-in. The next connection requires browser reauthorization, and added SSH public keys are kept.

The outer private-network traffic still goes through Cage's controlled exit. When public UDP is restricted, Tailscale transfers through a relay. Pausing Cage networking, a proxy interruption, stopping the environment or quitting in the backend affects private-network connections. After the environment restarts, the enabled Tailscale identity is restored.

Access between devices is still controlled by Tailscale network rules. After you connect to other devices, command permissions and network behavior are governed by the target device.
