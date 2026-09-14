/**
 * 清理过期会话（运维 / 定时任务）
 * ---------------------------------------------------------------------------
 * 背景：`SessionStore.pruneExpired()` 此前没有调用点（见 src/server/auth/session-prune.ts）。
 * 本脚本是**显式**触发点，给 crontab / 容器定时任务用；登录路径另有节流触发。
 *
 * 用法：
 *   pnpm session:prune                                  # 清理 APP_STORAGE 对应存储（默认 postgres）
 *   $env:APP_STORAGE="sqlite"; pnpm session:prune        # 清理 SQLite 文件
 *
 * 幂等：只删除 expires_at < now 的行，可安全重复执行。
 * 退出码：成功 0；失败 1 并在 stderr 打印原因，便于 cron / 编排系统报警。
 */
import { pruneExpiredSessions } from "@/server/auth/session-prune";
import { storage } from "@/server/context";

async function main(): Promise<void> {
  const startedAt = Date.now();
  const deleted = await pruneExpiredSessions();
  console.log(
    `[session:prune] 存储=${storage.kind} 引擎=${storage.engine} 已清理过期会话 ${deleted} 条（耗时 ${Date.now() - startedAt}ms）`,
  );
}

main().catch((error) => {
  console.error("[session:prune] 清理失败：", error);
  process.exitCode = 1;
});
