# MarqueeIT — Docker Deployment

A complete Docker setup for running the MarqueeIT remote IT support platform
on any Linux server.

## What's in the stack

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| `nextjs` | marqueeit-nextjs | 3000 (internal) | The web app, REST API, and Go binary downloads |
| `signaling` | marqueeit-signaling | 3003 (internal) | WebSocket relay for screen frames + input events |
| `caddy` | marqueeit-caddy | **80, 443** | Reverse proxy with automatic HTTPS |

Customers and technicians only need to reach **port 80/443** on your server.
The internal services are not exposed directly.

## Prerequisites

- Docker 20+ and Docker Compose v2+
- A Linux server (Ubuntu, Debian, CentOS, etc.)
- Ports 80 and 443 open on the firewall
- A domain name pointing to your server (recommended — gives you free HTTPS)

## Quick start

```bash
# 1. Clone or copy the project to your server
git clone <your-repo> marqueeit
cd marqueeit

# 2. (Optional) Set your domain for automatic HTTPS
echo "DOMAIN=support.yourcompany.com" > .env
echo "AUTO_HTTPS=on" >> .env

# 3. Build and start everything
docker compose up -d --build

# 4. Watch the logs to make sure it started cleanly
docker compose logs -f
```

The first build takes ~5 minutes because it compiles Go binaries for
Linux/Windows/Mac and builds the Next.js standalone bundle. Subsequent
rebuilds are much faster thanks to Docker layer caching.

Once running, visit:

- **http://YOUR-SERVER-IP/** (or your domain) — landing page
- Customers enter their 6-char code here to download the helper app
- Technicians click "Technician Login" and sign in with the credentials below

## Default technician login

```
Username: Yoda
Password: changeme
```

**Change these immediately** by editing the `TECH_USERNAME` and
`TECH_PASSWORD` environment variables in `docker-compose.yml` and running
`docker compose up -d`.

## Configuration

All configuration is via environment variables in `docker-compose.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `TECH_USERNAME` | `Yoda` | Technician login username |
| `TECH_PASSWORD` | `changeme` | Technician login password |
| `PUBLIC_URL` | `http://localhost` | The public URL customers see (set to your real domain) |
| `DOMAIN` | `:80` | The domain Caddy serves on (set to your real domain for HTTPS) |
| `AUTO_HTTPS` | `disable` | Set to `on` to enable Let's Encrypt auto-HTTPS |
| `DATABASE_URL` | `file:/app/db/marqueeit.db` | SQLite path (don't change unless you know what you're doing) |

## Persistence

The SQLite database is stored in the `db-data` Docker volume, so it
survives container restarts and updates. To back it up:

```bash
docker run --rm \
  -v marqueeit_db-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/marqueeit-db-$(date +%F).tar.gz /data
```

To restore:

```bash
docker run --rm \
  -v marqueeit_db-data:/data \
  -v $(pwd):/backup \
  alpine sh -c "cd / && tar xzf /backup/marqueeit-db-YYYY-MM-DD.tar.gz"
```

## Updating

```bash
git pull
docker compose up -d --build
```

The database is preserved across updates. Old sessions and unattended
machines remain accessible.

## Logs

```bash
# All services
docker compose logs -f

# Just the Next.js app
docker compose logs -f nextjs

# Just the signaling server
docker compose logs -f signaling

# Just Caddy (access logs)
docker compose logs -f caddy
```

## Troubleshooting

### "Cannot connect to signaling server" in the browser

The browser session-view connects directly to the signaling server via
WebSocket. Check that:

1. Caddy is running: `docker compose ps caddy`
2. The signaling server is healthy: `docker compose ps signaling`
3. Port 80 is open on your firewall

### Customer can't download the helper app

The Go binaries are baked into the Next.js image at build time. Verify
they exist:

```bash
docker compose exec nextjs ls -la /app/public/downloads/
```

You should see:
- `marqueeit-client-linux`
- `marqueeit-client-windows.exe`
- `marqueeit-client-mac`

### Screen share doesn't work

The Go customer client needs to reach the signaling server. Make sure
your `PUBLIC_URL` is set correctly so the customer's binary knows where
to connect. The customer's browser will use the same URL they visited
to download the binary.

If the customer is behind a strict NAT, you may need to add a TURN server
(not included in this setup).

### Remote control doesn't work on Windows/Mac

The Windows and Mac Go binaries currently have **stubbed input injection**.
Only the Linux binary has real X11 input injection. This is a known
limitation — see the worklog for details.

## Architecture

```
                    ┌─────────────────────────────────┐
                    │           Customer               │
                    │  (runs marqueeit-client binary)  │
                    └───────────────┬─────────────────┘
                                    │
                                    │ WebSocket
                                    │ (screen frames + input events)
                                    ▼
┌──────────────┐         ┌──────────────────────┐
│  Technician  │◄───────►│   Caddy (port 80/443)│
│   Browser    │  HTTPS  │  reverse proxy       │
└──────────────┘         └──────┬───────┬───────┘
                                │       │
                  ┌─────────────┘       └─────────────┐
                  ▼                                   ▼
         ┌────────────────┐                  ┌────────────────┐
         │  Next.js:3000  │                  │ Signaling:3003 │
         │  - Web UI      │                  │  - WebSocket   │
         │  - REST API    │                  │    relay       │
         │  - /downloads  │                  │                │
         └───────┬────────┘                  └────────────────┘
                 │
                 ▼
         ┌────────────────┐
         │   SQLite DB    │
         │ (db-data vol)  │
         └────────────────┘
```

## Unattended access setup

Unattended access lets a technician connect to a customer's machine
without anyone being at the keyboard. Setup:

1. Technician logs in to the dashboard
2. Clicks "Setup Unattended" and generates a machine code
3. On the customer's machine, downloads the Go binary and runs:
   ```bash
   ./marqueeit-client-linux --unattended MACHINECODE --server https://support.yourcompany.com
   ```
4. The binary registers with the server and runs in the background
5. The technician can now click "Connect" on the dashboard to start a
   session any time

For production, set up the binary as a systemd service on the customer's
machine so it survives reboots. The binary itself will create a systemd
unit file at `~/.config/systemd/user/marqueeit-unattended.service` —
enable it with:

```bash
systemctl --user enable --now marqueeit-unattended.service
```

## License

Private. MarqueeIT.
