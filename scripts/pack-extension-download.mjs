/**
 * Pack WAchromeExtension into platform/web/public/downloads for onboarding download.
 *
 * Usage (repo root):
 *   node scripts/pack-extension-download.mjs
 */
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "WAchromeExtension");
const outDir = join(root, "platform", "web", "public", "downloads");
const outZip = join(outDir, "iranexpedia-extension.zip");

if (!existsSync(src)) {
  console.error("Missing folder:", src);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
if (existsSync(outZip)) rmSync(outZip);

const isWin = process.platform === "win32";
if (isWin) {
  // Compress-Archive includes the folder name as root entry
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${src.replace(/'/g, "''")}' -DestinationPath '${outZip.replace(/'/g, "''")}' -Force`
    ],
    { stdio: "inherit" }
  );
} else {
  execFileSync("zip", ["-r", outZip, "WAchromeExtension", "-x", "*.DS_Store", "*__pycache__*"], {
    cwd: root,
    stdio: "inherit"
  });
}

console.log("Wrote", outZip);
