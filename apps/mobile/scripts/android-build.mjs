import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const mobileDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = resolve(mobileDir, "android");
const gradleWrapper = resolve(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew");

if (!existsSync(gradleWrapper)) {
  console.error("[FAIL] Android Gradle wrapper 不存在，请先运行 pnpm mobile:sync");
  process.exit(1);
}

const result = spawnSync(gradleWrapper, ["assembleDebug"], {
  cwd: androidDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
