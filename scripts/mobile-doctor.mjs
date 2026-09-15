import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, join, resolve } from "node:path";

const root = process.cwd();
const mobileDir = resolve(root, "apps", "mobile");
const isWindows = process.platform === "win32";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";
const requiredJava = 21;
const results = [];

function command(command, args = [], options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: isWindows,
    ...options,
  });
}

function record(scope, label, status, detail) {
  results.push({ scope, label, status, detail });
  const marker = status === "pass" ? "PASS" : status === "blocked" ? "BLOCKED" : "FAIL";
  console.log(`[${marker}] ${label}: ${detail}`);
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
record(
  "code",
  "Node",
  nodeMajor >= 22 ? "pass" : "fail",
  `v${process.versions.node}（Capacitor 8 要求 >=22）`,
);

const pnpm = command(pnpmCommand, ["--version"]);
record(
  "code",
  "pnpm",
  pnpm.status === 0 ? "pass" : "fail",
  pnpm.stdout?.trim() || pnpm.stderr?.trim() || "不可用",
);

const java = command("java", ["-version"]);
const javaText = `${java.stdout ?? ""}${java.stderr ?? ""}`.trim();
const javaMatch = javaText.match(/version\s+"(?:1\.)?(\d+)/i);
const javaMajor = javaMatch ? Number(javaMatch[1]) : 0;
record(
  "native",
  "Java",
  java.status === 0 && javaMajor >= requiredJava ? "pass" : "blocked",
  javaText.split(/\r?\n/)[0] || "未找到 Java",
);

const javaHome = process.env.JAVA_HOME;
record(
  "native",
  "JAVA_HOME",
  javaHome && existsSync(join(javaHome, "bin", isWindows ? "java.exe" : "java"))
    ? "pass"
    : "blocked",
  javaHome || "未设置",
);

const defaultSdk = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : "";
const sdkRoot = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME, defaultSdk].find(
  (candidate) => candidate && existsSync(candidate),
);
record(
  "native",
  "Android SDK",
  sdkRoot ? "pass" : "blocked",
  sdkRoot || "未找到（环境变量与默认目录均为空）",
);

const adbName = isWindows ? "adb.exe" : "adb";
const adbCandidates = [
  sdkRoot ? join(sdkRoot, "platform-tools", adbName) : "",
  ...String(process.env.PATH ?? "")
    .split(delimiter)
    .map((entry) => join(entry, adbName)),
].filter(Boolean);
const adbPath = adbCandidates.find(existsSync);
record("native", "adb", adbPath ? "pass" : "blocked", adbPath || "未找到");

if (adbPath) {
  const devices = command(adbPath, ["devices", "-l"]);
  const deviceLines = String(devices.stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => /\sdevice(?:\s|$)/.test(line));
  record(
    "device",
    "Android device",
    deviceLines.length > 0 ? "pass" : "blocked",
    deviceLines.join("; ") || "无在线设备/模拟器",
  );
} else {
  record("device", "Android device", "blocked", "adb 不可用，无法检测");
}

const mobilePackagePath = join(mobileDir, "package.json");
const mobilePackage = existsSync(mobilePackagePath)
  ? JSON.parse(readFileSync(mobilePackagePath, "utf8"))
  : null;
const capacitorVersion = mobilePackage?.dependencies?.["@capacitor/core"];
record(
  "code",
  "Capacitor",
  capacitorVersion?.startsWith("8.") ? "pass" : "fail",
  capacitorVersion || "未配置",
);
const gradleWrapper = join(mobileDir, "android", isWindows ? "gradlew.bat" : "gradlew");
record(
  "code",
  "Android project",
  existsSync(gradleWrapper) ? "pass" : "fail",
  join(mobileDir, "android"),
);

const build = command(pnpmCommand, ["--dir", mobileDir, "build"], { stdio: "pipe" });
record(
  "code",
  "Mobile web build",
  build.status === 0 ? "pass" : "fail",
  build.status === 0
    ? join(mobileDir, "dist")
    : (build.stderr || build.stdout || "构建失败").trim().slice(-500),
);

const codeFailed = results.some((item) => item.scope === "code" && item.status === "fail");
const nativeBlocked = results.some((item) => item.scope === "native" && item.status !== "pass");
console.log(
  codeFailed
    ? "\nVERDICT: FAIL（代码侧检查失败）"
    : nativeBlocked
      ? "\nVERDICT: CODE READY / NATIVE BLOCKED"
      : "\nVERDICT: CODE + NATIVE TOOLCHAIN READY",
);
process.exit(codeFailed ? 1 : nativeBlocked ? 2 : 0);
