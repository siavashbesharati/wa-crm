/**
 * Start API + Web + Workers + WA/Divar/Bale connectors.
 *
 * Usage (repo root):
 *   node scripts/start-all.mjs
 *   node scripts/start-all.mjs --no-workers
 *   node scripts/start-all.mjs --no-wa
 *   node scripts/start-all.mjs --no-divar
 *   node scripts/start-all.mjs --no-bale
 *   node scripts/start-all.mjs --seed
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const args = new Set(process.argv.slice(2));

const noWorkers = args.has("--no-workers");
const noWa = args.has("--no-wa");
const noDivar = args.has("--no-divar");
const noBale = args.has("--no-bale");
const seed = args.has("--seed");

const apiDir = join(root, "platform", "api");
const webDir = join(root, "platform", "web");
const waDir = join(root, "platform", "wa-connector");
const divarDir = join(root, "platform", "divar-connector");
const baleDir = join(root, "platform", "bale-connector");
const children = [];

function log(msg) {
  console.log(`\n==> ${msg}`);
}

function runSync(command, cmdArgs, cwd, { shell = false } = {}) {
  const r = spawnSync(command, cmdArgs, {
    cwd,
    stdio: "inherit",
    shell,
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
      FORCE_COLOR: process.env.FORCE_COLOR || "1",
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8"
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
  if (!existsSync(join(webDir, "node_modules"))) {
    log("Install web dependencies");
    runSync("npm", ["install"], webDir, { shell: true });
  }

  if (seed) {
    log("Migrate + seed API database");
    runSync("python", ["scripts/migrate_multichannel.py"], apiDir, { shell: true });
    runSync("python", ["scripts/migrate_baileys.py"], apiDir, { shell: true });
    runSync("python", ["scripts/migrate_divar.py"], apiDir, { shell: true });
    runSync("python", ["scripts/migrate_bale.py"], apiDir, { shell: true });
    runSync("python", ["scripts/seed_demo.py"], apiDir, { shell: true });
  } else {
    log("Ensure connector schema");
    try {
      runSync("python", ["scripts/migrate_baileys.py"], apiDir, { shell: true });
    } catch {
      console.warn("migrate_baileys skipped/failed");
    }
    try {
      runSync("python", ["scripts/migrate_divar.py"], apiDir, { shell: true });
    } catch {
      console.warn("migrate_divar skipped/failed");
    }
    try {
      runSync("python", ["scripts/migrate_bale.py"], apiDir, { shell: true });
    } catch {
      console.warn("migrate_bale skipped/failed");
    }
  }

  if (!noWa) {
    if (!existsSync(join(waDir, "node_modules"))) {
      log("Install wa-connector dependencies");
      runSync("npm", ["install"], waDir, { shell: true });
    }
  }

  if (!noDivar) {
    log("Ensure divar-connector deps");
    try {
      runSync("python", ["-m", "pip", "install", "-q", "-r", "requirements.txt"], divarDir, {
        shell: true
      });
    } catch {
      console.warn("divar-connector pip install skipped/failed");
    }
  }

  if (!noBale) {
    log("Ensure bale-connector deps");
    try {
      runSync("python", ["-m", "pip", "install", "-q", "-r", "requirements.txt"], baleDir, {
        shell: true
      });
    } catch {
      console.warn("bale-connector pip install skipped/failed");
    }
  }

  start("api", "python", ["-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"], apiDir);
  start("web", "npm", ["run", "dev"], webDir);
  if (!noWorkers) {
    start("workers", "python", ["-m", "app.workers.runner"], apiDir);
  }
  if (!noWa) {
    start("wa-connector", "npm", ["run", "dev"], waDir);
  }
  if (!noDivar) {
    start("divar-connector", "python", ["main.py"], divarDir);
  }
  if (!noBale) {
    start("bale-connector", "python", ["main.py"], baleDir);
  }

  console.log(`
--------------------------------------------------
 Platform running
  API:        http://localhost:8000/api/health
  Business:   http://localhost:3000/login
  Super:      http://localhost:3000/super/login
  WA conn:    http://127.0.0.1:8090/health${noWa ? " (skipped)" : ""}
  Divar conn: http://127.0.0.1:8091/health${noDivar ? " (skipped)" : ""}
  Bale conn:  http://127.0.0.1:8092/health${noBale ? " (skipped)" : ""}
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
