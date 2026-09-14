import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * SQLite Migration 运行器
 * ---------------------------------------------------------------------------
 * 不依赖 prisma migrate（Prisma 对 SQLite 的托管迁移与本方案的双适配器结构
 * 不匹配）。自建版本表 `schema_version`，按文件名序号增量执行：
 *
 *   migrations/001_init.sql
 *   migrations/002_add_xxx.sql
 *   ...
 *
 * 每个 migration 在独立事务中执行：失败即整体回滚，版本号不推进，
 * 下次启动重试同一文件。已执行的 migration 不会重复执行。
 *
 * 文件读取用 `process.cwd()`（next dev / next start / tsx 脚本的工作目录
 * 都是项目根目录）。若将来改用 standalone 打包，需要把 migrations 目录
 * 一起复制进产物，并允许用环境变量覆盖目录。
 */

const MIGRATIONS_DIR =
  process.env.AUTOREPAIR_MIGRATIONS_DIR ??
  join(process.cwd(), "src/server/repos/sqlite/migrations");

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

function listMigrationFiles(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_.*\.sql$/.test(name))
    .sort();

  return files.map((name) => {
    const version = Number.parseInt(name.slice(0, 3), 10);
    if (Number.isNaN(version)) {
      throw new Error(`migration 文件名序号非法：${name}`);
    }
    return { version, name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") };
  });
}

/** 确保 schema_version 表存在（本身不走版本机制） */
function ensureVersionTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function appliedVersions(db: DatabaseSync): Set<number> {
  const rows = db.prepare("SELECT version FROM schema_version").all() as Array<{
    version: number;
  }>;
  return new Set(rows.map((row) => row.version));
}

/**
 * 把数据库推进到最新 schema。
 * 幂等：已应用的全部跳过；无新 migration 时零写入。
 */
export function migrate(db: DatabaseSync): number {
  ensureVersionTable(db);
  const done = appliedVersions(db);
  const pending = listMigrationFiles().filter((file) => !done.has(file.version));

  let applied = 0;
  for (const file of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(file.sql);
      db.prepare("INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)").run(
        file.version,
        file.name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
      applied += 1;
      console.info(`[sqlite] migration ${file.name} 已应用`);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // 事务可能已因错误自动回滚
      }
      throw new Error(
        `migration ${file.name} 执行失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return applied;
}

/** 当前 schema 版本（0 = 空库） */
export function currentVersion(db: DatabaseSync): number {
  try {
    const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as {
      v: number | null;
    };
    return row.v ?? 0;
  } catch {
    return 0;
  }
}
