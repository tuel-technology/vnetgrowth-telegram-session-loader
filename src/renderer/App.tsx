import { useCallback, useEffect, useState } from "react";

const VNG_SITE = "https://virtualnetgrowth.com";

type LogLine = { id: number; text: string; tone?: "ok" | "err" | "warn" | "muted" };

type TestResult = {
  ok: boolean;
  status?: string;
  message?: string;
};

function importAllowedStatuses(status: string | undefined): boolean {
  return status === "live" || status === "live_2fa" || status === "tdata_only";
}

function isLiveVerifiedForPath(testResult: TestResult | null, selectedPath: string | null): boolean {
  if (!selectedPath || !testResult?.ok) return false;
  return importAllowedStatuses(testResult.status);
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white"
      aria-hidden
    />
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusIcon({ kind }: { kind: "ok" | "warn" | "err" }) {
  const colors =
    kind === "ok" ? "text-emerald-400" : kind === "warn" ? "text-amber-400" : "text-rose-400";
  return (
    <svg className={`mt-0.5 h-5 w-5 shrink-0 ${colors}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      {kind === "ok" ? (
        <path
          d="M9 12.5l2 2 4-4.5M12 22a10 10 0 110-20 10 10 0 010 20z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M12 8v5m0 3h.01M12 22a10 10 0 110-20 10 10 0 010 20z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export default function App() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"test" | "import" | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [lastOk, setLastOk] = useState<boolean | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  /** Path that last passed a live (or tdata-only) test; must match current selection to import. */
  const [verifiedPath, setVerifiedPath] = useState<string | null>(null);

  const pushLog = useCallback((text: string, tone?: LogLine["tone"]) => {
    setLogs((prev) => [...prev, { id: Date.now() + Math.random(), text, tone }]);
  }, []);

  useEffect(() => {
    const off = window.sessionLoader.onImportProgress((event) => {
      pushLog(event.message, event.phase === "error" ? "err" : "muted");
    });
    return off;
  }, [pushLog]);

  const pick = async () => {
    const path = await window.sessionLoader.pickBundle();
    if (path) {
      setSelectedPath(path);
      setLastOk(null);
      setTestResult(null);
      setVerifiedPath(null);
      pushLog(`Selected: ${path}`, "muted");
    }
  };

  const runImport = async () => {
    if (
      !selectedPath ||
      busy ||
      verifiedPath !== selectedPath ||
      !isLiveVerifiedForPath(testResult, selectedPath)
    ) {
      return;
    }
    setBusy(true);
    setBusyAction("import");
    setLastOk(null);
    pushLog("Starting import...", "muted");

    const result = await window.sessionLoader.importBundle(selectedPath);
    setBusy(false);
    setBusyAction(null);
    setLastOk(result.ok);

    if (result.ok) {
      pushLog(
        result.method === "session_converted"
          ? "Converted session + JSON to tdata and launched portable Telegram."
          : "Installed tdata and launched portable Telegram.",
        "ok"
      );
    } else {
      pushLog(result.error ?? "Import failed.", "err");
    }
  };

  const runTest = async () => {
    if (!selectedPath || busy) return;
    setBusy(true);
    setBusyAction("test");
    setLastOk(null);
    pushLog("Starting session test (no Telegram download)...", "muted");

    const result = await window.sessionLoader.testBundle(selectedPath);
    setBusy(false);
    setBusyAction(null);
    setTestResult(result);
    if (result.ok && importAllowedStatuses(result.status)) {
      setVerifiedPath(selectedPath);
    } else {
      setVerifiedPath(null);
    }
  };

  const openSite = (path: string) => {
    void window.sessionLoader.openExternal(`${VNG_SITE}${path}`);
  };

  const fileName = selectedPath ? selectedPath.replace(/^.*[/\\]/, "") : null;
  const hasFile = Boolean(selectedPath);
  const canImport =
    Boolean(selectedPath) &&
    verifiedPath === selectedPath &&
    isLiveVerifiedForPath(testResult, selectedPath);

  const alertKind = testResult
    ? testResult.ok
      ? "ok"
      : testResult.status === "inconclusive"
        ? "warn"
        : "err"
    : null;

  return (
    <div className="app-shell">
      <header className="titlebar shrink-0 border-b border-zinc-800/70 bg-zinc-950/50 px-6 py-4 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-4xl items-center gap-4">
          <img
            src="/icon.png"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-[11px] ring-1 ring-white/10"
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-white">
              Telegram Session Loader
            </h1>
            <p className="truncate text-xs text-zinc-500">Virtual Net Growth · isolated Desktop import</p>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6 sm:px-8">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5">
          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="surface flex flex-col p-6">
              <div className="flex items-start gap-3">
                <span className={`step-badge ${hasFile ? "step-badge-active" : ""}`}>1</span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-white">Choose delivery</h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Folder, .zip, or .rar from your order (HStock or Google Drive).
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void pick()}
                disabled={busy}
                className={`group mt-5 flex w-full flex-col items-center rounded-xl border border-dashed px-4 py-10 text-center transition ${
                  hasFile
                    ? "border-blue-500/35 bg-blue-500/[0.06] hover:border-blue-400/50"
                    : "border-zinc-700/80 bg-zinc-900/30 hover:border-zinc-600 hover:bg-zinc-900/50"
                }`}
              >
                <span
                  className={`mb-3 flex h-12 w-12 items-center justify-center rounded-xl ring-1 ${
                    hasFile
                      ? "bg-blue-500/15 text-blue-300 ring-blue-500/30"
                      : "bg-zinc-800/80 text-zinc-400 ring-zinc-700"
                  }`}
                >
                  <FolderIcon className="h-6 w-6" />
                </span>
                {fileName ? (
                  <>
                    <span className="text-sm font-medium text-zinc-100">{fileName}</span>
                    <span className="mt-2 max-w-full truncate px-2 text-xs text-zinc-500">
                      {selectedPath}
                    </span>
                    <span className="mt-4 text-xs font-medium text-blue-400 group-hover:text-blue-300">
                      Change selection
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium text-zinc-200">Browse for bundle</span>
                    <span className="mt-1 text-xs text-zinc-500">Click to choose a file or folder</span>
                  </>
                )}
              </button>

              <div className="mt-6 flex items-start gap-3 border-t border-zinc-800/80 pt-6">
                <span className={`step-badge ${hasFile ? "step-badge-active" : ""}`}>2</span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-white">Verify or import</h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Test talks to Telegram without downloading Desktop. Import builds tdata and opens
                    the isolated app copy.
                  </p>
                  <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => void runTest()}
                      disabled={busy || !selectedPath}
                      className="btn-secondary flex-1"
                    >
                      {busyAction === "test" ? <Spinner /> : null}
                      {busyAction === "test" ? "Testing..." : "Test session only"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runImport()}
                      disabled={busy || !canImport}
                      className="btn-primary flex-1"
                      title={
                        canImport
                          ? undefined
                          : "Run Test session only and confirm the session is live first"
                      }
                    >
                      {busyAction === "import" ? <Spinner /> : null}
                      {busyAction === "import" ? "Importing..." : "Import and open Telegram"}
                    </button>
                  </div>
                  {!canImport && hasFile ? (
                    <p className="mt-3 text-xs text-amber-400/90">
                      Run <span className="font-medium text-amber-200">Test session only</span> and
                      wait for a live result before import unlocks.
                    </p>
                  ) : null}
                  {canImport ? (
                    <p className="mt-3 text-xs text-emerald-400/90">
                      Session verified for this bundle. You can import.
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            <aside className="flex flex-col gap-4">
              {testResult ? (
                <div
                  className={
                    alertKind === "ok"
                      ? "alert-success"
                      : alertKind === "warn"
                        ? "alert-warning"
                        : "alert-error"
                  }
                >
                  <StatusIcon kind={alertKind === "ok" ? "ok" : alertKind === "warn" ? "warn" : "err"} />
                  <p>
                    {testResult.message ??
                      (testResult.ok ? "Session test passed." : "Session test failed.")}
                  </p>
                </div>
              ) : (
                <div className="surface flex flex-1 flex-col p-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Quick tips
                  </h3>
                  <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-zinc-400">
                    <li className="flex gap-2">
                      <span className="text-blue-400">·</span>
                      Import stays locked until test shows the session is live.
                    </li>
                    <li className="flex gap-2">
                      <span className="text-blue-400">·</span>
                      Keep the matching .json next to the .session in the archive.
                    </li>
                    <li className="flex gap-2">
                      <span className="text-teal-500">·</span>
                      This app never uses your personal Telegram install.
                    </li>
                  </ul>
                </div>
              )}

              {lastOk === true ? (
                <div className="alert-success">
                  <StatusIcon kind="ok" />
                  <p>
                    Telegram launched with imported data. If you still see QR login, the session may
                    be revoked - check the activity log.
                  </p>
                </div>
              ) : null}
            </aside>
          </div>

          <section className="surface flex min-h-[220px] flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-200">Activity</h2>
                <p className="text-xs text-zinc-600">Import and test output</p>
              </div>
              {logs.length > 0 ? (
                <button type="button" className="btn-ghost" onClick={() => setLogs([])}>
                  Clear
                </button>
              ) : null}
            </div>
            <div className="surface-inset m-4 mt-3 flex-1 overflow-y-auto p-3">
              <ul className="space-y-0.5 font-mono text-[11px] leading-relaxed sm:text-xs">
                {logs.length === 0 ? (
                  <li className="px-2 py-6 text-center text-zinc-600">No activity yet</li>
                ) : (
                  logs.map((line, i) => (
                    <li key={line.id} className="log-line">
                      <span className="w-6 shrink-0 select-none text-right text-zinc-700">
                        {i + 1}
                      </span>
                      <span
                        className={
                          line.tone === "ok"
                            ? "text-emerald-400/95"
                            : line.tone === "err"
                              ? "text-rose-400/95"
                              : line.tone === "warn"
                                ? "text-amber-400/95"
                                : "text-zinc-400"
                        }
                      >
                        {line.text}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </section>
        </div>
      </main>

      <footer className="titlebar shrink-0 border-t border-zinc-800/60 bg-zinc-950/60 px-6 py-2.5 backdrop-blur-sm sm:px-8">
        <p className="mx-auto max-w-4xl text-center text-[11px] text-zinc-500">
          &copy; {new Date().getFullYear()} Virtual Net Growth ·{" "}
          <button
            type="button"
            className="text-zinc-400 underline-offset-2 hover:text-blue-400 hover:underline"
            onClick={() => openSite("/")}
          >
            virtualnetgrowth.com
          </button>
        </p>
      </footer>
    </div>
  );
}
