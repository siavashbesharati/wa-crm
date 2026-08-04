/**
 * Build obfuscated extension → WAchromeExtension-dist/
 *
 * Sensitive auth / verification paths get HARD obfuscation
 * (control-flow flattening, string encryption, dead code).
 * Other UI scripts get a safer MEDIUM profile that still resists casual reading.
 *
 * Note: Obfuscation raises the bar; it cannot make a client-side Chrome extension
 * impossible to patch. Server OTP remains the authority.
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
  "^IranexpediaLicense$"
];

/** UI / storage helpers — readable enough to stay stable in Chrome MV3 */
const MEDIUM_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.4,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: true,
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
  reservedNames: RESERVED,
  reservedStrings: []
};

/**
 * Auth, bridge, content gating — maximize friction for bypass attempts
 * (patching `connected` / `licenseValid` / token checks).
 */
const HARD_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.85,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.35,
  debugProtection: false,
  disableConsoleOutput: true,
  identifierNamesGenerator: "hexadecimal",
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 4,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.75,
  stringArrayEncoding: ["rc4"],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 3,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: "function",
  stringArrayThreshold: 1,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  reservedNames: RESERVED
};

/** Files where verification / OTP / gating / unlock UI lives — HARD profile */
const HARD_FILES = new Set([
  "cloud-bridge.js",
  "content.js",
  "content-divar.js",
  "background.js",
  "auth-gate.js",
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

function obfuscateJs(relPath, profile) {
  const from = path.join(srcDir, relPath);
  if (!fs.existsSync(from)) {
    console.warn("skip missing:", relPath);
    return;
  }
  const source = fs.readFileSync(from, "utf8");
  const options = profile === "hard" ? HARD_OPTIONS : MEDIUM_OPTIONS;
  const result = JavaScriptObfuscator.obfuscate(source, options);
  const to = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, result.getObfuscatedCode(), "utf8");
  console.log(`obfuscated [${profile}]:`, relPath);
}

function main() {
  if (!fs.existsSync(srcDir)) {
    throw new Error("Missing WAchromeExtension folder");
  }

  ensureCleanOutDir();

  // Non-JS assets only (never ship readable sensitive JS as plain copy)
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
    const profile = HARD_FILES.has(file) ? "hard" : "medium";
    obfuscateJs(file, profile);
  }

  console.log("\nDone.");
  console.log("Load unpacked in Chrome:");
  console.log(" ", outDir);
  console.log("\nSource remains readable in WAchromeExtension/ (dev only).");
  console.log("Ship WAchromeExtension-dist/ to customers.");
}

main();
