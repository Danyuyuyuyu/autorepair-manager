/**
 * 应用侧备份服务装配
 * ---------------------------------------------------------------------------
 * 把 BackupService 接到真实运行环境：主库 = SQLite 应用数据库（resolveDbPath），
 * 备份目录 / 保留份数走环境变量，恢复时关闭并重开应用缓存的 SQLite 连接。
 *
 * 与 backup-service.ts 分开：那一份是纯逻辑（可注入任意路径做契约测试），
 * 这一份是「接线」。
 */
import {
  createBackupService,
  resolveBackupDir,
  resolveBackupRetention,
  type BackupService,
} from "@/server/backup/backup-service";
import { closeSqliteDb, getInitializedSqliteDb, resolveDbPath } from "@/server/repos/sqlite/client";

export function createAppBackupService(): BackupService {
  return createBackupService({
    databasePath: resolveDbPath(),
    backupDir: resolveBackupDir(),
    retention: resolveBackupRetention(),
    closeDatabase: () => closeSqliteDb(),
    reopenDatabase: () => {
      // 打开包含 migration + 状态识别：旧备份推进后不会被误当成全新库覆盖
      getInitializedSqliteDb();
    },
  });
}
