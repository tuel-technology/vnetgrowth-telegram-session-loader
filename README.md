# VnetGrowth Telegram Session Loader

Desktop app (Electron + Python) for HStock-style **aged Telegram** deliveries:

- **`tdata` in the archive** - copied into an isolated Telegram Desktop install
- **`.session` + JSON** - converted offline when possible, then launched in isolated Desktop

Your personal Telegram install is **not** modified.

## Download (customers)

**Smart link (picks Mac or Windows):**  
https://vnetgrowth.com/download/session-loader

**All builds:**  
https://github.com/tuel-technology/vnetgrowth-telegram-session-loader/releases/latest

## User flow

1. Install the Session Loader from the link above.
2. Download your order `.zip` or `.rar` from VnetGrowth.
3. Open the app, choose the archive or extracted folder.
4. Run **Test session only** and confirm the session is live.
5. Run **Import and open Telegram**.

## Development

Requirements: Node.js 20+, Python 3.11+.

```bash
npm install
npm run sidecar:install   # macOS / Linux
npm run sidecar:install:win
npm run dev
```

Optional: `export VNETGROWTH_PYTHON=/path/to/python`

## Build installers locally

```bash
npm run build
npm run dist:mac   # macOS
npm run dist:win   # Windows
```

Output under `release/`.

## Releasing (maintainers)

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions builds macOS and Windows artifacts and attaches them to the release.

## Security

Order files grant full account access. This app processes files locally and does not upload bundles to VnetGrowth servers.
