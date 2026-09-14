import fs from "node:fs/promises";
import path from "node:path";
import { cachedTdataDir, extractTempDir, stagingTdataDir } from "./paths";
import { materializeBundleRoot } from "./extract-archive";
import { runSidecarImport } from "./python-bridge";
import {
  ensurePortableTelegram,
  installTdataToPortable,
  launchPortableTelegram,
  quitPortableTelegram,
  readPortableTelegramAuthProblem,
} from "./telegram-portable";
import { importBlockedMessage, isImportAllowedForSource } from "./verification-cache";

export type ImportProgress = {
  phase: "prepare" | "sidecar" | "telegram" | "launch" | "done" | "error";
  message: string;
};

export type ImportOutcome = {
  ok: boolean;
  method?: string;
  error?: string;
  warning?: string;
};

async function rmDirSafe(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function tdataHasKeyData(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.some((e) => e.toLowerCase().includes("key_data"));
  } catch {
    return false;
  }
}

async function copyTdataTree(from: string, to: string): Promise<void> {
  await rmDirSafe(to);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
}

export async function runImportPipeline(
  sourcePath: string,
  emit: (p: ImportProgress) => void
): Promise<ImportOutcome> {
  try {
    if (!isImportAllowedForSource(sourcePath)) {
      const error = importBlockedMessage();
      emit({ phase: "error", message: error });
      return { ok: false, error };
    }

    await quitPortableTelegram();

    emit({ phase: "prepare", message: "Reading your delivery folder or archive..." });
    const tempRoot = extractTempDir();
    const bundleDir = await materializeBundleRoot(sourcePath, tempRoot);

    const staging = stagingTdataDir();
    await rmDirSafe(staging);
    await fs.mkdir(staging, { recursive: true });

    emit({ phase: "sidecar", message: "Preparing tdata (copy or session convert)..." });
    let method = "session_converted";
    let tdataPath: string | null = null;

    const sidecar = await runSidecarImport(bundleDir, staging, (line) => {
      emit({ phase: "sidecar", message: line });
    });

    if (sidecar.ok && sidecar.tdataPath && (await tdataHasKeyData(sidecar.tdataPath))) {
      tdataPath = sidecar.tdataPath;
      method = sidecar.method ?? method;
      await copyTdataTree(tdataPath, cachedTdataDir());
      emit({ phase: "sidecar", message: "Cached tdata for quick retry." });
    } else {
      const cached = cachedTdataDir();
      if (await tdataHasKeyData(cached)) {
        tdataPath = cached;
        method = "cached_tdata";
        emit({
          phase: "sidecar",
          message:
            "Session re-convert failed or timed out. Reusing tdata from your last successful import.",
        });
      } else if (!sidecar.ok) {
        let error = sidecar.error ?? "Import failed.";
        const d = sidecar.diagnostic;
        if (d) {
          const bits = [
            d.hasTdata ? "tdata found" : "no tdata",
            d.sessionPath ? "session found" : "no Telethon .session",
            d.hasMetaJson ? "JSON meta found" : "no JSON meta in folder",
          ];
          error = `${error} (${bits.join(", ")})`;
        }
        return { ok: false, error };
      }
    }

    if (!tdataPath) {
      return { ok: false, error: "No valid tdata was produced or cached." };
    }

    emit({
      phase: "telegram",
      message: "Setting up isolated portable Telegram (not your personal install)...",
    });
    await ensurePortableTelegram((line) => emit({ phase: "telegram", message: line }));

    emit({ phase: "telegram", message: "Installing session into isolated Telegram data folder..." });
    await installTdataToPortable(tdataPath);

    emit({ phase: "launch", message: "Opening Telegram..." });
    launchPortableTelegram();

    emit({ phase: "launch", message: "Checking Telegram login response..." });
    const authProblem = await readPortableTelegramAuthProblem();
    if (authProblem) {
      emit({ phase: "error", message: authProblem });
      return { ok: false, error: authProblem, method };
    }

    emit({ phase: "done", message: "Telegram launched with this order's session." });
    return { ok: true, method };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ phase: "error", message });
    return { ok: false, error: message };
  }
}
