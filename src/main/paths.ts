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
