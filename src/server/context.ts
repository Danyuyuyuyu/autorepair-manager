import "server-only";

import type { Repositories, RepositoryContext } from "@/domain/repositories";
import { createRepositoriesFor } from "@/server/repos/create-repositories";
import { resolveStorageKind } from "@/server/storage";

/**
 * 仓储上下文的组装点 —— 全应用唯一的「存储实现选择处」
 * ---------------------------------------------------------------------------
 * 业务层只从这里拿 `repos` / `transaction`，不直接触碰任何数据库驱动，
 * 也不允许出现任何 `if (APP_STORAGE === ...)` 分支（见 ADR-014）。
 *
 * 存储选择规则（src/server/storage.ts）：
 *   APP_STORAGE 未设置 → postgres（既有行为，pnpm dev 不受影响）
 *   APP_STORAGE=postgres → Prisma + PostgreSQL（现有路径，一行未改）
 *   APP_STORAGE=sqlite   → node:sqlite（已实现仓储真实工作，未实现仓储访问即报错）
 *   其他值 → 启动即抛错，不静默 fallback
 *
 * 装配顺序保证：SQLite 模式下 getSqliteDb() 在返回任何仓储之前
 * 完成连接、PRAGMA、migration —— 不会出现「先查询后迁移」。
 */

/** 当前进程的存储模式（模块加载时解析一次；非法值在此立即失败） */
export const storageKind = resolveStorageKind(process.env.APP_STORAGE);

const assembled = createRepositoriesFor(storageKind);

/** 无事务的默认仓储（只读查询与单条写入） */
export const repos: Repositories = assembled.repos;

/** 认证基础设施：与 repos 使用同一 APP_STORAGE 装配，不属于业务 Repository。 */
export const sessionStore = assembled.sessionStore;

/**
 * 在一个事务中执行一组仓储操作。
 * 回调拿到的仓储绑定在同一事务上：任何一步抛错，全部回滚。
 * PostgreSQL 走 Prisma 交互式事务；SQLite 走 BEGIN IMMEDIATE 串行队列。
 */
export function transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
  return assembled.transaction(fn);
}

/** 存储元信息（kind / engine / SQLite 数据文件路径），供日志与健康检查使用 */
export const storage = assembled.info;

// 启动日志：明确当前运行在哪种存储上。
// SQLite 的文件路径仅在非生产环境打印，避免生产日志泄露机器路径。
if (storage.kind === "sqlite") {
  console.info(
    `[storage] Storage: SQLite${process.env.NODE_ENV !== "production" && storage.database ? `\n[storage] Database: ${storage.database}` : ""}`,
  );
} else {
  console.info("[storage] Storage: PostgreSQL");
}

/** 供需要显式传递上下文的场景使用（例如移动端注入自己的实现） */
export const repositoryContext: RepositoryContext = { repos, transaction };
