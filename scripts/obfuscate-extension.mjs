/**
 * Build obfuscated extension → WAchromeExtension-dist/
 *
 * IMPORTANT: Service-worker scripts must NEVER use disableConsoleOutput /
 * debugProtection — javascript-obfuscator injects `window` fallbacks that
 * crash MV3 workers (status 15: ReferenceError window is not defined).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JavaScriptObfuscator from "javascript-obfuscator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "WAchromeExtension");
const outDir = path.join(root, "WAchromeExtension-dist");

const RESERVED = [
  "^chrome$",
  "^browser$",
  "^IranexpediaCrm$",
  "^IranexpediaCloudBridge$",
  "^IranexpediaAuthGate$",
  "^IranexpediaLicense$",
  "^self$",
  "^globalThis$"
];

/** Safe for service worker + importScripts (no window references). */
const SW_SAFE_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  numbersToExpressions: false,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: ["base64"],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersChainedCalls: false,
  stringArrayWrappersType: "function",
  stringArrayThreshold: 0.75,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  reservedNames: RESERVED
};

/** Content scripts / popup — may reference window. */
const MEDIUM_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.35,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 6,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.5,
  stringArrayEncoding: ["base64"],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersType: "function",
  stringArrayThreshold: 0.85,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  reservedNames: RESERVED
};

const HARD_OPTIONS = {
  ...MEDIUM_OPTIONS,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.25,
  splitStringsChunkLength: 4,
  stringArrayCallsTransformThreshold: 0.75,
  stringArrayEncoding: ["rc4"],
  stringArrayWrappersCount: 3,
  stringArrayThreshold: 1
};

/** Loaded in service worker via importScripts — MUST be SW-safe. */
const SW_SAFE_FILES = new Set([
  "background.js",
  "cloud-bridge.js",
  "auth-gate.js"
]);

/** Page scripts — harder obfuscation OK. */
const HARD_FILES = new Set([
  "content.js",
  "content-divar.js",
  "popup.js",
  "dashboard.js",
  "crm-panel.js"
]);

function ensureCleanOutDir() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
}

function copyFile(relPath) {
  const from = path.join(srcDir, relPath);
  const to = path.join(outDir, relPath);
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(relPath) {
  const from = path.join(srcDir, relPath);
  const to = path.join(outDir, relPath);
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
}

function profileFor(file) {
  if (SW_SAFE_FILES.has(file)) return "sw";
  if (HARD_FILES.has(file)) return "hard";
  return "medium";
}

function optionsFor(profile) {
  if (profile === "sw") return SW_SAFE_OPTIONS;
  if (profile === "hard") return HARD_OPTIONS;
  return MEDIUM_OPTIONS;
}

function obfuscateJs(relPath, profile) {
  const from = path.join(srcDir, relPath);
  if (!fs.existsSync(from)) {
    console.warn("skip missing:", relPath);
    return;
  }
  const source = fs.readFileSync(from, "utf8");
  const result = JavaScriptObfuscator.obfuscate(source, optionsFor(profile));
  const code = result.getObfuscatedCode();
  // Safety net: never ship SW code that still mentions bare window
  if (profile === "sw" && /\bwindow\b/.test(code)) {
    console.warn(
      "WARN:",
      relPath,
      "still contains 'window' after obfuscation — copying source instead"
    );
    fs.mkdirSync(path.dirname(path.join(outDir, relPath)), { recursive: true });
    fs.writeFileSync(path.join(outDir, relPath), source, "utf8");
    console.log(`copied [sw-fallback]:`, relPath);
    return;
  }
  const to = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, code, "utf8");
  console.log(`obfuscated [${profile}]:`, relPath);
}

function main() {
  if (!fs.existsSync(srcDir)) {
    throw new Error("Missing WAchromeExtension folder");
  }

  ensureCleanOutDir();

  copyFile("manifest.json");
  copyFile("popup.html");
  copyFile("popup.css");
  copyFile("dashboard.html");
  copyFile("dashboard.css");
  copyFile("crm-panel.css");
  if (fs.existsSync(path.join(srcDir, "rules.json"))) {
    copyFile("rules.json");
  }
  copyDir("icons");

  const jsFiles = [
    "background.js",
    "cloud-bridge.js",
    "auth-gate.js",
    "crm-store.js",
    "content.js",
    "content-divar.js",
    "crm-panel.js",
    "popup.js",
    "dashboard.js"
  ];

  for (const file of jsFiles) {
    obfuscateJs(file, profileFor(file));
  }

  console.log("\nDone.");
  console.log("Load unpacked in Chrome:");
  console.log(" ", outDir);
  console.log("\nDev tip: load WAchromeExtension/ (source) to avoid SW obfuscation issues.");
}

main();
