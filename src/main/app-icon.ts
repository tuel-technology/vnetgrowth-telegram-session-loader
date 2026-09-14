import { app, nativeImage, type NativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";

function resourcesDir(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }

  const fromAppPath = path.join(app.getAppPath(), "resources");
  if (fs.existsSync(fromAppPath)) {
    return fromAppPath;
  }

  return path.join(app.getAppPath(), "..", "..", "resources");
}

export function loadAppIcon(): NativeImage | undefined {
  const dir = resourcesDir();
  const candidates =
    process.platform === "win32"
      ? ["icon.ico", "icon.png"]
      : process.platform === "darwin"
        ? ["icon.icns", "icon.png"]
        : ["icon.png"];

  for (const name of candidates) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) continue;
    const image = nativeImage.createFromPath(filePath);
    if (!image.isEmpty()) {
      return image;
    }
  }

  return undefined;
}
