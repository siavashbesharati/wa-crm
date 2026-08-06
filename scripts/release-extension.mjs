/**
 * Bump / sync / obfuscate / pack the Chrome extension.
 *
 * Output (repo root):
 *   WAchromeExtension-dist/          ← obfuscated Load unpacked folder
 *   WAchromeExtension-dist.zip       ← package ZIP at root (replaces previous)
 *
 * Also copies ZIP to platform/web/public/downloads/ for the business panel.
 *
 * Usage (repo root):
 *   node scripts/release-extension.mjs
 *   node scripts/release-extension.mjs --bump
 *   node scripts/release-extension.mjs --skip-obfuscate
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const args = new Set(process.argv.slice(2));
const bump = args.has("--bump");
const skipObfuscate = args.has("--skip-obfuscate");

const configPath = join(root, "config", "extension.json");
const srcDir = join(root, "WAchromeExtension");
const distDir = join(root, "WAchromeExtension-dist");
const rootZip = join(root, "WAchromeExtension-dist.zip");
const webDownloadsDir = join(root, "platform", "web", "public", "downloads");
const webZip = join(webDownloadsDir, "iranexpedia-extension.zip");

function log(msg) {
  console.log(`\n==> ${msg}`);
}

function bumpPatch(version) {
  const parts = String(version).split(".").map((n) => Number(n));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Cannot bump version: ${version}`);
  }
  parts[2] += 1;
  return parts.join(".");
}

function runNode(scriptRel, extraArgs = []) {
  const script = join(root, scriptRel);
  const r = spawnSync(process.execPath, [script, ...extraArgs], {
    cwd: root,
    stdio: "inherit",
    env: process.env
  });
  if (r.status !== 0) {
    throw new Error(`${scriptRel} failed with code ${r.status}`);
  }
}

/** Zip a folder so the archive root entry is the folder name. */
function zipFolderAs(folderPath, zipPath, entryName) {
  if (existsSync(zipPath)) rmSync(zipPath);

  const isWin = process.platform === "win32";
  if (isWin) {
    // Stage with the desired entry name, then Compress-Archive that folder
    const stageParent = join(root, "_ext_zip_stage");
    const stageFolder = join(stageParent, entryName);
    rmSync(stageParent, { recursive: true, force: true });
    mkdirSync(stageParent, { recursive: true });
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        [
          `Copy-Item -Path '${folderPath.replace(/'/g, "''")}' -Destination '${stageFolder.replace(/'/g, "''")}' -Recurse -Force;`,
          `Compress-Archive -Path '${stageFolder.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
        ].join(" ")
      ],
      { stdio: "inherit" }
    );
    rmSync(stageParent, { recursive: true, force: true });
  // On Windows we stage; on Unix zip the dist folder by name from repo root
  } else {
    execFileSync("zip", ["-r", zipPath, entryName, "-x", "*.DS_Store", "*__pycache__*", "*.zip"], {
      cwd: root,
      stdio: "inherit"
    });
  }
}

function main() {
  if (!existsSync(configPath)) {
    throw new Error(`Missing ${configPath}`);
  }
  if (!existsSync(srcDir)) {
    throw new Error(`Missing ${srcDir}`);
  }

  let cfg = JSON.parse(readFileSync(configPath, "utf8"));
  if (bump) {
    const next = bumpPatch(cfg.version);
    cfg = { ...cfg, version: next };
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
    log(`Bumped config/extension.json → ${next}`);
  }

  log("Sync version into manifest / panel / API");
  runNode("scripts/sync-extension-version.mjs");

  if (!skipObfuscate) {
    log("Obfuscate extension → WAchromeExtension-dist/");
    runNode("scripts/obfuscate-extension.mjs");
  } else if (!existsSync(distDir)) {
    throw new Error("WAchromeExtension-dist missing; run without --skip-obfuscate");
  }

  const distManifest = join(distDir, "manifest.json");
  if (existsSync(distManifest)) {
    const m = JSON.parse(readFileSync(distManifest, "utf8"));
    m.version = String(cfg.version);
    writeFileSync(distManifest, JSON.stringify(m, null, 2) + "\n");
  }

  log("Pack → WAchromeExtension-dist.zip (repo root)");
  zipFolderAs(distDir, rootZip, "WAchromeExtension-dist");

  log("Copy ZIP → platform/web/public/downloads (panel download)");
  mkdirSync(webDownloadsDir, { recursive: true });
  if (existsSync(webZip)) rmSync(webZip);
  copyFileSync(rootZip, webZip);

  const meta = {
    version: String(cfg.version),
    file: "iranexpedia-extension.zip",
    download_path: "/downloads/iranexpedia-extension.zip",
    root_zip: "WAchromeExtension-dist.zip",
    dist_folder: "WAchromeExtension-dist",
    packed_at: new Date().toISOString(),
    obfuscated: !skipObfuscate
  };
  writeFileSync(join(webDownloadsDir, "extension-meta.json"), JSON.stringify(meta, null, 2) + "\n");
  writeFileSync(
    join(root, "platform", "api", "app", "extension_version.json"),
    JSON.stringify(meta, null, 2) + "\n"
  );

  log(`Done. Extension v${cfg.version}`);
  console.log("  Dist folder: ", distDir);
  console.log("  Root ZIP:    ", rootZip);
  console.log("  Panel ZIP:   ", webZip);
}

try {
  main();
} catch (err) {
  console.error("\nrelease-extension failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
