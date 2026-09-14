/**
 * 备份服务契约 —— 真实文件、真实 SQLite、真实破坏
 * ---------------------------------------------------------------------------
 * 覆盖：
 *   1. 创建：备份文件通过 integrity_check / foreign_key_check / 业务表齐备 / schema_version
 *   2. 列出：新 → 旧
 *   3. 校验：损坏文件必须判为不通过
 *   4. 恢复：删除主库后从备份恢复，数据回到备份时点
 *   5. 恢复前自动备份：pre-restore 备份必须存在
 *   6. 拒绝恢复：损坏备份被拒绝，且主库保持原样
 *   7. 失败回滚：恢复中途失败（注入重开异常）必须回到恢复前状态
 *   8. 保留策略：只保留最近 N 份
 *   9. 每日备份：当天第二次调用不再创建
 *
 * 运行：pnpm backup:contract
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createBackupService,
  type BackupService,
  type BackupServiceOptions,
} from "@/server/backup/backup-service";

let passed = 0;
function check(label: string, condition: unknown): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "autorepair-backup-contract-"));
  const dbPath = join(dir, "main.db");
  const backupDir = join(dir, "backups");
  process.env.AUTOREPAIR_DB_PATH = dbPath;

  const [{ closeSqliteDb, getSqliteDb }, { createSqliteRepositories }] = await Promise.all([
    import("@/server/repos/sqlite/client"),
    import("@/server/repos/sqlite/factory"),
  ]);

  const repos = () => createSqliteRepositories(getSqliteDb());
  const makeService = (overrides: Partial<BackupServiceOptions> = {}): BackupService =>
    createBackupService({
      databasePath: dbPath,
      backupDir,
      closeDatabase: () => closeSqliteDb(),
      reopenDatabase: () => getSqliteDb(),
      ...overrides,
    });
  const customerTotal = async () => (await repos().customer.list({}, { skip: 0, take: 100 })).total;

  try {
    // 造一份真实数据（含外键）
    const admin = await repos().user.create({
      username: "backup-contract-admin",
      name: "备份契约管理员",
      phone: null,
      passwordHash: "hash",
      role: "ADMIN",
    });
    const first = await repos().customer.create({
      name: "备份契约客户-1",
      phone: "13500000001",
      createdBy: admin.id,
    });
    await repos().vehicle.create({ customerId: first.id, plateNumber: "粤BC0001" });
    check("前置：真实主库已建立（1 个客户 + 1 台车）", (await customerTotal()) === 1);

    const service = makeService();
    const backup1 = await service.createBackup("manual");
    check("备份文件已生成", existsSync(backup1.path) && backup1.sizeBytes > 0);
    const verify1 = await service.verifyBackup(backup1.path);
    check(
      "备份通过完整性校验（integrity=ok / fk=0 / 业务表齐备 / schema 版本存在）",
      verify1.ok &&
        verify1.integrity === "ok" &&
        verify1.foreignKeyViolations === 0 &&
        verify1.missingTables.length === 0,
    );

    // 备份之后再写入，用于证明恢复确实回到备份时点
    await repos().customer.create({
      name: "备份契约客户-2",
      phone: "13500000002",
      createdBy: admin.id,
    });
    const backup2 = await service.createBackup("manual");
    check("第二份备份通过校验", (await service.verifyBackup(backup2.path)).ok === true);

    const strayFiles = readdirSync(backupDir).filter((name) => !name.endsWith(".db"));
    check("备份目录不残留 -wal / -shm 伴生文件（备份是单一文件）", strayFiles.length === 0);

    const listed = await service.listBackups();
    check(
      "listBackups 按新 → 旧返回",
      listed.length === 2 && listed[0]!.fileName === backup2.fileName,
    );

    const corruptPath = join(backupDir, "autorepair-19990101-000000.db");
    writeFileSync(corruptPath, "this is definitely not a sqlite database");
    const corrupt = await service.verifyBackup(corruptPath);
    check(
      "损坏文件被判定为校验不通过",
      corrupt.ok === false && (corrupt.integrity !== "ok" || corrupt.error !== undefined),
    );

    // —— 真实破坏恢复：删掉主库再恢复 ——
    closeSqliteDb();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    check("主库已真实删除", !existsSync(dbPath));

    const restored = await service.restoreBackup(backup1.path);
    check("从备份恢复成功且恢复后校验通过", restored.verification.ok && existsSync(dbPath));
    check("恢复后回到备份时点数据（客户数 = 1）", (await customerTotal()) === 1);

    // —— 拒绝恢复损坏备份，主库不得被破坏 ——
    let refused = "";
    try {
      await service.restoreBackup(corruptPath);
    } catch (error) {
      refused = (error as Error).message;
    }
    check("损坏备份被拒绝恢复", refused.includes("拒绝恢复"));
    check("拒绝恢复后主库保持原样", (await customerTotal()) === 1);

    // —— 恢复中途失败必须回滚 ——
    const beforeRollback = await repos().customer.create({
      name: "回滚前客户",
      phone: "13500000009",
      createdBy: admin.id,
    });
    check(
      "回滚测试前置：主库有 2 个客户",
      (await customerTotal()) === 2 && Boolean(beforeRollback.id),
    );

    const failing = makeService({
      reopenDatabase: () => {
        throw new Error("注入的重开失败");
      },
    });
    let rollbackMessage = "";
    try {
      await failing.restoreBackup(backup2.path);
    } catch (error) {
      rollbackMessage = (error as Error).message;
    }
    check("恢复中途失败会回滚并报错", rollbackMessage.includes("已回滚"));
    check("回滚后主库仍是恢复前状态（仍是 2 个客户）", (await customerTotal()) === 2);

    // —— 恢复前自动备份 ——
    const withPre = await service.restoreBackup(backup2.path);
    check(
      "恢复前自动生成 -prerestore 备份",
      withPre.preRestore !== null &&
        withPre.preRestore.isPreRestore &&
        existsSync(withPre.preRestore.path),
    );
    check("恢复后数据回到 backup2 时点（2 个客户）", (await customerTotal()) === 2);

    // —— 保留策略 ——
    const retentionDir = join(dir, "backups-retention");
    let clock = Date.parse("2030-01-01T00:00:00Z");
    const retentionService = createBackupService({
      databasePath: dbPath,
      backupDir: retentionDir,
      retention: 2,
      now: () => new Date((clock += 1000)),
    });
    const createdNames = [
      (await retentionService.createBackup()).fileName,
      (await retentionService.createBackup()).fileName,
      (await retentionService.createBackup()).fileName,
    ];
    const kept = readdirSync(retentionDir).filter((name) => name.endsWith(".db"));
    check(
      "保留策略只留最近 N 份（N=2）且保留的是最新的两份",
      kept.length === 2 &&
        kept.includes(createdNames[1]!) &&
        kept.includes(createdNames[2]!) &&
        !kept.includes(createdNames[0]!),
    );

    // —— 每日备份 ——
    const dailyDir = join(dir, "backups-daily");
    const dailyDay = new Date("2031-05-05T10:00:00Z");
    const dailyService = createBackupService({
      databasePath: dbPath,
      backupDir: dailyDir,
      now: () => dailyDay,
    });
    const firstDaily = await dailyService.maybeCreateDailyBackup();
    const secondDaily = await dailyService.maybeCreateDailyBackup();
    check("每日备份当天只创建一次", firstDaily !== null && secondDaily === null);

    console.log(`\n备份服务契约：通过 ${passed} 项，失败 0 项`);
  } finally {
    closeSqliteDb();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      console.warn(`（临时目录稍后可手动删除：${dir}）`);
    }
  }
}

main().catch((error) => {
  console.error("\n备份服务契约失败：", error);
  process.exitCode = 1;
});
