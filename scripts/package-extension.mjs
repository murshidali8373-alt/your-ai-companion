import { execSync } from "child_process";

try {
  execSync("python3 scripts/pack.py", { stdio: "inherit" });
} catch (err) {
  console.error("Packaging failed:", err.message);
  process.exit(1);
}
