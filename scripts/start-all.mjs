/**
 * Build/release the extension, then start API + Web + Workers together.
 *
 * Usage (repo root):
 *   node scripts/start-all.mjs
 *   node scripts/start-all.mjs --bump          # bump extension patch before release
 *   node scripts/start-all.mjs --skip-ext      # only start apps
 *   node scripts/start-all.mjs --no-workers
 *   node scripts/start-all.mjs --seed          # run migrate + seed before API
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const args = new Set(process.argv.slice(2));

const skipExt = args.has("--skip-ext");
const bump = args.has("--bump");
const noWorkers = args.has("--no-workers");
const seed = args.has("--seed");

const apiDir = join(root, "platform", "api");
const webDir = join(root, "platform", "web");
const children = [];

function log(msg) {
  console.log(`\n==> ${msg}`);
}

function runSync(command, cmdArgs, cwd) {
  const r = spawnSync(command, cmdArgs, {
    cwd,
    stdio: "inherit",
    shell: true,
    env: process.env
  });
  if (r.status !== 0) {
    throw new Error(`${command} ${cmdArgs.join(" ")} failed (${r.status})`);
  }
}

function start(name, command, cmdArgs, cwd) {
  log(`Start ${name}`);
  const child = spawn(command, cmdArgs, {
    cwd,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR || "1"
    }
  });
  child.on("exit", (code, signal) => {
    console.log(`\n[${name}] exited code=${code} signal=${signal || ""}`);
  });
  children.push({ name, child });
  return child;
}

function shutdown() {
  for (const { name, child } of children) {
    try {
      if (!child.killed) {
        console.log(`Stopping ${name}…`);
        child.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  if (!skipExt) {
    log("Release extension (sync version → obfuscate → pack downloads ZIP)");
    const releaseArgs = ["scripts/release-extension.mjs"];
    if (bump) releaseArgs.push("--bump");
    runSync(process.execPath, releaseArgs, root);
  } else {
    log("Skipping extension release (--skip-ext)");
  }

  if (!existsSync(join(webDir, "node_modules"))) {
    log("Install web dependencies");
    runSync("npm", ["install"], webDir);
  }

  if (seed) {
    log("Migrate + seed API database");
    runSync("python", ["scripts/migrate_multichannel.py"], apiDir);
    runSync("python", ["scripts/seed_demo.py"], apiDir);
  }

  start("api", "python", ["-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"], apiDir);
  start("web", "npm", ["run", "dev"], webDir);
  if (!noWorkers) {
    start("workers", "python", ["-m", "app.workers.runner"], apiDir);
  }

  let version = "?";
  try {
    version = JSON.parse(readFileSync(join(root, "config", "extension.json"), "utf8")).version;
  } catch {
    /* ignore */
  }

  console.log(`
--------------------------------------------------
 Platform running
  API:      http://localhost:8000/api/health
  Business: http://localhost:3000/login
  Super:    http://localhost:3000/super/login
  Ext ZIP:  platform/web/public/downloads/iranexpedia-extension.zip
  Ext ver:  v${version}
 Press Ctrl+C to stop all
--------------------------------------------------
`);

  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch((err) => {
  console.error("\nstart-all failed:", err instanceof Error ? err.message : err);
  shutdown();
  process.exit(1);
});
