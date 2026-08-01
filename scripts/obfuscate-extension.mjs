import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JavaScriptObfuscator from "javascript-obfuscator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "WAchromeExtension");
const outDir = path.join(root, "WAchromeExtension-dist");

const SAFE_OPTIONS = {
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
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.75,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  // Keep Chrome extension APIs usable
  reservedNames: ["^chrome$", "^browser$"]
};

function ensureCleanOutDir() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
}

function copyFile(relPath) {
  const from = path.join(srcDir, relPath);
  const to = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(relPath) {
  const from = path.join(srcDir, relPath);
  const to = path.join(outDir, relPath);
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
}

function obfuscateJs(relPath) {
  const from = path.join(srcDir, relPath);
  const source = fs.readFileSync(from, "utf8");
  const result = JavaScriptObfuscator.obfuscate(source, SAFE_OPTIONS);
  const to = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, result.getObfuscatedCode(), "utf8");
  console.log("obfuscated:", relPath);
}

function main() {
  if (!fs.existsSync(srcDir)) {
    throw new Error("Missing WAchromeExtension folder");
  }

  ensureCleanOutDir();

  // Plain assets (do not obfuscate)
  copyFile("manifest.json");
  copyFile("popup.html");
  copyFile("popup.css");
  copyFile("dashboard.html");
  copyFile("dashboard.css");
  copyFile("crm-panel.css");
  copyFile("background.js");
  if (fs.existsSync(path.join(srcDir, "rules.json"))) {
    copyFile("rules.json");
  }
  copyDir("icons");

  // JS to protect
  obfuscateJs("license-config.js");
  obfuscateJs("license-lib.js");
  obfuscateJs("crm-store.js");
  obfuscateJs("content.js");
  obfuscateJs("crm-panel.js");
  obfuscateJs("popup.js");
  obfuscateJs("dashboard.js");

  console.log("\nDone.");
  console.log("Load this folder in Chrome (Load unpacked):");
  console.log(" ", outDir);
  console.log("\nSource stays readable in WAchromeExtension/");
}

main();
