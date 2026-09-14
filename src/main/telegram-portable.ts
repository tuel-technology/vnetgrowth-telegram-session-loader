import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import log from "electron-log";
import AdmZip from "adm-zip";
import { portableTelegramDir, portableTelegramWorkdir } from "./paths";

const execFileAsync = promisify(execFile);

const WIN_PORTABLE_URL = "https://telegram.org/dl/desktop/win64_portable";
const MAC_DOWNLOAD_URL = "https://telegram.org/dl/desktop/mac";
const MAC_SYSTEM_TELEGRAM = "/Applications/Telegram.app";
const DOWNLOAD_TIMEOUT_MS = 25 * 60 * 1000;

export type PortableStatus = {
  ready: boolean;
  platform: NodeJS.Platform;
  telegramExe: string | null;
  message: string;
};

function telegramBinaryPath(root: string, platform: NodeJS.Platform): string | null {
  if (platform === "win32") {
    return path.join(root, "Telegram.exe");
  }
  if (platform === "darwin") {
    return path.join(root, "Telegram.app", "Contents", "MacOS", "Telegram");
  }
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findTelegramBinary(dir: string): Promise<string | null> {
  if (!(await pathExists(dir))) {
    return null;
  }

  const direct = telegramBinaryPath(dir, process.platform);
  if (direct && (await pathExists(direct))) {
    return direct;
  }

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = await findTelegramBinary(path.join(dir, entry.name));
    if (nested) return nested;
  }
  return null;
}

async function ensurePortableRoot(): Promise<string> {
  const root = portableTelegramDir();
  await fs.mkdir(root, { recursive: true });
  if (process.platform === "darwin") {
    await fs.mkdir(portableTelegramWorkdir(), { recursive: true });
  }
  return root;
}

export async function getPortableStatus(): Promise<PortableStatus> {
  await ensurePortableRoot().catch(() => portableTelegramDir());
  const exe = await findTelegramBinary(portableTelegramDir());
  if (exe) {
    return {
      ready: true,
      platform: process.platform,
      telegramExe: exe,
      message: "Isolated Telegram copy is ready in app storage.",
    };
  }

  return {
    ready: false,
    platform: process.platform,
    telegramExe: null,
    message:
      process.platform === "darwin"
        ? "Telegram will be downloaded on first import (macOS, separate from your personal install)."
        : "Telegram will be downloaded on first import (Windows portable).",
  };
}

async function installMacTelegramFromDmg(dmgPath: string, destRoot: string): Promise<void> {
  const mountPoint = path.join(destRoot, "_dmg_mount");
  await fs.mkdir(mountPoint, { recursive: true });

  await execFileAsync("hdiutil", [
    "attach",
    dmgPath,
    "-nobrowse",
    "-readonly",
    "-mountpoint",
    mountPoint,
  ]);

  try {
    const appSrc = path.join(mountPoint, "Telegram.app");
    if (!(await pathExists(appSrc))) {
      throw new Error("Telegram.app not found inside the downloaded disk image.");
    }
    const appDest = path.join(destRoot, "Telegram.app");
    await fs.rm(appDest, { recursive: true, force: true });
    await fs.cp(appSrc, appDest, { recursive: true });
  } finally {
    await execFileAsync("hdiutil", ["detach", mountPoint, "-quiet"]).catch(() => undefined);
    await fs.unlink(dmgPath).catch(() => undefined);
    await fs.rm(mountPoint, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function downloadToFile(
  url: string,
  destPath: string,
  onProgress: ((line: string) => void) | undefined,
  label: string
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${label} failed (HTTP ${res.status}).`);
    }

    const totalBytes = Number(res.headers.get("content-length") ?? 0);
    onProgress?.(
      totalBytes > 0
        ? `${label} (about ${(totalBytes / (1024 * 1024)).toFixed(0)} MB from telegram.org)...`
        : `${label} from telegram.org (this can take several minutes)...`
    );

    const body = res.body;
    if (!body) {
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(destPath, buffer);
      onProgress?.(`${label} complete.`);
      return;
    }

    const reader = body.getReader();
    const handle = await fs.open(destPath, "w");
    let received = 0;
    let lastReportMs = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        await handle.write(value);

        const now = Date.now();
        if (now - lastReportMs >= 2500) {
          lastReportMs = now;
          const receivedMb = (received / (1024 * 1024)).toFixed(1);
          if (totalBytes > 0) {
            const pct = Math.min(100, Math.round((received / totalBytes) * 100));
            const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
            onProgress?.(`${label}... ${receivedMb} / ${totalMb} MB (${pct}%)`);
          } else {
            onProgress?.(`${label}... ${receivedMb} MB downloaded`);
          }
        }
      }
    } finally {
      await handle.close();
    }

    onProgress?.(`${label} complete (${(received / (1024 * 1024)).toFixed(1)} MB).`);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `${label} timed out after ${Math.round(DOWNLOAD_TIMEOUT_MS / 60000)} minutes. Check your network and try Import again.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function copyMacTelegramFromApplications(
  destRoot: string,
  onProgress?: (line: string) => void
): Promise<string | null> {
  if (process.env.VNETGROWTH_SKIP_SYSTEM_TELEGRAM_COPY === "1") {
    return null;
  }
  if (!(await pathExists(MAC_SYSTEM_TELEGRAM))) {
    return null;
  }

  onProgress?.(
    "Found Telegram.app in /Applications. Copying into app storage (faster than downloading)..."
  );
  const appDest = path.join(destRoot, "Telegram.app");
  await fs.rm(appDest, { recursive: true, force: true });
  await fs.cp(MAC_SYSTEM_TELEGRAM, appDest, { recursive: true });

  const exe = await findTelegramBinary(destRoot);
  if (!exe) {
    return null;
  }
  onProgress?.("Telegram.app copied to isolated app storage.");
  return exe;
}

async function downloadMacTelegram(
  root: string,
  onProgress?: (line: string) => void
): Promise<string> {
  const fromSystem = await copyMacTelegramFromApplications(root, onProgress);
  if (fromSystem) {
    return fromSystem;
  }

  const dmgPath = path.join(root, "Telegram.dmg");
  const macUrl = process.env.VNETGROWTH_TELEGRAM_MAC_URL?.trim() || MAC_DOWNLOAD_URL;
  await downloadToFile(
    macUrl,
    dmgPath,
    onProgress,
    "Downloading Telegram for macOS"
  );

  onProgress?.("Installing Telegram.app into app storage (not /Applications)...");
  await installMacTelegramFromDmg(dmgPath, root);

  const exe = await findTelegramBinary(root);
  if (!exe) {
    throw new Error("Telegram binary not found after macOS install.");
  }
  return exe;
}

async function downloadWindowsPortable(
  root: string,
  onProgress?: (line: string) => void
): Promise<string> {
  const zipPath = path.join(root, "tportable.zip");
  const winUrl = process.env.VNETGROWTH_TELEGRAM_WIN_URL?.trim() || WIN_PORTABLE_URL;
  await downloadToFile(
    winUrl,
    zipPath,
    onProgress,
    "Downloading Telegram Desktop portable"
  );

  onProgress?.("Extracting portable Telegram...");
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(root, true);
  await fs.unlink(zipPath).catch(() => undefined);

  const exe = await findTelegramBinary(root);
  if (!exe) {
    throw new Error("Telegram.exe not found after extract.");
  }
  return exe;
}

export async function ensurePortableTelegram(
  onProgress?: (line: string) => void
): Promise<string> {
  const root = await ensurePortableRoot();
  const existing = await findTelegramBinary(root);
  if (existing) return existing;

  if (process.platform === "win32") {
    const exe = await downloadWindowsPortable(root, onProgress);
    onProgress?.("Portable Telegram installed in app data (separate from your personal Telegram).");
    return exe;
  }

  if (process.platform === "darwin") {
    const exe = await downloadMacTelegram(root, onProgress);
    onProgress?.(
      "Telegram.app installed in app data. Sessions use a dedicated workdir, not your personal Telegram."
    );
    return exe;
  }

  throw new Error(`Automatic Telegram setup is not implemented for ${process.platform} yet.`);
}

function resolveTdataDestination(telegramBinary: string): string {
  if (process.platform === "darwin") {
    return path.join(portableTelegramWorkdir(), "tdata");
  }
  return path.join(path.dirname(telegramBinary), "tdata");
}

async function killProcessesMatching(substring: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", substring]);
    const pids = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const pid of pids) {
      process.kill(Number(pid), "SIGTERM");
    }
    if (pids.length > 0) {
      await new Promise((r) => setTimeout(r, 1200));
    }
  } catch {
    // pgrep returns exit 1 when no matches
  }
}

export async function quitPortableTelegram(): Promise<void> {
  const binary = await findTelegramBinary(portableTelegramDir());
  if (!binary) return;

  if (process.platform === "darwin") {
    await killProcessesMatching(binary);
    return;
  }

  if (process.platform === "win32") {
    const portableRoot = portableTelegramDir().toLowerCase();
    if (binary.toLowerCase().includes(portableRoot.replace(/\//g, "\\"))) {
      await execFileAsync("taskkill", ["/IM", "Telegram.exe", "/F"]).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}

async function tdataLooksValid(tdataPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(tdataPath);
    return entries.some((e) => e.toLowerCase().includes("key_data"));
  } catch {
    return false;
  }
}

export async function installTdataToPortable(tdataSource: string): Promise<void> {
  await quitPortableTelegram();

  const portableRoot = await ensurePortableRoot();
  const binary = await findTelegramBinary(portableRoot);
  if (!binary) {
    throw new Error("Telegram is not installed in app storage yet.");
  }

  if (process.platform === "darwin") {
    await fs.rm(portableTelegramWorkdir(), { recursive: true, force: true });
    await fs.mkdir(portableTelegramWorkdir(), { recursive: true });
  }

  const destTdata = resolveTdataDestination(binary);
  await fs.mkdir(path.dirname(destTdata), { recursive: true });
  await fs.rm(destTdata, { recursive: true, force: true });
  await copyDirRecursive(tdataSource, destTdata);

  if (!(await tdataLooksValid(destTdata))) {
    throw new Error("tdata install failed: key_data is missing after copy.");
  }
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

const AUTH_REJECT_MARKERS = ["AUTH_KEY_UNREGISTERED", "AUTH_KEY_INVALID"] as const;

export async function readPortableTelegramAuthProblem(): Promise<string | null> {
  await new Promise((r) => setTimeout(r, 4500));
  const logPath = path.join(portableTelegramWorkdir(), "log.txt");
  let text = "";
  try {
    text = await fs.readFile(logPath, "utf8");
  } catch {
    return null;
  }

  for (const marker of AUTH_REJECT_MARKERS) {
    if (text.includes(marker)) {
      return (
        "Telegram rejected this order's session (" +
        marker +
        "). The delivery is expired or revoked on Telegram's servers. " +
        "The loader built tdata correctly, but the account cannot log in. Contact your seller for a fresh session or tdata."
      );
    }
  }
  return null;
}

export function launchPortableTelegram(): void {
  void (async () => {
    const binary = await findTelegramBinary(portableTelegramDir());
    if (!binary) {
      throw new Error("Telegram is not ready.");
    }

    const args =
      process.platform === "darwin"
        ? ["-workdir", path.resolve(portableTelegramWorkdir())]
        : [];

    log.info("Launching isolated Telegram", binary, args);
    spawn(binary, args, {
      cwd: process.platform === "darwin" ? path.resolve(portableTelegramWorkdir()) : path.dirname(binary),
      detached: true,
      stdio: "ignore",
    }).unref();
  })();
}

export function isDev(): boolean {
  return !app.isPackaged;
}
