import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { createExtractorFromFile } from "node-unrar-js";
import log from "electron-log";

function archiveKind(filePath: string): "zip" | "rar" | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".rar")) return "rar";
  return null;
}

async function extractZip(archivePath: string, dest: string): Promise<void> {
  const zip = new AdmZip(archivePath);
  zip.extractAllTo(dest, true);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function extractRarWithUnar(archivePath: string, dest: string): Promise<boolean> {
  const unar = process.platform === "win32" ? "unar.exe" : "unar";
  return new Promise((resolve) => {
    const child = spawn(unar, ["-force-overwrite", "-output-directory", dest, archivePath], {
      stdio: "ignore",
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function extractRarWith7z(archivePath: string, dest: string): Promise<boolean> {
  const bin = process.platform === "win32" ? "7z.exe" : "7z";
  return new Promise((resolve) => {
    const child = spawn(bin, ["x", archivePath, `-o${dest}`, "-y"], {
      stdio: "ignore",
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/**
 * createExtractorFromFile writes files under targetPath; ArcFile.extraction is only
 * populated for createExtractorFromData (in-memory). Must iterate all files to finish.
 */
async function extractRarWithNodeUnrar(archivePath: string, dest: string): Promise<void> {
  const extractor = await createExtractorFromFile({
    filepath: archivePath,
    targetPath: dest,
  });
  const result = extractor.extract();
  for (const file of result.files) {
    if (file.fileHeader.flags.directory) continue;
    const relative = file.fileHeader.name.replace(/\\/g, path.sep);
    const onDisk = path.join(dest, relative);
    if (!(await pathExists(onDisk))) {
      throw new Error(`Missing after RAR extract: ${file.fileHeader.name}`);
    }
  }
}

async function extractRar(archivePath: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  if (await extractRarWithUnar(archivePath, dest)) {
    log.info("RAR extracted with unar", archivePath);
    return;
  }

  if (await extractRarWith7z(archivePath, dest)) {
    log.info("RAR extracted with 7z", archivePath);
    return;
  }

  try {
    await extractRarWithNodeUnrar(archivePath, dest);
    log.info("RAR extracted with node-unrar-js", archivePath);
  } catch (err) {
    const hint =
      process.platform === "darwin"
        ? " Install `unar` (brew install unar) for difficult RAR archives."
        : " Install 7-Zip or WinRAR unrar on PATH if extraction keeps failing.";
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}${hint}`);
  }
}

export async function extractArchive(archivePath: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const kind = archiveKind(archivePath);
  if (kind === "zip") {
    await extractZip(archivePath, dest);
    return;
  }
  if (kind === "rar") {
    await extractRar(archivePath, dest);
    return;
  }
  throw new Error("Unsupported archive type. Use .zip or .rar.");
}

/** If the bundle root is itself an archive, or contains one archive, extract it. */
export async function materializeBundleRoot(sourcePath: string, workDir: string): Promise<string> {
  const stat = await fs.stat(sourcePath);
  if (stat.isDirectory()) {
    return unwrapNestedArchives(sourcePath, workDir);
  }

  const kind = archiveKind(sourcePath);
  if (!kind) {
    throw new Error("Select a folder, .zip, or .rar from your HStock download.");
  }

  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  await extractArchive(sourcePath, workDir);
  return unwrapNestedArchives(workDir, workDir);
}

async function unwrapNestedArchives(root: string, workDir: string): Promise<string> {
  let current = root;

  for (let depth = 0; depth < 3; depth += 1) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    const visible = entries.filter(
      (e) => e.name !== "__MACOSX" && !e.name.startsWith(".")
    );

    const archives = visible.filter(
      (e) =>
        e.isFile() &&
        (e.name.toLowerCase().endsWith(".zip") || e.name.toLowerCase().endsWith(".rar"))
    );
    if (archives.length === 1 && visible.length === 1) {
      const nested = path.join(current, archives[0].name);
      const nestedDest = path.join(workDir, `_nested-${depth}`);
      await fs.rm(nestedDest, { recursive: true, force: true });
      await fs.mkdir(nestedDest, { recursive: true });
      await extractArchive(nested, nestedDest);
      current = nestedDest;
      continue;
    }

    if (visible.length === 1 && visible[0].isDirectory()) {
      current = path.join(current, visible[0].name);
      continue;
    }

    break;
  }

  return current;
}
