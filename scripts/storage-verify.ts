/**
 * 阶段 2 · Step 3 验证：context 双存储装配
 * ---------------------------------------------------------------------------
 * 运行：pnpm storage:verify
 *
 * 四种场景各自派生独立子进程（context 是模块级单例，不能在同一进程内切换）：
 *   1. APP_STORAGE 未设置   → PostgreSQL（既有默认行为）
 *   2. APP_STORAGE=postgres → PostgreSQL
 *   3. APP_STORAGE=sqlite   → SQLite 初始化 + 全部业务仓储真实实现
 *   4. APP_STORAGE=invalid  → 启动明确失败，不静默 fallback
 *
 * 不只查环境变量字符串：用 storageBrandOf() 确认真正装配的实现
 * （prisma 适配器 vs node:sqlite），SQLite 场景再实测 PRAGMA / migration / 全部槽位。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` —— ${detail}` : ""}`);
  }
}

interface ProbeResult {
  scenario: string;
  kind?: string;
  engine?: string;
  brand?: string;
  dbPath?: string | null;
  dbFileExists?: boolean;
  tables?: number;
  schemaVersion?: number;
  wal?: string;
  foreignKeys?: number;
  busyTimeout?: number;
  workOrderReady?: boolean;
  workOrderItemReady?: boolean;
  customerReady?: boolean;
  vehicleReady?: boolean;
  partReady?: boolean;
  inventoryReady?: boolean;
  financeReady?: boolean;
  catalogReady?: boolean;
  userReady?: boolean;
  auditReady?: boolean;
  sessionStoreReady?: boolean;
  latestOrderNo?: string | null;
  placeholderCount?: number;
  placeholderErrors?: Record<string, string>;
  txError?: string;
}

function spawnProbe(
  scenario: string,
  env: Record<string, string | undefined>,
): {
  status: number | null;
  stdout: string;
  stderr: string;
  json: ProbeResult | null;
} {
  const run = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "scripts/storage-verify-probe.ts"],
    {
      env: { ...process.env, ...env, SCENARIO: scenario },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  const stdout = run.stdout ?? "";
  const jsonLine = stdout.split("\n").find((line) => line.startsWith("PROBE_JSON:"));
  return {
    status: run.status,
    stdout,
    stderr: run.stderr ?? "",
    json: jsonLine ? (JSON.parse(jsonLine.slice("PROBE_JSON:".length)) as ProbeResult) : null,
  };
}

function verifyPostgresScenario(title: string, env: Record<string, string | undefined>) {
  console.log(`\n【${title}】`);
  const run = spawnProbe(title.includes("未设置") ? "unset" : "postgres", env);
  check("进程正常退出", run.status === 0, `exit ${run.status} ${run.stderr.slice(0, 200)}`);
  check("kind = postgres", run.json?.kind === "postgres", String(run.json?.kind));
  check(
    "装配的是 Prisma 适配器（非环境变量字符串，是真实实现标记）",
    run.json?.brand === "prisma-postgresql" && run.json?.engine === "prisma-postgresql",
    String(run.json?.brand),
  );
  check(
    "Prisma work-order / work-order-item 槽位已装配",
    run.json?.workOrderReady === true && run.json?.workOrderItemReady === true,
  );
  check("启动日志声明 PostgreSQL", run.stdout.includes("[storage] Storage: PostgreSQL"));
  return run;
}

function main() {
  console.log("Step 3 验证：context 双存储装配\n");

  // ---- 1. 默认模式：APP_STORAGE 未设置 ----
  const unsetEnv = { ...process.env } as Record<string, string | undefined>;
  delete unsetEnv.APP_STORAGE;
  verifyPostgresScenario("1. APP_STORAGE 未设置 → PostgreSQL（默认行为不变）", unsetEnv);

  // ---- 2. 显式 postgres ----
  verifyPostgresScenario("2. APP_STORAGE=postgres → PostgreSQL", { APP_STORAGE: "postgres" });

  // ---- 3. sqlite：临时库 + 初始化 + 全部业务仓储真实实现 ----
  console.log("\n【3. APP_STORAGE=sqlite → SQLite 初始化 + 已完成仓储真实实现】");
  const tempDir = mkdtempSync(join(tmpdir(), "autorepair-storage-"));
  const sqliteRun = spawnProbe("sqlite", {
    APP_STORAGE: "sqlite",
    AUTOREPAIR_DB_PATH: join(tempDir, "autorepair.db"),
  });
  check(
    "进程正常退出",
    sqliteRun.status === 0,
    `exit ${sqliteRun.status} ${sqliteRun.stderr.slice(0, 300)}`,
  );
  check("kind = sqlite", sqliteRun.json?.kind === "sqlite", String(sqliteRun.json?.kind));
  check(
    "装配的是 SQLite 实现（真实实现标记）",
    sqliteRun.json?.brand === "sqlite" && sqliteRun.json?.engine === "node-sqlite",
    String(sqliteRun.json?.brand),
  );
  check("数据库文件已创建", sqliteRun.json?.dbFileExists === true, String(sqliteRun.json?.dbPath));
  check(
    "18 张业务表 + schema_version = 19",
    sqliteRun.json?.tables === 19,
    String(sqliteRun.json?.tables),
  );
  check(
    "schema_version = 1（migration 已执行）",
    sqliteRun.json?.schemaVersion === 1,
    String(sqliteRun.json?.schemaVersion),
  );
  check("journal_mode = wal", sqliteRun.json?.wal === "wal", String(sqliteRun.json?.wal));
  check("foreign_keys = 1", sqliteRun.json?.foreignKeys === 1, String(sqliteRun.json?.foreignKeys));
  check(
    "busy_timeout = 5000",
    sqliteRun.json?.busyTimeout === 5000,
    String(sqliteRun.json?.busyTimeout),
  );
  check(
    "10 个业务 Repository + SessionStore 使用 SQLite 真实实现",
    sqliteRun.json?.workOrderReady === true &&
      sqliteRun.json?.workOrderItemReady === true &&
      sqliteRun.json?.customerReady === true &&
      sqliteRun.json?.vehicleReady === true &&
      sqliteRun.json?.partReady === true &&
      sqliteRun.json?.financeReady === true &&
      sqliteRun.json?.inventoryReady === true &&
      sqliteRun.json?.catalogReady === true &&
      sqliteRun.json?.userReady === true &&
      sqliteRun.json?.auditReady === true &&
      sqliteRun.json?.sessionStoreReady === true &&
      sqliteRun.json?.latestOrderNo === null,
  );
  const placeholderErrors = sqliteRun.json?.placeholderErrors ?? {};
  check(
    "SQLite 不存在业务仓储占位（禁止混合存储）",
    sqliteRun.json?.placeholderCount === 0 && Object.keys(placeholderErrors).length === 0,
    JSON.stringify(placeholderErrors),
  );
  check(
    "transaction() 路径可写入 Audit（装配顺序正确：先 migration 后仓储）",
    sqliteRun.json?.txError === "NO_ERROR_THROWN",
    String(sqliteRun.json?.txError),
  );
  check("启动日志声明 SQLite", sqliteRun.stdout.includes("[storage] Storage: SQLite"));

  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    console.warn(`  （临时目录稍后可手动删除：${tempDir}）`);
  }

  // ---- 4. 非法值 ----
  console.log("\n【4. APP_STORAGE=invalid → 明确失败】");
  const invalidRun = spawnProbe("invalid", { APP_STORAGE: "banana" });
  check("进程失败退出", invalidRun.status !== 0, `exit ${invalidRun.status}`);
  check(
    "错误信息含原值与全部合法值",
    invalidRun.stderr.includes('Invalid APP_STORAGE value: "banana"') &&
      invalidRun.stderr.includes('"postgres"') &&
      invalidRun.stderr.includes('"sqlite"'),
    invalidRun.stderr.split("\n").slice(0, 3).join(" | "),
  );

  console.log(`\n${"=".repeat(52)}`);
  console.log(`Step 3 装配验证结束：通过 ${passed} 项，失败 ${failed} 项`);
  console.log("=".repeat(52));
  if (failed > 0) process.exitCode = 1;
}

main();
