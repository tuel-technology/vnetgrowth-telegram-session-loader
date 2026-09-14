const TTL_MS = 45 * 60 * 1000;

const LIVE_IMPORT_STATUSES = new Set([
  "live",
  "live_2fa",
  "tdata_only",
  "importable_offline",
]);

type Entry = {
  sourcePath: string;
  status: string;
  at: number;
};

let entry: Entry | null = null;

export function recordSessionTest(sourcePath: string, status: string | undefined, ok: boolean): void {
  if (!ok || !status || !LIVE_IMPORT_STATUSES.has(status)) {
    if (entry?.sourcePath === sourcePath) {
      entry = null;
    }
    return;
  }
  entry = { sourcePath, status, at: Date.now() };
}

export function isImportAllowedForSource(sourcePath: string): boolean {
  if (!entry || entry.sourcePath !== sourcePath) {
    return false;
  }
  if (Date.now() - entry.at > TTL_MS) {
    entry = null;
    return false;
  }
  return LIVE_IMPORT_STATUSES.has(entry.status);
}

export function importBlockedMessage(): string {
  return (
    "Import requires a successful session test first. Use Test session only and wait for " +
    "Session is live on Telegram (or tdata-only bundle) before importing."
  );
}
