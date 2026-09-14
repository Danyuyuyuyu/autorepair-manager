/**
 * Next.js instrumentation —— 进程启动钩子
 * ---------------------------------------------------------------------------
 * SQLite 模式的启动维护 seam：先完成 migration + First Run bootstrap，
 * 再执行既有的每日备份。初始化失败必须阻止服务继续启动；备份失败仍只告警。
 *
 * 刻意保持三条边界：
 *   1. 只在 Node 运行时执行（edge 运行时没有文件系统）
 *   2. 只在 APP_STORAGE=sqlite 时执行 —— PostgreSQL 部署不需要本地文件备份，
 *      因此默认配置（未设置 APP_STORAGE）与 next build 完全不受影响
 *   3. bootstrap 失败 fail-fast；每日备份失败只 warn
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PRIVATE_BUILD_WORKER === "1"
  )
    return;
  if (process.env.APP_STORAGE !== "sqlite") return;

  const { initializeSqliteStorage } = await import("@/server/repos/sqlite/client");
  const initialized = initializeSqliteStorage();

  // 空白库只有系统账号与 marker，没有值得保护的业务数据；首次启动不制造空备份。
  if (initialized.bootstrap.outcome === "CREATED") return;

  try {
    const { createAppBackupService } = await import("@/server/backup/app-backup-service");
    const info = await createAppBackupService().maybeCreateDailyBackup();
    if (info) console.info(`[backup] 每日自动备份：${info.fileName}`);
  } catch (error) {
    console.warn(
      "[backup] 每日自动备份失败（已忽略，不影响启动）：",
      error instanceof Error ? error.message : error,
    );
  }
}
