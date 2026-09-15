import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, join, resolve } from "node:path";

const root = process.cwd();
const sourcePath = resolve(root, "apps", "mobile", "src", "native", "sqlite-probe.ts");
const source = readFileSync(sourcePath, "utf8");
const assertions = [
  ["独立 probe DB", '"autorepair-mobile-probe"'],
  ["Android native bridge assertion", 'Capacitor.getPlatform() === "android"'],
  ["create table", "CREATE TABLE IF NOT EXISTS probe_records"],
  ["parameter binding", "VALUES (?, ?, ?, ?)"],
  ["insert", "INSERT OR REPLACE INTO probe_records"],
  ["select", "SELECT * FROM probe_records"],
  ["update", "UPDATE probe_records SET"],
  ["delete", "DELETE FROM probe_records"],
  ["begin transaction", "beginTransaction()"],
  ["commit", "commitTransaction()"],
  ["rollback", "rollbackTransaction()"],
  ["close", "db.close()"],
  ["reopen", "db = await connect(sqlite)"],
  ["Unicode", "张三｜粤A12345｜更换机油"],
  ["ISO string", "2026-09-15T08:09:10.123Z"],
  ["Decimal 0.01", '"0.01"'],
  ["Decimal 1.10", '"1.10"'],
  ["Decimal 99999999.99", '"99999999.99"'],
];

let passed = 0;
for (const [name, needle] of assertions) {
  const ok = source.includes(needle);
  console.log(`${ok ? "[PASS]" : "[FAIL]"} contract: ${name}`);
  if (ok) passed += 1;
}
console.log(`SQLite probe source contract: ${passed}/${assertions.length}`);
if (passed !== assertions.length) process.exit(1);

const sdkRoot = [
  process.env.ANDROID_SDK_ROOT,
  process.env.ANDROID_HOME,
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : "",
].find((candidate) => candidate && existsSync(candidate));
const adbName = process.platform === "win32" ? "adb.exe" : "adb";
const adb = [
  sdkRoot ? join(sdkRoot, "platform-tools", adbName) : "",
  ...String(process.env.PATH ?? "")
    .split(delimiter)
    .map((entry) => join(entry, adbName)),
].find((candidate) => candidate && existsSync(candidate));

if (!adb) {
  console.error(
    "[BLOCKED] Native SQLite execution: adb / Android SDK 不可用；以上 18/18 仅为源码契约，不是原生运行结果。",
  );
  process.exit(2);
}

const run = (args) => spawnSync(adb, args, { cwd: root, encoding: "utf8" });
const pause = (milliseconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
const deviceLines = run(["devices", "-l"])
  .stdout.split(/\r?\n/)
  .filter((line) => /\sdevice(?:\s|$)/.test(line));
if (deviceLines.length === 0) {
  console.error("[BLOCKED] Native SQLite execution: adb 可用，但没有在线真机或模拟器。");
  process.exit(2);
}

const apk = resolve(
  root,
  "apps",
  "mobile",
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);
if (!existsSync(apk)) {
  console.error(
    `[BLOCKED] Native SQLite execution: APK 不存在，请先运行 pnpm mobile:android:build（${apk}）`,
  );
  process.exit(2);
}

const install = run(["install", "-r", apk]);
if (install.status !== 0) {
  console.error(install.stderr || install.stdout);
  process.exit(1);
}
function launchAndWaitForProbe({ requirePriorRun }) {
  run(["logcat", "-c"]);
  run(["shell", "am", "force-stop", "com.autorepair.manager"]);
  run(["shell", "monkey", "-p", "com.autorepair.manager", "1"]);

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const logs = run(["logcat", "-d", "-v", "brief"]).stdout;
    const match = logs.match(
      /\[mobile:sqlite-probe\]\s+(\d+)\/(\d+)\s+platform=(\S+)\s+native=(\S+)\s+priorRunPersisted=(\S+)/,
    );
    if (match) {
      const [, passedRuntime, totalRuntime, platform, native, priorRunPersisted] = match;
      const runtimePassed = passedRuntime === "18" && totalRuntime === "18";
      const bridgePassed = platform === "android" && native === "true";
      const persistencePassed = !requirePriorRun || priorRunPersisted === "true";
      if (runtimePassed && bridgePassed && persistencePassed) {
        return { passedRuntime, totalRuntime, platform, native, priorRunPersisted };
      }
      console.error(
        `[FAIL] Native SQLite evidence mismatch: ${match[0]} requirePriorRun=${requirePriorRun}`,
      );
      process.exit(1);
    }
    pause(500);
  }

  console.error("[FAIL] Native SQLite execution: 30 秒内未捕获完整原生探针日志。");
  process.exit(1);
}

const firstRun = launchAndWaitForProbe({ requirePriorRun: false });
console.log(
  `[PASS] Native SQLite execution: ${firstRun.passedRuntime}/${firstRun.totalRuntime} platform=${firstRun.platform} native=${firstRun.native} on ${deviceLines[0]}`,
);
const secondRun = launchAndWaitForProbe({ requirePriorRun: true });
console.log(
  `[PASS] force-stop/reopen persistence: priorRunPersisted=${secondRun.priorRunPersisted}`,
);
