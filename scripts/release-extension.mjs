/**
 * Bump / sync / obfuscate / pack the Chrome extension into the web downloads folder.
 *
 * Reads version from config/extension.json (single source of truth).
 * Writes obfuscated build to WAchromeExtension-dist/, then zips it to
 * platform/web/public/downloads/iranexpedia-extension.zip (replaces previous).
 *
 * Usage (repo root):
 *   node scripts/release-extension.mjs
 *   node scripts/release-extension.mjs --bump        # bump patch (7.3.1 → 7.3.2)
 *   node scripts/release-extension.mjs --skip-obfuscate
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const outDir = join(root, "platform", "web", "public", "downloads");
const outZip = join(outDir, "iranexpedia-extension.zip");
const packFolderName = "iranexpedia-extension";

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

function zipFolder(folderPath, zipPath) {
  mkdirSync(dirname(zipPath), { recursive: true });
  if (existsSync(zipPath)) rmSync(zipPath);

  const isWin = process.platform === "win32";
  if (isWin) {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${folderPath.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
      ],
      { stdio: "inherit" }
    );
  } else {
    execFileSync(
      "zip",
      ["-r", zipPath, packFolderName, "-x", "*.DS_Store", "*__pycache__*"],
      { cwd: dirname(folderPath), stdio: "inherit" }
    );
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

  // Ensure dist manifest has the synced version (obfuscate copies after sync)
  const distManifest = join(distDir, "manifest.json");
  if (existsSync(distManifest)) {
    const m = JSON.parse(readFileSync(distManifest, "utf8"));
    m.version = String(cfg.version);
    writeFileSync(distManifest, JSON.stringify(m, null, 2) + "\n");
  }

  log("Pack obfuscated build into downloads (replace old ZIP)");
  mkdirSync(outDir, { recursive: true });

  // Stage as iranexpedia-extension/ so unzip is clean for Load unpacked
  const stageParent = join(outDir, "_stage");
  const stageFolder = join(stageParent, packFolderName);
  rmSync(stageParent, { recursive: true, force: true });
  mkdirSync(stageParent, { recursive: true });

  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Copy-Item -Path '${distDir.replace(/'/g, "''")}' -Destination '${stageFolder.replace(/'/g, "''")}' -Recurse -Force`
      ],
      { stdio: "inherit" }
    );
  } else {
    execFileSync("cp", ["-R", distDir, stageFolder], { stdio: "inherit" });
  }

  zipFolder(stageFolder, outZip);
  rmSync(stageParent, { recursive: true, force: true });

  const meta = {
    version: String(cfg.version),
    file: "iranexpedia-extension.zip",
    download_path: "/downloads/iranexpedia-extension.zip",
    packed_at: new Date().toISOString(),
    obfuscated: !skipObfuscate
  };
  writeFileSync(join(outDir, "extension-meta.json"), JSON.stringify(meta, null, 2) + "\n");
  writeFileSync(
    join(root, "platform", "api", "app", "extension_version.json"),
    JSON.stringify(meta, null, 2) + "\n"
  );

  log(`Done. Extension v${cfg.version}`);
  console.log("  Dist:     ", distDir);
  console.log("  Download: ", outZip);
  console.log("  Meta:     ", join(outDir, "extension-meta.json"));
}

try {
  main();
} catch (err) {
  console.error("\nrelease-extension failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
