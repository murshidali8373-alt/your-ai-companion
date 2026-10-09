import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const extDir = path.join(root, "extension");
const publicDir = path.join(root, "public");
const zipDest = path.join(publicDir, "ai-buddy-extension.zip");

console.log("--> Validating AI Buddy extension files...");

// 1. Verify manifest.json
const manifestPath = path.join(extDir, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("Error: extension/manifest.json is missing!");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
if (manifest.manifest_version !== 3) {
  console.error("Error: manifest_version must be 3!");
  process.exit(1);
}

if (!manifest.side_panel || manifest.side_panel.default_path !== "sidepanel.html") {
  console.error("Error: manifest.side_panel.default_path must be configured to sidepanel.html!");
  process.exit(1);
}

const requiredFiles = [
  "manifest.json",
  "background.js",
  "bridge.js",
  "snapshot.js",
  "popup.html",
  "popup.js",
  "sidepanel.html",
  "sidepanel.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

for (const file of requiredFiles) {
  const fullPath = path.join(extDir, file);
  if (!fs.existsSync(fullPath)) {
    console.error(`Error: Required extension file "${file}" is missing from extension/!`);
    process.exit(1);
  }
}

console.log("✓ Manifest and all required files are present.");

// 2. Package into zip archive
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

if (fs.existsSync(zipDest)) {
  fs.unlinkSync(zipDest);
}

console.log("--> Creating zip archive at public/ai-buddy-extension.zip...");
try {
  execFileSync("zip", ["-r", "-q", zipDest, "."], { cwd: extDir });
} catch (e) {
  console.error("Failed to run zip utility:", e);
  process.exit(1);
}

const stat = fs.statSync(zipDest);
if (stat.size < 1000) {
  console.error(`Error: Generated zip is suspiciously small (${stat.size} bytes)!`);
  process.exit(1);
}

console.log(`✓ Extension packaged successfully: ${zipDest} (${stat.size} bytes)`);
