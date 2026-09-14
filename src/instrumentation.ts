/**
 * Next.js instrumentation —— 进程启动钩子
 * ---------------------------------------------------------------------------
 * 只用它做一件事：**SQLite 模式下每天自动备份一次**（§16 备份保留策略的
 * 「每日自动备份」）。放在这里而不是 UI / Server Action 里，因为这不是业务动作，
 * 而是启动维护；也不会散落在各处。
 *
 * 刻意保持三条边界：
 *   1. 只在 Node 运行时执行（edge 运行时没有文件系统）
 *   2. 只在 APP_STORAGE=sqlite 时执行 —— PostgreSQL 部署不需要本地文件备份，
 *      因此默认配置（未设置 APP_STORAGE）与 next build 完全不受影响
 *   3. 任何失败只 warn，绝不影响服务启动
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.APP_STORAGE !== "sqlite") return;

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
