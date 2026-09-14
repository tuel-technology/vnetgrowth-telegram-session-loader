import { app, BrowserWindow, ipcMain } from "electron";
import log from "electron-log";
import { autoUpdater } from "electron-updater";

export type UpdateStatusPayload =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function sendStatus(win: BrowserWindow, payload: UpdateStatusPayload): void {
  if (win.isDestroyed()) return;
  win.webContents.send("update-status", payload);
}

function activeWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows()[0];
  return win && !win.isDestroyed() ? win : null;
}

export function registerAutoUpdaterIpc(): void {
  ipcMain.handle("update-download", async () => {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  });

  ipcMain.handle("update-install", () => {
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });

  ipcMain.handle("update-check", async () => {
    if (!app.isPackaged) return { ok: false, reason: "dev" };
    await autoUpdater.checkForUpdates();
    return { ok: true };
  });
}

export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) {
    log.info("[updater] skipped in development");
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    const win = getWindow();
    if (win) sendStatus(win, { state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    const win = getWindow();
    if (win) sendStatus(win, { state: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    const win = getWindow();
    if (win) sendStatus(win, { state: "idle" });
  });

  autoUpdater.on("download-progress", (progress) => {
    const win = getWindow();
    if (win) {
      sendStatus(win, {
        state: "downloading",
        percent: progress.percent ?? 0,
      });
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    const win = getWindow();
    if (win) sendStatus(win, { state: "ready", version: info.version });
  });

  autoUpdater.on("error", (err) => {
    log.warn("[updater]", err);
    const win = getWindow();
    if (win) {
      sendStatus(win, {
        state: "error",
        message: err.message || "Update check failed",
      });
    }
  });

  const runCheck = (): void => {
    void autoUpdater.checkForUpdates().catch((err: unknown) => {
      log.warn("[updater] check failed", err);
    });
  };

  setTimeout(runCheck, 8_000);
  setInterval(runCheck, CHECK_INTERVAL_MS);
}

export { activeWindow };
