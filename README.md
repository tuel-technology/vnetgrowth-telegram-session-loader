# VnetGrowth Telegram Session Loader

Desktop app (Electron + Python) for HStock-style **aged Telegram** deliveries:

- **`tdata` in the archive** - copied into an isolated Telegram Desktop install
- **`.session` + JSON** - converted offline when possible, then launched in isolated Desktop

Your personal Telegram install is **not** modified.

## Download (customers)

**Install guide (recommended, includes security steps):**  
https://vnetgrowth.com/download/session-loader/install

**Direct file download:**  
https://vnetgrowth.com/download/session-loader/file

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

Packaged apps need a **relocatable** Python (not a machine-local `venv`). That is what CI ships:

```bash
npm run sidecar:bundle      # macOS / Linux (uv + python-build-standalone)
npm run sidecar:bundle:win  # Windows
npm run build
npm run dist:mac   # macOS
npm run dist:win   # Windows
```

`npm run sidecar:install` is only for local `npm run dev` when you already have Python 3.11 on the machine.

## Releasing (maintainers)

Before tagging:

1. Bump `version` in `package.json`.
2. Grep for `virtualnetgrowth.com` in this repo and `client-app/` (user-facing URLs only). Use **https://vnetgrowth.com** everywhere. Keep `com.virtualnetgrowth` in Electron `appId` as-is.
3. Confirm `App.tsx` `VNG_SITE` and the smart download URL in this README match `vnetgrowth.com`.

```bash
git tag -a v0.1.2 -m "v0.1.2"
git push origin main
git push origin v0.1.2
```

GitHub Actions builds macOS and Windows artifacts (including auto-update metadata) and attaches them to the release. Installed apps only pick up domain or UI fixes after users get a new release build.

## macOS "cannot verify" or Windows SmartScreen

Unsigned builds show a security prompt on first launch. **Permanent fix:** configure Apple and Windows signing secrets in GitHub (see [docs/CODE_SIGNING.md](./docs/CODE_SIGNING.md)) and publish a new release tag.

**macOS workaround (current unsigned builds):**

1. Drag the app to **Applications**.
2. Double-click once and click **Done** on the verification warning (required before **Open Anyway** appears on macOS 15+).
3. **System Settings > Privacy & Security > Security** (bottom) > **Open Anyway**, then confirm **Open**.
4. If still blocked: `xattr -dr com.apple.quarantine "/Applications/Telegram Session Loader.app"`  
   (Control-click > Open only works on macOS 14 and earlier.)

**Windows workaround:** on SmartScreen, click **More info**, then **Run anyway**.

## Security

Order files grant full account access. This app processes files locally and does not upload bundles to VnetGrowth servers.
