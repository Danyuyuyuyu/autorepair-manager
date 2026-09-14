/**
 * PostgreSQL → SQLite 正式迁移 CLI
 * ---------------------------------------------------------------------------
 * 用法：
 *   pnpm migrate:postgres-to-sqlite                      # 迁到应用默认 SQLite 路径（要求目标为空/不存在）
 *   pnpm migrate:postgres-to-sqlite -- --target <path>   # 指定目标文件
 *   pnpm migrate:postgres-to-sqlite -- --force           # 目标非空时先自动备份再覆盖
 *
 * 流程：读取 PostgreSQL → 领域转换 → SQLite 单事务写入 → 七层校验 → 报告
 * 退出码：校验全过 0；任何一层不过或过程出错 1。
 */
import { PrismaClient } from "@prisma/client";

import {
  createBackupService,
  resolveBackupDir,
  resolveBackupRetention,
} from "@/server/backup/backup-service";
import { MigrationError, runPostgresToSqliteMigration } from "@/server/migration/migrate";
import type { MigrationVerification } from "@/server/migration/verify";
import { resolveDbPath } from "@/server/repos/sqlite/client";

function parseArgs(argv: string[]): { targetPath: string; force: boolean } {
  let targetPath = resolveDbPath();
  let force = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      force = true;
    } else if (arg === "--target") {
      const value = argv[index + 1];
      if (!value) throw new Error("--target 需要一个路径参数");
      targetPath = value;
      index += 1;
    } else if (arg?.startsWith("--target=")) {
      targetPath = arg.slice("--target=".length);
    } else if (arg === undefined) {
      continue;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return { targetPath, force };
}

function maskDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? "";
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.username ? "***@" : ""}${url.host}${url.pathname}`;
  } catch {
    return "（未配置）";
  }
}

function printVerification(verification: MigrationVerification): void {
  console.log("\n【2/5】逐表 Count 对账");
  for (const row of verification.counts) {
    console.log(
      `  ${row.table.padEnd(26)} ${String(row.postgres).padStart(7)} = ${String(row.sqlite).padStart(7)}  ${row.equal ? "✓" : "✗"}`,
    );
  }
  console.log(`  mismatch = ${verification.countMismatches}`);

  console.log("\n【3/5】外键完整性与孤儿关系");
  console.log(`  PRAGMA foreign_key_check：${verification.foreignKeyCheck.violations} violations`);
  for (const row of verification.orphans) {
    console.log(
      `  ${row.relation.padEnd(52)} ${row.postgres} = ${row.sqlite}  ${row.equal ? "✓" : "✗"}`,
    );
  }
  console.log(`  violation = ${verification.orphanViolations}`);

  console.log("\n【4/5】业务聚合对账");
  for (const row of verification.aggregates) {
    console.log(
      `  ${row.label.padEnd(18)} ${row.postgres.padStart(16)} = ${row.sqlite.padStart(16)}  ${row.equal ? "✓" : "✗"}`,
    );
  }
  console.log(`  difference = ${verification.aggregateMismatches}`);

  console.log("\n【5/5】逐行逐列对账");
  console.log(`  全表比较行数：${verification.rowsCompared}`);
  for (const diff of verification.rows) {
    if (
      diff.mismatches.length === 0 &&
      diff.missingInSqlite.length === 0 &&
      diff.missingInPostgres.length === 0
    ) {
      continue;
    }
    console.log(
      `  ✗ ${diff.table}：mismatch=${diff.mismatches.length} 缺于 SQLite=${diff.missingInSqlite.length} 缺于 PostgreSQL=${diff.missingInPostgres.length}`,
    );
    for (const mismatch of diff.mismatches.slice(0, 5)) {
      console.log(`      id=${mismatch.id} 字段：${mismatch.fields.join(", ")}`);
    }
  }
  console.log(
    `  WorkOrder compared: ${verification.workOrders.compared} / Mismatch: ${verification.workOrders.mismatches.length}`,
  );
  for (const mismatch of verification.workOrders.mismatches.slice(0, 5)) {
    console.log(`      id=${mismatch.id} 字段：${mismatch.fields.join(", ")}`);
  }
  console.log(
    `  Part+Inventory compared: ${verification.parts.compared} / Mismatch: ${verification.parts.mismatches.length}`,
  );
  for (const mismatch of verification.parts.mismatches.slice(0, 5)) {
    console.log(`      id=${mismatch.id} 字段：${mismatch.fields.join(", ")}`);
  }
  console.log(`  Audit JSON 语义比较：${verification.jsonCompared} 个非空值`);

  console.log("\n【边界样本】");
  for (const sample of verification.samples) {
    console.log(
      `  ${sample.label.padEnd(34)} ${sample.postgres} | ${sample.sqlite}  ${sample.equal ? "✓" : "✗"}`,
    );
  }
  console.log(`  sample mismatch = ${verification.sampleMismatches}`);
  for (const error of verification.errors) console.log(`  ✗ ${error}`);
}

async function main(): Promise<void> {
  const { targetPath, force } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    console.log("=== PostgreSQL → SQLite 迁移 ===");
    console.log(`源：PostgreSQL ${maskDatabaseUrl()}`);
    console.log(`目标：${targetPath}${force ? "（--force：允许备份后覆盖）" : ""}`);

    const backupService = createBackupService({
      databasePath: targetPath,
      backupDir: resolveBackupDir(),
      retention: resolveBackupRetention(),
    });

    const outcome = await runPostgresToSqliteMigration({
      prisma,
      targetPath,
      force,
      backupService,
      onProgress: (message) => console.log(`  · ${message}`),
    });

    console.log("\n【1/5】写入结果（单事务）");
    for (const stat of outcome.copy.tables) {
      console.log(`  ${stat.table.padEnd(26)} ${String(stat.rows).padStart(7)}`);
    }
    console.log(`  合计 ${outcome.copy.totalRows} 行`);
    if (outcome.copy.clearedRows > 0) {
      console.log(
        `  同一事务内先清空目标旧数据 ${outcome.copy.clearedRows} 行（目标最终内容 = PostgreSQL）`,
      );
    }
    if (outcome.preMigrationBackup) {
      console.log(`  目标原有数据已备份：${outcome.preMigrationBackup.path}`);
    }

    printVerification(outcome.verification);

    console.log(
      outcome.verification.ok
        ? "\n结论：✅ 迁移验收通过（Count / 外键 / 孤儿 / 聚合 / 逐行 / 工单 / 库存 / 边界样本 全部一致）"
        : "\n结论：❌ 迁移验收失败（存在不一致，详见上方 ✗ 行）",
    );
    if (!outcome.verification.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  if (error instanceof MigrationError && error.detail) {
    const detail = error.detail;
    console.error("\n[migrate] 迁移失败：", error.message);
    console.error(
      `  表=${detail.table} 模型=${detail.model} 第 ${detail.recordIndex + 1} 行 ${detail.primaryKey}=${String(detail.primaryKeyValue)}`,
    );
    console.error(`  原始行=${detail.row}`);
    console.error(`  原始错误=${detail.cause}`);
  } else {
    console.error("\n[migrate] 迁移失败：", error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
