/**
 * PostgreSQL → SQLite 迁移（读取 → 转换 → 单事务写入 → 校验）
 * ---------------------------------------------------------------------------
 * 原则：
 *   - **保留原 ID**：主键值原样搬运，不重新生成（否则历史关系会断）
 *   - **顺序来自真实外键**：见 plan.ts 的拓扑排序
 *   - **单次整体事务**：写入阶段 BEGIN IMMEDIATE … COMMIT，失败整体回滚，
 *     绝不留下半张表的数据
 *   - **失败可定位**：报错带 表 / 记录序号 / 主键 / 原始行 / 原始错误
 *   - **不静默覆盖**：目标 SQLite 非空必须显式 --force，且先自动生成
 *     pre-migration 备份
 *   - **校验不过就是失败**：verifyMigration() 任何一层不过，ok=false，
 *     调用方必须把它当成迁移失败
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { BackupInfo, BackupService } from "@/server/backup/backup-service";
import { migrate as runSqliteMigrations } from "@/server/repos/sqlite/migration";
import { SQLITE_BUSINESS_TABLES, SQLITE_VERSION_TABLE } from "@/server/repos/sqlite/schema-tables";
import {
  buildMigrationPlan,
  messageOf,
  toSqliteValue,
  type MigrationPlan,
  type PlannedTable,
} from "@/server/migration/plan";
import { verifyMigration, type MigrationVerification } from "@/server/migration/verify";

export interface SqliteTargetInspection {
  path: string;
  exists: boolean;
  /** 是否是本项目的库（存在 schema_version 或任一业务表） */
  isOurDatabase: boolean;
  /** 目标文件里非本项目的其它表 */
  foreignTables: string[];
  rowCounts: Array<{ table: string; rows: number }>;
  totalRows: number;
}

export interface TableCopyStat {
  table: string;
  model: string;
  rows: number;
}

export interface MigrationCopyResult {
  tables: TableCopyStat[];
  totalRows: number;
  /** 覆盖已有目标时，在同一事务内先清掉的旧行数 */
  clearedRows: number;
}

export interface MigrationErrorDetail {
  table: string;
  model: string;
  recordIndex: number;
  primaryKey: string;
  primaryKeyValue: unknown;
  row: string;
  cause: string;
}

export class MigrationError extends Error {
  readonly detail?: MigrationErrorDetail;

  constructor(message: string, detail?: MigrationErrorDetail) {
    super(message);
    this.name = "MigrationError";
    this.detail = detail;
  }
}

export interface MigrationOptions {
  prisma: PrismaClient;
  targetPath: string;
  /** 目标非空时是否允许备份后覆盖 */
  force?: boolean;
  /** 覆盖前自动备份所需的备份服务 */
  backupService?: BackupService;
  onProgress?: (message: string) => void;
}

export interface MigrationOutcome {
  inspection: SqliteTargetInspection;
  preMigrationBackup: BackupInfo | null;
  plan: MigrationPlan;
  copy: MigrationCopyResult;
  verification: MigrationVerification;
}

function rowPreview(row: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(row);
    return text.length > 600 ? `${text.slice(0, 600)}…` : text;
  } catch {
    return "（无法序列化的行）";
  }
}

function allSqliteTables(db: DatabaseSync): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

/** 迁移前检查目标 SQLite（不修改任何数据） */
export function inspectSqliteTarget(path: string): SqliteTargetInspection {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      isOurDatabase: false,
      foreignTables: [],
      rowCounts: [],
      totalRows: 0,
    };
  }

  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    const tables = allSqliteTables(db);
    const business = new Set<string>(SQLITE_BUSINESS_TABLES);
    const isOurDatabase =
      tables.includes(SQLITE_VERSION_TABLE) || tables.some((table) => business.has(table));
    const foreignTables = tables.filter(
      (table) => table !== SQLITE_VERSION_TABLE && !business.has(table),
    );
    const rowCounts = SQLITE_BUSINESS_TABLES.filter((table) => tables.includes(table)).map(
      (table) => ({
        table,
        rows: Number((db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c),
      }),
    );
    return {
      path,
      exists: true,
      isOurDatabase,
      foreignTables,
      rowCounts,
      totalRows: rowCounts.reduce((total, row) => total + row.rows, 0),
    };
  } finally {
    db.close();
  }
}

/** 读取 PostgreSQL 全部业务表（一次读进内存：本项目数据量级下最简单也最安全） */
export async function readAllPostgresRows(
  prisma: PrismaClient,
  plan: MigrationPlan,
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const data = new Map<string, Array<Record<string, unknown>>>();
  const client = prisma as unknown as Record<
    string,
    { findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>> }
  >;
  for (const table of plan.tables) {
    const delegate = client[table.accessor];
    if (!delegate || typeof delegate.findMany !== "function") {
      throw new MigrationError(
        `Prisma Client 上没有 ${table.accessor} 委托，无法读取 ${table.table}`,
      );
    }
    data.set(table.table, await delegate.findMany());
  }
  return data;
}

/**
 * 写入 SQLite —— 单事务，任何一行失败整体回滚，并抛出可定位的错误。
 *
 * `replaceExisting` 为真时，先按**外键反序**清空业务表再写入：目标库最终内容
 * 恰好等于 PostgreSQL，且清空 + 写入在同一事务里 —— 中途失败回滚后目标仍是
 * 覆盖前的完整数据（备份文件之外再多一层保险）。
 */
export function insertRowsInOneTransaction(
  sqliteDb: DatabaseSync,
  plan: MigrationPlan,
  data: Map<string, Array<Record<string, unknown>>>,
  options: { replaceExisting?: boolean } = {},
): MigrationCopyResult {
  sqliteDb.exec("PRAGMA foreign_keys = ON;");
  sqliteDb.exec("BEGIN IMMEDIATE");
  const stats: TableCopyStat[] = [];
  let clearedRows = 0;

  try {
    if (options.replaceExisting) {
      for (const table of [...plan.tables].reverse()) {
        const result = sqliteDb.prepare(`DELETE FROM ${table.table}`).run();
        clearedRows += Number(result.changes);
      }
    }

    for (const table of plan.tables) {
      const rows = data.get(table.table) ?? [];
      const columns = table.columns.map((column) => column.column);
      const sql =
        `INSERT INTO ${table.table} (${columns.map((column) => `"${column}"`).join(", ")})` +
        ` VALUES (${columns.map(() => "?").join(", ")})`;
      const statement = sqliteDb.prepare(sql);

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        const values = table.columns.map((column) =>
          toSqliteValue(column.kind, row[column.field]),
        ) as SQLInputValue[];
        try {
          statement.run(...values);
        } catch (error) {
          const primaryKey = table.primaryKeyFields[0] ?? "id";
          throw new MigrationError(
            `写入 SQLite 失败：表 ${table.table} 第 ${index + 1}/${rows.length} 行` +
              `（${primaryKey}=${String(row[primaryKey] ?? "")}）：${messageOf(error)}`,
            {
              table: table.table,
              model: table.model,
              recordIndex: index,
              primaryKey,
              primaryKeyValue: row[primaryKey] ?? null,
              row: rowPreview(row),
              cause: messageOf(error),
            },
          );
        }
      }
      stats.push({ table: table.table, model: table.model, rows: rows.length });
    }
    sqliteDb.exec("COMMIT");
  } catch (error) {
    try {
      sqliteDb.exec("ROLLBACK");
    } catch {
      // 事务可能已因错误自动回滚
    }
    throw error;
  }

  return {
    tables: stats,
    totalRows: stats.reduce((total, stat) => total + stat.rows, 0),
    clearedRows,
  };
}

/** 空库判定：没有业务行、也没有外来表 */
function hasExistingData(inspection: SqliteTargetInspection): boolean {
  return inspection.exists && (inspection.totalRows > 0 || inspection.foreignTables.length > 0);
}

function summarizeCounts(inspection: SqliteTargetInspection): string {
  const nonZero = inspection.rowCounts.filter((row) => row.rows > 0);
  return nonZero.length === 0
    ? "无业务行"
    : nonZero.map((row) => `${row.table}=${row.rows}`).join(", ");
}

export async function runPostgresToSqliteMigration(
  options: MigrationOptions,
): Promise<MigrationOutcome> {
  const { prisma, targetPath, force = false } = options;
  const log = options.onProgress ?? (() => {});

  const inspection = inspectSqliteTarget(targetPath);

  if (hasExistingData(inspection) && !force) {
    throw new MigrationError(
      [
        `目标 SQLite 已有数据，拒绝静默覆盖：${targetPath}`,
        `  现有行数：${inspection.totalRows}（${summarizeCounts(inspection)}）`,
        inspection.foreignTables.length > 0
          ? `  检测到非本项目表：${inspection.foreignTables.join(", ")}`
          : null,
        "请显式二选一：",
        "  A. 迁移到一个空的新数据库文件：--target <path>",
        "  B. 备份后覆盖：--force（会先自动创建 pre-migration 备份）",
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    );
  }

  let preMigrationBackup: BackupInfo | null = null;
  if (hasExistingData(inspection)) {
    if (!options.backupService) {
      throw new MigrationError("覆盖已有 SQLite 前必须提供 BackupService 以生成迁移前备份");
    }
    log("目标库非空：先生成迁移前备份 …");
    preMigrationBackup = await options.backupService.createBackup("pre-migration");
  }

  // 目标文件所在目录可能还不存在（应用启动时由 sqlite client 负责创建）
  mkdirSync(dirname(targetPath), { recursive: true });

  const db = new DatabaseSync(targetPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    const applied = runSqliteMigrations(db);
    if (applied > 0) log(`目标库已应用 ${applied} 个 migration`);

    const plan = buildMigrationPlan(db);
    log(
      `迁移计划：${plan.tables.length} 张表 / ${plan.foreignKeys.length} 条外键` +
        `\n顺序：${plan.tables.map((table) => table.table).join(" → ")}`,
    );

    log("读取 PostgreSQL …");
    const data = await readAllPostgresRows(prisma, plan);

    log("写入 SQLite（单事务）…");
    const copy = insertRowsInOneTransaction(db, plan, data, {
      replaceExisting: hasExistingData(inspection),
    });
    log(
      copy.clearedRows > 0
        ? `写入完成：${copy.totalRows} 行（同事务内先清空目标旧数据 ${copy.clearedRows} 行）`
        : `写入完成：${copy.totalRows} 行`,
    );

    log("执行迁移校验 …");
    const verification = await verifyMigration(prisma, db, plan);

    return { inspection, preMigrationBackup, plan, copy, verification };
  } finally {
    db.close();
  }
}

/** 供 CLI / 测试复用的表级统计展示 */
export function tableStatsOf(plan: MigrationPlan): PlannedTable[] {
  return plan.tables;
}
