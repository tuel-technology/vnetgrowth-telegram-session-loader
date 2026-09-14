import { contextBridge, ipcRenderer } from "electron";

export type ImportProgressEvent = {
  phase: string;
  message: string;
};

export type UpdateStatusPayload =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

contextBridge.exposeInMainWorld("sessionLoader", {
  getPortableStatus: () => ipcRenderer.invoke("portable-status"),
  pickBundle: () => ipcRenderer.invoke("pick-bundle") as Promise<string | null>,
  importBundle: (sourcePath: string) =>
    ipcRenderer.invoke("import-bundle", sourcePath) as Promise<{
      ok: boolean;
      error?: string;
      method?: string;
      warning?: string;
    }>,
  testBundle: (sourcePath: string) =>
    ipcRenderer.invoke("test-bundle", sourcePath) as Promise<{
      ok: boolean;
      status?: string;
      message?: string;
      phone?: string;
      userId?: number | string;
      username?: string | null;
      error?: string;
    }>,
  onImportProgress: (handler: (event: ImportProgressEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: ImportProgressEvent) =>
      handler(payload);
    ipcRenderer.on("import-progress", listener);
    return () => ipcRenderer.removeListener("import-progress", listener);
  },
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  downloadUpdate: () =>
    ipcRenderer.invoke("update-download") as Promise<{ ok: boolean }>,
  installUpdate: () =>
    ipcRenderer.invoke("update-install") as Promise<{ ok: boolean }>,
  checkForUpdates: () =>
    ipcRenderer.invoke("update-check") as Promise<{ ok: boolean; reason?: string }>,
  onUpdateStatus: (handler: (payload: UpdateStatusPayload) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: UpdateStatusPayload) =>
      handler(payload);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
});
