import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, join, resolve } from "node:path";

const root = process.cwd();
const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";
const appId = "com.autorepair.manager";
const contractDatabaseFiles = [
  "autorepair-mobile-customer-contractSQLite.db",
  "autorepair-mobile-customer-contractSQLite.db-wal",
  "autorepair-mobile-customer-contractSQLite.db-shm",
  "autorepair-mobile-customer-contractSQLite.db-journal",
];

const sdkRoot = [
  process.env.ANDROID_SDK_ROOT,
  process.env.ANDROID_HOME,
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : "",
].find((candidate) => candidate && existsSync(candidate));
const adbName = isWindows ? "adb.exe" : "adb";
const adb = [
  sdkRoot ? join(sdkRoot, "platform-tools", adbName) : "",
  ...String(process.env.PATH ?? "")
    .split(delimiter)
    .map((entry) => join(entry, adbName)),
].find((candidate) => candidate && existsSync(candidate));

if (!adb) fail("adb / Android SDK 不可用");

const pc = run(pnpm, ["customer:contract"], {
  env: { ...process.env, CONTRACT_BACKEND: "sqlite" },
  encoding: "utf8",
});
if (pc.status !== 0) fail(pc.stderr || pc.stdout || "PC SQLite Customer contract 失败");
process.stdout.write(pc.stdout);
const pcSnapshotMatch = pc.stdout.match(
  /\[customer-contract-snapshot\] backend=SQLite snapshot=(\{.*\})/,
);
if (!pcSnapshotMatch) fail("未捕获 PC SQLite Customer 语义快照");
const pcSnapshot = JSON.parse(pcSnapshotMatch[1]);

const build = run(pnpm, ["mobile:android:build"], {
  env: { ...process.env, VITE_MOBILE_CUSTOMER_CONTRACT: "1" },
  stdio: "inherit",
});
if (build.status !== 0) fail("Android Customer contract APK 构建失败");

const devices = adbRun(["devices", "-l"]);
const deviceLines = devices.stdout.split(/\r?\n/).filter((line) => /\sdevice(?:\s|$)/.test(line));
if (deviceLines.length === 0) fail("adb 可用，但没有在线真机或模拟器");
const serial = deviceLines[0].split(/\s+/)[0];
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
if (!existsSync(apk)) fail(`APK 不存在：${apk}`);

const install = adbRun(["-s", serial, "install", "-r", apk]);
if (install.status !== 0) fail(install.stderr || install.stdout || "APK 安装失败");
for (const file of contractDatabaseFiles) {
  adbRun(["-s", serial, "shell", "run-as", appId, "rm", "-f", `databases/${file}`]);
}

const first = launchAndRead(serial);
assert.equal(first.priorRunPersisted, false, "清库后的首次运行不应命中跨进程持久化标记");
console.log(
  `[PASS] Android Native Customer contract: ${first.passed}/${first.total} on ${deviceLines[0]}`,
);
console.log(
  `[PASS] Mobile schema/bootstrap: version=${first.schemaVersion} tables=${first.tables} ` +
    `indexes=${first.indexes} formalDb=${first.formalDb} counts=${JSON.stringify(first.bootstrapCounts)}`,
);

const second = launchAndRead(serial);
assert.equal(second.priorRunPersisted, true, "force-stop/reopen 后 Customer 持久化标记不存在");
assert.deepEqual(second.snapshot, first.snapshot, "两轮 Android Customer contract 快照不一致");
assert.deepEqual(first.snapshot, pcSnapshot, "PC SQLite 与 Android Native SQLite 快照不一致");
console.log("[PASS] Customer transaction: commit=true rollback=true migrationRollback=true");
console.log("[PASS] Customer close/reopen + force-stop/reopen persistence=true");
console.log("[PASS] PC SQLite / Android Native SQLite Customer 语义快照完全一致");

const dbList = adbRun(["-s", serial, "shell", "run-as", appId, "ls", "databases"]);
assert.equal(
  contractDatabaseFiles.some((file) => dbList.stdout.includes(file)),
  false,
  "contract 测试库执行后未清理",
);
assert.equal(dbList.stdout.includes("autorepairSQLite.db"), true, "正式 Mobile 数据库文件不存在");
console.log("[PASS] Contract DB 已清理；正式 DB 与 probe DB 保持隔离");

function launchAndRead(serial) {
  adbRun(["-s", serial, "logcat", "-c"]);
  adbRun(["-s", serial, "shell", "am", "force-stop", appId]);
  const launch = adbRun(["-s", serial, "shell", "monkey", "-p", appId, "1"]);
  if (launch.status !== 0) fail(launch.stderr || launch.stdout || "App 启动失败");

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const logs = adbRun(["-s", serial, "logcat", "-d", "-v", "brief"]).stdout;
    const failLine = logs.match(/\[mobile:customer-contract\] FAIL ([^\r\n]+)/);
    if (failLine) fail(`Android Customer contract 失败：${failLine[1]}`);
    const marker = logs.match(/\[mobile:customer-contract\] 37\/37 [^\r\n]+/);
    if (marker) return parseMarker(marker[0]);
    pause(500);
  }
  fail("45 秒内未捕获 Android Customer contract 完成日志");
}

function parseMarker(line) {
  const value = (name) => line.match(new RegExp(`${name}=([^\\s]+)`))?.[1];
  const parsed = {
    passed: 37,
    total: 37,
    platform: value("platform"),
    native: value("native") === "true",
    schemaVersion: Number(value("schemaVersion")),
    tables: Number(value("tables")),
    indexes: Number(value("indexes")),
    formalDb: value("formalDb"),
    bootstrap: value("bootstrap"),
    bootstrapCounts: JSON.parse(decodeURIComponent(value("bootstrapCounts"))),
    commit: value("commit") === "true",
    rollback: value("rollback") === "true",
    migrationRollback: value("migrationRollback") === "true",
    closeReopen: value("closeReopen") === "true",
    priorRunPersisted: value("priorRunPersisted") === "true",
    snapshot: JSON.parse(decodeURIComponent(value("snapshot"))),
  };
  assert.equal(parsed.platform, "android");
  assert.equal(parsed.native, true);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.tables, 19);
  assert.equal(parsed.indexes, 48);
  assert.equal(parsed.formalDb, "autorepairSQLite.db");
  assert.deepEqual(parsed.bootstrapCounts, {
    customers: 0,
    vehicles: 0,
    workOrders: 0,
    payments: 0,
    expenses: 0,
  });
  assert.equal(parsed.commit, true);
  assert.equal(parsed.rollback, true);
  assert.equal(parsed.migrationRollback, true);
  assert.equal(parsed.closeReopen, true);
  return parsed;
}

function adbRun(args) {
  return run(adb, args, { encoding: "utf8" });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, shell: isWindows, ...options });
}

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function fail(message) {
  console.error(`[FAIL] ${String(message).trim()}`);
  process.exit(1);
}
