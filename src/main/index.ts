import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import log from "electron-log";
import { loadAppIcon } from "./app-icon";
import { getPortableStatus } from "./telegram-portable";
import { runImportPipeline, type ImportProgress } from "./import-pipeline";
import { runTestPipeline, type TestProgress } from "./test-pipeline";
import { initAutoUpdater, registerAutoUpdaterIpc } from "./auto-updater";

log.initialize({ preload: false });

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const icon = loadAppIcon();
  const win = new BrowserWindow({
    width: 960,
    height: 820,
    minWidth: 780,
    minHeight: 680,
    title: "Telegram Session Loader",
    icon,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
}

registerAutoUpdaterIpc();

app.whenReady().then(() => {
  const icon = loadAppIcon();
  if (process.platform === "darwin" && icon) {
    app.dock?.setIcon(icon);
  }
  createWindow();
  initAutoUpdater(() => mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("portable-status", async () => getPortableStatus());

ipcMain.handle("pick-bundle", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "openDirectory"],
    filters: [
      { name: "Delivery", extensions: ["zip", "rar"] },
      { name: "All", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
});

ipcMain.handle(
  "import-bundle",
  async (event, sourcePath: string): Promise<{ ok: boolean; error?: string; method?: string }> => {
    const send = (progress: ImportProgress) => {
      event.sender.send("import-progress", progress);
    };
    return runImportPipeline(sourcePath, send);
  }
);

ipcMain.handle(
  "test-bundle",
  async (event, sourcePath: string) => {
    const send = (progress: TestProgress) => {
      event.sender.send("import-progress", progress);
    };
    return runTestPipeline(sourcePath, send);
  }
);

ipcMain.handle("open-external", async (_event, url: string) => {
  await shell.openExternal(url);
});
