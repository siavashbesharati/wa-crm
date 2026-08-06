/**
 * Pack WAchromeExtension into platform/web/public/downloads for onboarding download.
 *
 * Syncs version from config/extension.json first.
 *
 * Usage (repo root):
 *   node scripts/pack-extension-download.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Keep every consumer on the same version before packing.
execFileSync(process.execPath, [join(__dirname, "sync-extension-version.mjs")], {
  cwd: root,
  stdio: "inherit"
});

const src = join(root, "WAchromeExtension");
const outDir = join(root, "platform", "web", "public", "downloads");
const outZip = join(outDir, "iranexpedia-extension.zip");
const outMeta = join(outDir, "extension-meta.json");
const cfg = JSON.parse(readFileSync(join(root, "config", "extension.json"), "utf8"));
const version = String(cfg.version || "0.0.0");

if (!existsSync(src)) {
  console.error("Missing folder:", src);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
if (existsSync(outZip)) rmSync(outZip);

const isWin = process.platform === "win32";
if (isWin) {
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

const meta = {
  version,
  file: "iranexpedia-extension.zip",
  download_path: "/downloads/iranexpedia-extension.zip",
  packed_at: new Date().toISOString()
};
writeFileSync(outMeta, JSON.stringify(meta, null, 2) + "\n");

console.log("Wrote", outZip, `(v${version})`);
console.log("Wrote", outMeta);
