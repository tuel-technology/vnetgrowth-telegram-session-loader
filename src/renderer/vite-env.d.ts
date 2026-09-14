/// <reference types="vite/client" />

type ImportProgressEvent = {
  phase: string;
  message: string;
};

interface SessionLoaderApi {
  getPortableStatus: () => Promise<{
    ready: boolean;
    platform: string;
    telegramExe: string | null;
    message: string;
  }>;
  pickBundle: () => Promise<string | null>;
  importBundle: (sourcePath: string) => Promise<{
    ok: boolean;
    error?: string;
    method?: string;
    warning?: string;
  }>;
  testBundle: (sourcePath: string) => Promise<{
    ok: boolean;
    status?: string;
    message?: string;
    phone?: string;
    userId?: number | string;
    username?: string | null;
    error?: string;
  }>;
  onImportProgress: (handler: (event: ImportProgressEvent) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
}

interface Window {
  sessionLoader: SessionLoaderApi;
}
