# FreeBSD (experimental / community)

BetterDesk has **no official FreeBSD installer** (`betterdesk.sh` is Linux + systemd). This directory provides **example `rc.d` scripts** and a manual build path for community / Tier 3 deployments.

Related: [GitHub #310](https://github.com/UNITRONIX/BetterDesk/issues/310).

## Status

| Component | Status |
|-----------|--------|
| Go server (`betterdesk-server`) | Build from source (`CGO_ENABLED=0`) |
| Node.js panel (`web-nodejs`) | Build/run from source via `pkg` Node |
| `rc.d` examples | In this tree — adapt paths as needed |
| Release CI FreeBSD binaries | Not provided |
| Panel Settings → Updates | Expects Linux/Windows assets — use git pull / rebuild |
| Agent on FreeBSD | Not supported |

## Dependencies

```sh
pkg install -y git go node npm python3 ca_root_nss
```

Go version must satisfy `betterdesk-server/go.mod` (see toolchain line). Node.js 22.17 or newer (the new web console's build needs it).

## Suggested layout

| Path | Role |
|------|------|
| `/usr/local/betterdesk` | Go binary, keys, SQLite DB |
| `/usr/local/BetterDeskConsole` | Node.js panel (copy of `web-nodejs`) |
| `/usr/local/etc/rc.d/betterdesk_server` | Server rc script |
| `/usr/local/etc/rc.d/betterdesk_console` | Console rc script |

## Build Go server

```sh
git clone https://github.com/UNITRONIX/BetterDesk.git
cd BetterDesk/betterdesk-server
CGO_ENABLED=0 go build -o betterdesk-server .
install -d /usr/local/betterdesk
install -m 755 betterdesk-server /usr/local/betterdesk/
# Generate or copy id_ed25519 / id_ed25519.pub into /usr/local/betterdesk
```

Example run (adjust IP, DB, ports):

```sh
cd /usr/local/betterdesk
./betterdesk-server -mode all \
  -relay-servers YOUR.PUBLIC.IP \
  -key-file /usr/local/betterdesk/id_ed25519 \
  -api-port 21114
```

## Install Node panel

```sh
install -d /usr/local/BetterDeskConsole
# Copy or rsync the web-nodejs tree to /usr/local/BetterDeskConsole
cd /usr/local/BetterDeskConsole
npm ci --omit=dev
# Create .env (see docs/wiki/Configuration.md); set RUSTDESK_DIR=/usr/local/betterdesk
```

## Build the new web console

Pages that moved to the new console (`web-ui/`) only open once it is built. Build it inside the panel folder and point the panel at it. Repeat this after every `git pull`.

```sh
install -d /usr/local/BetterDeskConsole/web-ui
# Copy the web-ui tree to /usr/local/BetterDeskConsole/web-ui
# (without node_modules, build, .svelte-kit, tests and e2e)
cd /usr/local/BetterDeskConsole/web-ui
npx -y npm@11.6.2 ci --include=dev --no-audit --no-fund   # npm 10 can't resolve its dependencies
npm run build
echo "WEB_UI_DIR=/usr/local/BetterDeskConsole/web-ui/build" >> /usr/local/BetterDeskConsole/.env
```

The build dependencies take about 220 MB in `web-ui/node_modules`; only builds need them.

## Install rc.d scripts

```sh
install -m 755 contrib/freebsd/rc.d/betterdesk_server /usr/local/etc/rc.d/betterdesk_server
install -m 755 contrib/freebsd/rc.d/betterdesk_console /usr/local/etc/rc.d/betterdesk_console
```

Enable in `/etc/rc.conf` (or `/etc/rc.conf.d/`):

```sh
betterdesk_server_enable="YES"
betterdesk_console_enable="YES"
# Optional overrides — see script headers
# betterdesk_server_relay="YOUR.PUBLIC.IP"
# betterdesk_console_node="/usr/local/bin/node"
```

Start:

```sh
service betterdesk_server start
service betterdesk_console start
```

## Firewall (`pf`)

Open at least: TCP `21114`–`21119`, `21121`, `5000` (panel); UDP `21116`. Adjust if you changed ports in `.env` / flags.

## Limits

- No maintainer CI on FreeBSD — breakages are best-effort.
- Do not rely on the in-panel updater for FreeBSD binaries.
- Pull requests improving these scripts are welcome.
