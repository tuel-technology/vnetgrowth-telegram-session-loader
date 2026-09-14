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

/**
 * Packaged builds use relocatable python-build-standalone (.sidecar-runtime → sidecar-venv).
 * Dev uses project-root .venv from `npm run sidecar:install`.
 */
export function sidecarBundledPython(): string {
  const isWin = process.platform === "win32";
  if (app.isPackaged) {
    const root = path.join(process.resourcesPath, "sidecar-venv");
    if (isWin) {
      // Standalone layout: python.exe at runtime root. Legacy venv: Scripts/python.exe.
      return path.join(root, "python.exe");
    }
    return path.join(root, "bin", "python3");
  }
  return isWin
    ? path.join(app.getAppPath(), ".venv", "Scripts", "python.exe")
    : path.join(app.getAppPath(), ".venv", "bin", "python3");
}

/** Packaged Windows may still ship a classic venv layout from older builds. */
export function sidecarBundledPythonCandidates(): string[] {
  const primary = sidecarBundledPython();
  if (!app.isPackaged || process.platform !== "win32") {
    return [primary];
  }
  return [
    primary,
    path.join(process.resourcesPath, "sidecar-venv", "Scripts", "python.exe"),
  ];
}
