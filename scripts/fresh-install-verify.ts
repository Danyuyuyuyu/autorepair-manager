import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { hashSync } from "bcryptjs";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { BOOTSTRAP_MARKER_KEY, BOOTSTRAP_MARKER_VALUE } from "@/server/bootstrap/first-run";
import { createBackupService } from "@/server/backup/backup-service";
import { migrate } from "@/server/repos/sqlite/migration";
import { SQLITE_BUSINESS_TABLES } from "@/server/repos/sqlite/schema-tables";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "FreshInstall123456";
const TEST_ROOT_PREFIX = "autorepair-fresh-install-";

interface ProbePayload {
  counts: Record<string, number>;
  marker: string | null;
  schemaVersion: number;
  activeAdministrators: number;
  passwordValid: boolean;
  sessionValid: boolean | null;
  integrity: string;
  foreignKeyViolations: number;
}

interface ProbeRun {
  status: number | null;
  stdout: string;
  stderr: string;
  payload: ProbePayload | null;
}

let passed = 0;
function check(label: string, condition: unknown): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function childEnvironment(
  dbPath: string,
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_STORAGE: "sqlite",
    AUTOREPAIR_DB_PATH: dbPath,
    DATABASE_URL: "postgresql://127.0.0.1:1/postgres-is-intentionally-unavailable",
    BOOTSTRAP_ADMIN_USERNAME: ADMIN_USERNAME,
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
    BOOTSTRAP_ADMIN_NAME: "首次安装管理员",
    VERIFY_ADMIN_USERNAME: ADMIN_USERNAME,
    VERIFY_ADMIN_PASSWORD: ADMIN_PASSWORD,
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return env;
}

function runProbe(dbPath: string, overrides: Record<string, string | undefined> = {}): ProbeRun {
  const run = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "scripts/fresh-install-probe.ts"],
    {
      cwd: process.cwd(),
      env: childEnvironment(dbPath, overrides),
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith("FRESH_PROBE_JSON:"));
  return {
    status: run.status,
    stdout,
    stderr,
    payload: line ? (JSON.parse(line.slice("FRESH_PROBE_JSON:".length)) as ProbePayload) : null,
  };
}

function runBusinessProbe(dbPath: string): { status: number | null; output: string } {
  const run = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "scripts/sqlite-auth-probe.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...childEnvironment(dbPath),
        SQLITE_AUTH_PROBE_PREFIX: "FRESH-INSTALL-FIXTURE",
        SQLITE_AUTH_PROBE_USERNAME: ADMIN_USERNAME,
        SQLITE_AUTH_PROBE_PASSWORD: ADMIN_PASSWORD,
      },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  return { status: run.status, output: `${run.stdout ?? ""}\n${run.stderr ?? ""}` };
}

function openMigratedDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function readCounts(path: string): Record<string, number> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Object.fromEntries(
      SQLITE_BUSINESS_TABLES.map((table) => {
        const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as {
          count: number;
        };
        return [table, Number(row.count)];
      }),
    );
  } finally {
    db.close();
  }
}

function passwordHash(path: string, username = ADMIN_USERNAME): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("SELECT password_hash FROM users WHERE username = ?").get(username) as
      { password_hash: string } | undefined;
    assert.ok(row, `管理员 ${username} 应存在`);
    return row.password_hash;
  } finally {
    db.close();
  }
}

function assertCleanBootstrap(payload: ProbePayload | null): asserts payload is ProbePayload {
  assert.ok(payload, "probe 应返回结构化结果");
  check("schema_version 已推进到 v1", payload.schemaVersion === 1);
  check("bootstrap marker 已写入", payload.marker === BOOTSTRAP_MARKER_VALUE);
  check("恰好 1 名启用管理员", payload.activeAdministrators === 1);
  check("管理员 bcrypt 凭据可验证", payload.passwordValid);
  check("integrity_check = ok", payload.integrity === "ok");
  check("foreign_key_check = 0", payload.foreignKeyViolations === 0);
  check(
    "正式 bootstrap 只写 1 个 user + 1 个 app_setting",
    payload.counts.users === 1 && payload.counts.app_settings === 1,
  );
  const unexpected = Object.entries(payload.counts).filter(
    ([table, count]) => table !== "users" && table !== "app_settings" && count !== 0,
  );
  check("未混入 Customer / Vehicle / WorkOrder / Payment 等 fixture", unexpected.length === 0);
}

function checkNoSecretLeak(...outputs: string[]): void {
  const combined = outputs.join("\n");
  check("日志未输出 bootstrap 明文密码", !combined.includes(ADMIN_PASSWORD));
  check("日志未输出 bcrypt hash", !/\$2[aby]\$\d{2}\$/.test(combined));
}

function assertCleanupTarget(testRoot: string): void {
  const resolvedRoot = resolve(testRoot);
  const resolvedTemp = resolve(tmpdir());
  const rel = relative(resolvedTemp, resolvedRoot);
  if (
    rel.startsWith("..") ||
    rel.includes(`..${sep}`) ||
    !resolvedRoot.split(sep).at(-1)?.startsWith(TEST_ROOT_PREFIX)
  ) {
    throw new Error(`拒绝清理非 fresh-install 临时目录：${resolvedRoot}`);
  }
}

function denyDirectoryWrites(path: string): () => void {
  if (platform() !== "win32") {
    chmodSync(path, 0o555);
    return () => chmodSync(path, 0o755);
  }

  const whoami = spawnSync("whoami.exe", [], { encoding: "utf8" });
  assert.equal(whoami.status, 0, "无法取得 Windows 当前用户，不能设置 ACL 探针");
  const principal = whoami.stdout.trim();
  const denied = spawnSync("icacls.exe", [path, "/deny", `${principal}:(OI)(CI)(W)`], {
    encoding: "utf8",
  });
  assert.equal(denied.status, 0, `无法设置拒绝写 ACL：${denied.stderr}`);

  return () => {
    const restored = spawnSync("icacls.exe", [path, "/remove:d", principal], {
      encoding: "utf8",
    });
    assert.equal(restored.status, 0, `无法恢复 ACL：${restored.stderr}`);
  };
}

async function main(): Promise<void> {
  const testRoot = mkdtempSync(join(tmpdir(), TEST_ROOT_PREFIX));
  const outputs: string[] = [];

  try {
    console.log("\n【A/F】全新目录 + 连续启动 3 次");
    const primaryPath = join(testRoot, "primary", "autorepair.db");
    const first = runProbe(primaryPath);
    outputs.push(first.stdout, first.stderr);
    check("无 DB 时首次启动成功", first.status === 0);
    check("SQLite 文件已在指定路径创建", existsSync(primaryPath));
    assertCleanBootstrap(first.payload);
    const firstCounts = readCounts(primaryPath);
    const firstHash = passwordHash(primaryPath);

    const second = runProbe(primaryPath, {
      BOOTSTRAP_ADMIN_USERNAME: undefined,
      BOOTSTRAP_ADMIN_PASSWORD: undefined,
      BOOTSTRAP_ADMIN_NAME: undefined,
    });
    const third = runProbe(primaryPath, {
      BOOTSTRAP_ADMIN_USERNAME: "invalid username with spaces",
      BOOTSTRAP_ADMIN_PASSWORD: "bad",
    });
    outputs.push(second.stdout, second.stderr, third.stdout, third.stderr);
    check("第二次启动无需 bootstrap 环境变量", second.status === 0);
    check("第三次启动忽略无效 bootstrap 环境变量", third.status === 0);
    check(
      "三次启动后所有业务表行数不增长",
      JSON.stringify(readCounts(primaryPath)) === JSON.stringify(firstCounts),
    );
    check("三次启动后管理员密码 hash 未改变", passwordHash(primaryPath) === firstHash);

    console.log("\n【B】空 DB 文件但无 schema");
    const emptyFilePath = join(testRoot, "empty-file", "autorepair.db");
    mkdirSync(dirname(emptyFilePath), { recursive: true });
    writeFileSync(emptyFilePath, "");
    const emptyFile = runProbe(emptyFilePath);
    outputs.push(emptyFile.stdout, emptyFile.stderr);
    check("零字节 DB 文件可安全初始化", emptyFile.status === 0);
    assertCleanBootstrap(emptyFile.payload);

    console.log("\n【C】schema_version 不完整");
    const partialPath = join(testRoot, "partial-migration", "autorepair.db");
    mkdirSync(dirname(partialPath), { recursive: true });
    const partialDb = new DatabaseSync(partialPath);
    partialDb.exec(
      "CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
    );
    partialDb.close();
    const partial = runProbe(partialPath);
    outputs.push(partial.stdout, partial.stderr);
    check("未完成的 migration 可继续执行", partial.status === 0);
    assertCleanBootstrap(partial.payload);

    console.log("\n【D】schema 完整但 bootstrap 未完成");
    const schemaOnlyPath = join(testRoot, "schema-only", "autorepair.db");
    openMigratedDatabase(schemaOnlyPath).close();
    const schemaOnly = runProbe(schemaOnlyPath);
    outputs.push(schemaOnly.stdout, schemaOnly.stderr);
    check("完整空 schema 可补完 bootstrap", schemaOnly.status === 0);
    assertCleanBootstrap(schemaOnly.payload);

    console.log("\n【E】bootstrap 中途失败与重试");
    const rollbackPath = join(testRoot, "rollback", "autorepair.db");
    const failed = runProbe(rollbackPath, {
      NODE_ENV: "test",
      BOOTSTRAP_TEST_FAILURE_POINT: "after-admin",
    });
    outputs.push(failed.stdout, failed.stderr);
    check("管理员创建后注入失败会令启动失败", failed.status !== 0);
    const rolledBackCounts = readCounts(rollbackPath);
    check(
      "失败事务未留下管理员或 marker",
      rolledBackCounts.users === 0 && rolledBackCounts.app_settings === 0,
    );
    const retried = runProbe(rollbackPath, { NODE_ENV: "test" });
    outputs.push(retried.stdout, retried.stderr);
    check("失败后的下一次启动可重试成功", retried.status === 0);
    assertCleanBootstrap(retried.payload);

    console.log("\n【G】已有数据保护");
    const protectedPath = join(testRoot, "protected", "autorepair.db");
    const protectedDb = openMigratedDatabase(protectedPath);
    const now = new Date().toISOString();
    protectedDb
      .prepare(
        "INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("protected-customer", "真实客户", "13900000000", now, now);
    protectedDb.close();
    const protectedRun = runProbe(protectedPath);
    outputs.push(protectedRun.stdout, protectedRun.stderr);
    check("已有业务数据但无管理员时 fail-fast", protectedRun.status !== 0);
    check("错误明确说明自动初始化已阻止", protectedRun.stderr.includes("自动初始化已被阻止"));
    const protectedCounts = readCounts(protectedPath);
    check(
      "保护失败不改业务数据、不创建管理员和 marker",
      protectedCounts.customers === 1 &&
        protectedCounts.users === 0 &&
        protectedCounts.app_settings === 0,
    );

    console.log("\n【兼容】既有库只补 marker，不改管理员");
    const legacyPath = join(testRoot, "legacy", "autorepair.db");
    const legacyDb = openMigratedDatabase(legacyPath);
    const legacyHash = hashSync("LegacyAdmin123456", 10);
    legacyDb
      .prepare(
        `INSERT INTO users
         (id, username, name, password_hash, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ADMIN', 1, ?, ?)`,
      )
      .run("legacy-admin", "legacy-admin", "既有管理员", legacyHash, now, now);
    legacyDb.close();
    const legacy = runProbe(legacyPath, {
      BOOTSTRAP_ADMIN_USERNAME: undefined,
      BOOTSTRAP_ADMIN_PASSWORD: undefined,
      VERIFY_ADMIN_USERNAME: "legacy-admin",
      VERIFY_ADMIN_PASSWORD: "LegacyAdmin123456",
    });
    outputs.push(legacy.stdout, legacy.stderr);
    check("有启用管理员的旧库无需 bootstrap 凭据即可启动", legacy.status === 0);
    check("旧库管理员密码不变", passwordHash(legacyPath, "legacy-admin") === legacyHash);
    check("旧库只新增 READY marker", legacy.payload?.marker === BOOTSTRAP_MARKER_VALUE);

    console.log("\n【配置与状态错误】");
    const missingConfigPath = join(testRoot, "missing-config", "autorepair.db");
    const missingConfig = runProbe(missingConfigPath, {
      BOOTSTRAP_ADMIN_USERNAME: undefined,
      BOOTSTRAP_ADMIN_PASSWORD: undefined,
    });
    outputs.push(missingConfig.stdout, missingConfig.stderr);
    check("空库缺少管理员配置时 fail-fast", missingConfig.status !== 0);
    check("配置错误为可理解中文提示", missingConfig.stderr.includes("管理员配置无效"));
    const missingCounts = readCounts(missingConfigPath);
    check(
      "配置失败未写管理员或 marker",
      missingCounts.users === 0 && missingCounts.app_settings === 0,
    );

    const invalidMarkerPath = join(testRoot, "invalid-marker", "autorepair.db");
    const invalidMarkerDb = openMigratedDatabase(invalidMarkerPath);
    invalidMarkerDb
      .prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run(BOOTSTRAP_MARKER_KEY, "INITIALIZING", now);
    invalidMarkerDb.close();
    const invalidMarker = runProbe(invalidMarkerPath);
    outputs.push(invalidMarker.stdout, invalidMarker.stderr);
    check("未知/半完成 marker 状态 fail-fast", invalidMarker.status !== 0);
    check("marker 异常不会自动创建管理员", readCounts(invalidMarkerPath).users === 0);

    console.log("\n【目录不可用】");
    const blockingFile = join(testRoot, "not-a-directory");
    writeFileSync(blockingFile, "file blocks directory creation");
    const unavailablePath = join(blockingFile, "autorepair.db");
    const unavailable = runProbe(unavailablePath);
    outputs.push(unavailable.stdout, unavailable.stderr);
    check("数据库目录不可用时启动失败", unavailable.status !== 0);
    check("目录错误包含明确中文原因", unavailable.stderr.includes("数据库目录不可写或无法创建"));
    check("不会 fallback 到其他数据库路径", !existsSync(unavailablePath));

    console.log("\n【Windows ACL / 目录存在但不可写】");
    const readOnlyDir = join(testRoot, "read-only-directory");
    mkdirSync(readOnlyDir, { recursive: true });
    const restoreWrites = denyDirectoryWrites(readOnlyDir);
    try {
      const readOnlyPath = join(readOnlyDir, "autorepair.db");
      const readOnly = runProbe(readOnlyPath);
      outputs.push(readOnly.stdout, readOnly.stderr);
      check("目录存在但拒绝写入时启动失败", readOnly.status !== 0);
      check("ACL 错误明确提示确认数据库目录可写", readOnly.stderr.includes("数据库目录可写"));
      check("ACL 失败不会创建 DB 或 fallback", !existsSync(readOnlyPath));
    } finally {
      restoreWrites();
    }

    console.log("\n【登录、业务链、Audit、Backup】");
    const login = runProbe(primaryPath, { VERIFY_CREATE_SESSION: "1" });
    outputs.push(login.stdout, login.stderr);
    check("管理员凭据登录验证成功", login.status === 0 && login.payload?.passwordValid);
    check("SQLite SessionStore 可建立并读取登录会话", login.payload?.sessionValid === true);

    const business = runBusinessProbe(primaryPath);
    outputs.push(business.output);
    check("客户 → 车辆 → 工单 → 收款业务链成功", business.status === 0);
    check("业务链写入 Audit", business.output.includes("SQLite auth/business probe：通过"));
    const afterBusiness = readCounts(primaryPath);
    check(
      "fixture 只在验证阶段写入，不属于 bootstrap",
      (afterBusiness.customers ?? 0) > 0 &&
        (afterBusiness.vehicles ?? 0) > 0 &&
        (afterBusiness.work_orders ?? 0) > 0 &&
        (afterBusiness.payments ?? 0) > 0 &&
        (afterBusiness.audit_logs ?? 0) > 0,
    );

    const backupDir = join(testRoot, "backups");
    const backupService = createBackupService({
      databasePath: primaryPath,
      backupDir,
      retention: 5,
    });
    const backup = await backupService.createBackup("manual");
    const verification = await backupService.verifyBackup(backup.path);
    check("Fresh Install 产生业务数据后可创建备份", existsSync(backup.path));
    check(
      "备份 integrity / FK / schema / table 校验通过",
      verification.ok && verification.integrity === "ok" && verification.foreignKeyViolations === 0,
    );

    console.log("\n【Restore 后不重复 bootstrap】");
    const restoredPath = join(testRoot, "restored", "autorepair.db");
    mkdirSync(dirname(restoredPath), { recursive: true });
    const restoreService = createBackupService({
      databasePath: restoredPath,
      backupDir,
      retention: 5,
    });
    const restoreResult = await restoreService.restoreBackup(backup.path);
    check("使用现有 Restore 流程恢复到无主库目录", restoreResult.verification.ok);
    const restoredBefore = readCounts(restoredPath);
    const restoredHash = passwordHash(restoredPath);
    const restored = runProbe(restoredPath, {
      BOOTSTRAP_ADMIN_USERNAME: "invalid username with spaces",
      BOOTSTRAP_ADMIN_PASSWORD: "bad",
    });
    outputs.push(restored.stdout, restored.stderr);
    check("恢复库可直接启动", restored.status === 0);
    check(
      "恢复后没有重复 bootstrap 数据",
      JSON.stringify(readCounts(restoredPath)) === JSON.stringify(restoredBefore),
    );
    check("恢复后管理员密码未被覆盖", passwordHash(restoredPath) === restoredHash);

    checkNoSecretLeak(...outputs);

    console.log("\n【Fresh Install 初始行数（无 fixture）】");
    console.log(JSON.stringify(firstCounts, null, 2));
    console.log(`\nFresh Install verification：通过 ${passed} 项，失败 0 项`);
  } finally {
    assertCleanupTarget(testRoot);
    rmSync(testRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    "Fresh Install verification 失败：",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
