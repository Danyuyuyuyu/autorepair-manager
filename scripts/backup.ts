/**
 * 备份 / 校验 / 恢复 CLI
 * ---------------------------------------------------------------------------
 * 用法（pnpm 会把脚本名之后的参数原样转发过来）：
 *   pnpm backup create              # 立即备份（不带命令时的默认动作）
 *   pnpm backup list                # 列出备份（新 → 旧）
 *   pnpm backup verify <文件>        # 校验指定备份
 *   pnpm backup verify-latest       # 校验最新一份备份
 *   pnpm backup restore <文件>       # 恢复（自动先备份当前库，失败自动回滚）
 *   pnpm backup prune               # 只执行保留策略
 *   pnpm backup daily               # 当天还没有备份时才创建（供计划任务）
 *   pnpm backup info                # 打印主库 / 备份目录 / 保留份数
 *
 * 退出码：成功 0；失败 1（stderr 打印原因），便于计划任务报警。
 * 注意：restore 会替换主库文件，必须保证服务端已停止（否则 Windows 上文件被占用，
 * 会明确报错而不是产生半恢复的库）。
 */
import { existsSync } from "node:fs";

import { createAppBackupService } from "@/server/backup/app-backup-service";
import { resolveBackupDir, resolveBackupRetention } from "@/server/backup/backup-service";
import { resolveDbPath } from "@/server/repos/sqlite/client";

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main(): Promise<void> {
  const [command = "create", argument] = process.argv.slice(2);
  const service = createAppBackupService();

  switch (command) {
    case "create": {
      const info = await service.createBackup("manual");
      console.log(`已创建备份：${info.path}`);
      console.log(`  ${info.fileName}  ${formatSize(info.sizeBytes)}  ${info.createdAt}`);
      return;
    }
    case "daily": {
      const info = await service.maybeCreateDailyBackup();
      console.log(info ? `已创建今日备份：${info.path}` : "今天已有备份，跳过。");
      return;
    }
    case "list": {
      const backups = await service.listBackups();
      if (backups.length === 0) {
        console.log("（还没有任何备份）");
        return;
      }
      console.log(`共 ${backups.length} 份备份（新 → 旧）：`);
      for (const info of backups) {
        console.log(
          `  ${info.fileName}  ${formatSize(info.sizeBytes).padStart(9)}  ${info.createdAt}${info.isPreRestore ? "  [恢复前自动备份]" : ""}`,
        );
      }
      return;
    }
    case "verify":
    case "verify-latest": {
      const target =
        command === "verify-latest" ? (await service.listBackups())[0]?.path : argument;
      if (!target) {
        throw new Error("用法：pnpm backup verify <备份文件>（或 pnpm backup verify-latest）");
      }
      if (!existsSync(target)) throw new Error(`备份文件不存在：${target}`);
      const result = await service.verifyBackup(target);
      console.log(`${target}`);
      console.log(
        `  ok=${result.ok} integrity=${result.integrity} foreign_key_violations=${result.foreignKeyViolations} schema=v${result.schemaVersion}`,
      );
      if (result.missingTables.length > 0)
        console.log(`  缺失表：${result.missingTables.join(", ")}`);
      if (result.error) console.log(`  错误：${result.error}`);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    case "restore": {
      if (!argument) throw new Error("用法：pnpm backup restore <备份文件>");
      if (!existsSync(argument)) throw new Error(`备份文件不存在：${argument}`);
      const result = await service.restoreBackup(argument);
      console.log(`已恢复：${result.restored.path}`);
      console.log(
        `  恢复后校验：ok=${result.verification.ok} integrity=${result.verification.integrity} foreign_key_violations=${result.verification.foreignKeyViolations} schema=v${result.verification.schemaVersion}`,
      );
      console.log(
        result.preRestore
          ? `  恢复前库已自动备份：${result.preRestore.path}`
          : "  恢复前主库不存在，未生成恢复前备份。",
      );
      return;
    }
    case "prune": {
      const removed = await service.pruneOldBackups();
      console.log(
        removed.length > 0
          ? `已按保留策略删除 ${removed.length} 份：${removed.join(", ")}`
          : "没有超出保留份数的备份，未删除任何文件。",
      );
      return;
    }
    case "info": {
      console.log(`主数据库：${resolveDbPath()}`);
      console.log(`备份目录：${resolveBackupDir()}`);
      console.log(`保留份数：${resolveBackupRetention()}`);
      return;
    }
    default:
      throw new Error(`未知命令：${command}`);
  }
}

main().catch((error) => {
  console.error("[backup] 失败：", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
