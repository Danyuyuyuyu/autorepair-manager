import { accessSync, constants, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ensureFirstRunBootstrap, type BootstrapResult } from "@/server/bootstrap/first-run";
import { migrate } from "./migration";

/**
 * SQLite 连接管理
 * ---------------------------------------------------------------------------
 * 单连接单例（node:sqlite DatabaseSync 本身就是同步单连接驱动）。
 *
 * 数据文件位置：不放在源码目录，放 Windows 用户数据目录，保证
 * 更新程序不覆盖数据、数据与代码分离、便于备份：
 *
 *   %LOCALAPPDATA%\AutoRepairManager\data\autorepair.db
 *
 * 两个环境变量可覆盖（脚本与测试用）：
 *   AUTOREPAIR_DB_PATH       数据库文件绝对路径
 *   AUTOREPAIR_MIGRATIONS_DIR  migrations 目录（默认 <cwd>/src/server/repos/sqlite/migrations）
 *
 * PRAGMA：
 *   journal_mode = WAL       读写不互斥，断电可恢复（阶段 2 规范第十六条）
 *   synchronous  = NORMAL    WAL 推荐档位：性能与持久性平衡
 *   foreign_keys = ON        必须显式开启，SQLite 默认关闭外键！
 *   busy_timeout = 5000      外部进程短暂持锁时等待而不是立刻报错
 */

export const DEFAULT_DB_FILENAME = "autorepair.db";

/** 解析数据库文件路径（每次调用都重新读环境变量，便于测试切换） */
export function resolveDbPath(): string {
  const override = process.env.AUTOREPAIR_DB_PATH;
  if (override) return override;

  const localAppData =
    process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? process.cwd(), "AppData", "Local");
  return join(localAppData, "AutoRepairManager", "data", DEFAULT_DB_FILENAME);
}

let cached: DatabaseSync | null = null;
let bootstrapResult: BootstrapResult | null = null;

/** 获取（必要时创建并迁移）应用数据库连接 */
export function getSqliteDb(): DatabaseSync {
  if (cached) return cached;

  const file = resolveDbPath();
  const directory = dirname(file);
  try {
    mkdirSync(directory, { recursive: true });
    accessSync(directory, constants.W_OK);
  } catch (error) {
    throw new Error(
      `首次初始化失败：数据库目录不可写或无法创建（${directory}）。${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
  } catch (error) {
    throw new Error(
      `首次初始化失败：无法创建或打开 SQLite 数据库（${file}）。请确认数据库目录可写。${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    // 外键必须显式开启 —— SQLite 默认 OFF，等于外键约束全部失效
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");

    migrate(db);
  } catch (error) {
    db.close();
    throw new Error(
      `首次初始化失败：数据库结构迁移未完成。${error instanceof Error ? error.message : String(error)}`,
    );
  }

  cached = db;
  return db;
}

/**
 * 应用启动入口：结构 migration 完成后，再执行正式 First Run bootstrap。
 * 低层 migration / repository contracts 继续使用 getSqliteDb()，不会夹带正式初始化数据。
 */
export function getInitializedSqliteDb(): DatabaseSync {
  return initializeSqliteStorage().database;
}

/** 完整应用启动结果；instrumentation 用 outcome 避免为空白新库立即创建每日备份。 */
export function initializeSqliteStorage(): {
  database: DatabaseSync;
  bootstrap: BootstrapResult;
} {
  const db = getSqliteDb();
  try {
    bootstrapResult ??= ensureFirstRunBootstrap(db);
    return { database: db, bootstrap: bootstrapResult };
  } catch (error) {
    closeSqliteDb();
    throw error;
  }
}

/** 关闭当前连接（测试 / 备份前调用；备份也可以直接复制文件，WAL 下安全） */
export function closeSqliteDb(): void {
  cached?.close();
  cached = null;
  bootstrapResult = null;
}

/** 仅供测试：不落盘的内存库（跑 migrations 后可直接用） */
export function createMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}
