/**
 * Stop API + Web + Workers started by `npm run start:all`.
 *
 * Usage (repo root):
 *   npm run stop:all
 *   node scripts/stop-all.mjs
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const isWin = process.platform === "win32";

function log(msg) {
  console.log(`==> ${msg}`);
}

function run(cmd) {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
  } catch (e) {
    return e.stdout || e.stderr || "";
  }
}

function unique(ids) {
  return [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
}

function killPid(pid) {
  if (isWin) {
    run(`taskkill /F /T /PID ${pid}`);
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

function pidsListeningOn(ports) {
  const found = [];
  if (isWin) {
    const out = run("netstat -ano");
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      for (const port of ports) {
        if (line.includes(`:${port} `) || line.includes(`:${port}\t`)) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (/^\d+$/.test(pid)) found.push(pid);
        }
      }
    }
  } else {
    for (const port of ports) {
      const out = run(`lsof -tiTCP:${port} -sTCP:LISTEN`);
      for (const pid of out.split(/\s+/)) {
        if (/^\d+$/.test(pid)) found.push(pid);
      }
    }
  }
  return unique(found);
}

function pidsByCommandMatch(patterns) {
  const found = [];
  if (isWin) {
    // Prefer PowerShell — reliable CommandLine match for this repo's processes
    const ps = patterns
      .map((p) => p.replace(/'/g, "''"))
      .map((p) => `$_.CommandLine -match '${p}'`)
      .join(" -or ");
    const script = [
      "Get-CimInstance Win32_Process |",
      `Where-Object { $_.CommandLine -and (${ps}) } |`,
      "Select-Object -ExpandProperty ProcessId"
    ].join(" ");
    const out = run(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`);
    for (const line of out.split(/\r?\n/)) {
      const pid = line.trim();
      if (/^\d+$/.test(pid)) found.push(pid);
    }
  } else {
    const out = run("ps -ax -o pid= -o command=");
    for (const line of out.split(/\n/)) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const [, pid, cmd] = m;
      if (patterns.some((p) => new RegExp(p, "i").test(cmd))) found.push(pid);
    }
  }
  return unique(found);
}

function main() {
  log(`Stopping platform processes (root: ${root})`);

  const patterns = [
    "start-all\\.mjs",
    "uvicorn app\\.main:app",
    "app\\.workers\\.runner",
    "platform[/\\\\]web[/\\\\]node_modules[/\\\\].*[/\\\\]next",
    "next dist[/\\\\]bin[/\\\\]next",
    "next[/\\\\]dist[/\\\\]server[/\\\\]lib[/\\\\]start-server"
  ];

  const byCmd = pidsByCommandMatch(patterns);
  const byPort = pidsListeningOn([8000, 3000]);
  const all = unique([...byCmd, ...byPort]).filter((pid) => pid !== process.pid);

  if (!all.length) {
    log("Nothing to stop (no matching processes / ports 8000 & 3000 free).");
    return;
  }

  log(`Killing PIDs: ${all.join(", ")}`);
  for (const pid of all) {
    killPid(pid);
  }

  // Second pass for orphans that rebind briefly
  const left = unique([...pidsByCommandMatch(patterns), ...pidsListeningOn([8000, 3000])]).filter(
    (pid) => pid !== process.pid
  );
  for (const pid of left) {
    killPid(pid);
  }

  const stillPorts = pidsListeningOn([8000, 3000]);
  if (stillPorts.length) {
    console.error(`Some listeners remain on 8000/3000: ${stillPorts.join(", ")}`);
    process.exitCode = 1;
  } else {
    log("Stopped. Ports 8000 and 3000 are free.");
  }
}

main();
