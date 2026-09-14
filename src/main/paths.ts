import { app } from "electron";
import path from "node:path";

export function appDataRoot(): string {
  return path.join(app.getPath("userData"), "vnetgrowth-session-loader");
}

export function portableTelegramDir(): string {
  return path.join(appDataRoot(), "telegram-portable");
}

/** macOS Telegram uses -workdir; tdata lives here (not inside Telegram.app). */
export function portableTelegramWorkdir(): string {
  return path.join(portableTelegramDir(), "workdir");
}

export function stagingTdataDir(): string {
  return path.join(appDataRoot(), "staging-tdata");
}

/** Last successful tdata build (reuse when session re-convert fails on retry). */
export function cachedTdataDir(): string {
  return path.join(appDataRoot(), "cached-tdata", "tdata");
}

export function extractTempDir(): string {
  return path.join(appDataRoot(), "extract-temp");
}

export function sidecarRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "python-sidecar");
  }
  return path.join(app.getAppPath(), "python-sidecar");
}

/** Bundled venv from CI (extraResources); dev uses project-root .venv */
export function sidecarBundledPython(): string {
  const isWin = process.platform === "win32";
  if (app.isPackaged) {
    return isWin
      ? path.join(process.resourcesPath, "sidecar-venv", "Scripts", "python.exe")
      : path.join(process.resourcesPath, "sidecar-venv", "bin", "python3");
  }
  return isWin
    ? path.join(app.getAppPath(), ".venv", "Scripts", "python.exe")
    : path.join(app.getAppPath(), ".venv", "bin", "python3");
}
