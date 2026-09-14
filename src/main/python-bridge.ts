import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import log from "electron-log";
import { sidecarBundledPython, sidecarBundledPythonCandidates, sidecarRoot } from "./paths";

const SIDECAR_TIMEOUT_MS = 120_000;
const SIDECAR_TEST_TIMEOUT_MS = 90_000;

export type SidecarTestResult = {
  ok: boolean;
  status?: string;
  message?: string;
  phone?: string;
  userId?: number | string;
  username?: string | null;
  error?: string;
  detail?: string;
  diagnostic?: {
    root?: string;
    hasTdata?: boolean;
    sessionPath?: string | null;
    hasMetaJson?: boolean;
  };
};

export type SidecarResult = {
  ok: boolean;
  method?: "tdata_copy" | "tdata_loaded" | "session_converted" | "cached_tdata";
  tdataPath?: string;
  phone?: string;
  error?: string;
  detail?: string;
  diagnostic?: {
    root?: string;
    hasTdata?: boolean;
    tdataPath?: string | null;
    sessionPath?: string | null;
    hasMetaJson?: boolean;
    hasCloudPassword?: boolean;
  };
};

function pathExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function pythonExecutable(): string {
  const env = process.env.VNETGROWTH_PYTHON?.trim();
  if (env) return env;

  const isWin = process.platform === "win32";
  const candidates: string[] = [];

  candidates.push(...sidecarBundledPythonCandidates());

  if (!app.isPackaged) {
    candidates.push(
      path.join(app.getAppPath(), ".venv", isWin ? "Scripts/python.exe" : "bin/python3"),
      path.join(app.getAppPath(), ".venv", isWin ? "Scripts/python.exe" : "bin/python")
    );
  }

  candidates.push(isWin ? "python" : "python3");

  for (const candidate of candidates) {
    if (!candidate.includes("/") && !candidate.includes("\\")) {
      return candidate;
    }
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  return sidecarBundledPython();
}

function assertSidecarRuntime(python: string): void {
  const root = sidecarRoot();
  if (!pathExists(root)) {
    throw new Error(
      `Session tools are missing from this install (${root}). Download the latest Session Loader build.`
    );
  }

  if (
    (python.includes("/") || python.includes("\\")) &&
    !pathExists(python)
  ) {
    throw new Error(
      app.isPackaged
        ? "Bundled Python for session checks is missing. Re-download the latest Telegram Session Loader from vnetgrowth.com."
        : `Python not found at ${python}. Run npm run sidecar:install in telegram-session-loader.`
    );
  }
}

function killSidecar(child: ChildProcessWithoutNullStreams): void {
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 3000).unref();
}

function sidecarEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPATH: sidecarRoot(),
    PYTHONUNBUFFERED: "1",
    VNETGROWTH_TDATA_SYSTEM:
      process.platform === "darwin"
        ? "macos"
        : process.platform === "win32"
          ? "windows"
          : "linux",
  };
}

function runSidecarJson<T>(
  moduleArgs: string[],
  timeoutMs: number,
  timeoutMessage: string,
  onLog?: (line: string) => void
): Promise<T> {
  const python = pythonExecutable();
  assertSidecarRuntime(python);
  const sidecar = sidecarRoot();

  log.info("[sidecar] python", python, "cwd", sidecar);

  return new Promise((resolve, reject) => {
    const child = spawn(python, moduleArgs, {
      cwd: sidecar,
      env: sidecarEnv(),
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killSidecar(child);
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          log.info("[sidecar]", trimmed);
          onLog?.(trimmed);
        }
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const hint = app.isPackaged
        ? " Reinstall the latest Session Loader from your vnetgrowth order page."
        : " Run npm run sidecar:install in telegram-session-loader.";
      reject(
        new Error(
          `Could not start session tools (${python}).${hint} ${err.message}`
        )
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const line = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();

      if (!line) {
        reject(
          new Error(
            code === 0
              ? "Sidecar returned no output."
              : `Sidecar failed (${code}): ${stderr || "unknown error"}`
          )
        );
        return;
      }

      try {
        resolve(JSON.parse(line) as T);
      } catch {
        reject(new Error(`Invalid sidecar JSON: ${line}\n${stderr}`));
      }
    });
  });
}

export async function runSidecarImport(
  bundleDir: string,
  outTdataDir: string,
  onLog?: (line: string) => void
): Promise<SidecarResult> {
  await fsPromises.access(bundleDir).catch(() => {
    throw new Error("Bundle folder not found.");
  });

  return runSidecarJson<SidecarResult>(
    [
      "-u",
      "-m",
      "sidecar",
      "import-bundle",
      "--input",
      bundleDir,
      "--out",
      outTdataDir,
    ],
    SIDECAR_TIMEOUT_MS,
    "Import timed out after 2 minutes. If this archive has tdata, ensure it was extracted fully. Otherwise the session may be invalid or blocked.",
    onLog
  );
}

export async function runSidecarTest(
  bundleDir: string,
  onLog?: (line: string) => void
): Promise<SidecarTestResult> {
  await fsPromises.access(bundleDir).catch(() => {
    throw new Error("Bundle folder not found.");
  });

  return runSidecarJson<SidecarTestResult>(
    ["-u", "-m", "sidecar", "test-bundle", "--input", bundleDir],
    SIDECAR_TEST_TIMEOUT_MS,
    "Session test timed out after 90 seconds. Check your network and try again.",
    onLog
  );
}
