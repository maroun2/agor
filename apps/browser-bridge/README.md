# Agor Browser Bridge

Remote browser MCP bridge for Agor. Chrome extension connects outbound to VPS relay over WebSocket; relay exposes local MCP endpoint on `localhost:3001`.

## Relay

```bash
cd apps/browser-bridge
pnpm install
pnpm start
```

First start creates token at `~/.agor/browser-bridge.token`.

Useful env vars:

- `BROWSER_BRIDGE_HOST` default `127.0.0.1`
- `BROWSER_BRIDGE_PORT` default `3001`
- `BROWSER_BRIDGE_TOKEN_FILE` default `~/.agor/browser-bridge.token`
- `BROWSER_BRIDGE_TOKEN` overrides file token

## Chrome extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load unpacked: `apps/browser-bridge/extension`.
4. Open extension options.
5. Set Server URL, for example `wss://vps-domain/browser-bridge` or local `ws://127.0.0.1:3001/browser-bridge`.
6. Paste token from `~/.agor/browser-bridge.token`.
7. Enable auto-connect if wanted.

Destructive tools pause in side panel for Approve/Deny. Read-only tools run and appear in recent action history.

## systemd

```ini
[Unit]
Description=Agor Browser Bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/agor/apps/browser-bridge
ExecStart=/usr/bin/node /opt/agor/apps/browser-bridge/server.js
Restart=always
RestartSec=3
Environment=BROWSER_BRIDGE_HOST=127.0.0.1
Environment=BROWSER_BRIDGE_PORT=3001

[Install]
WantedBy=multi-user.target
```

Proxy `/browser-bridge` through TLS reverse proxy to `ws://127.0.0.1:3001/browser-bridge`. Keep `/sse` and `/message` local unless remote MCP access is intended.

## Agor MCP registration

Register once after relay starts:

```bash
agor mcp add sse browser-bridge --url http://localhost:3001/sse --scope global
```
