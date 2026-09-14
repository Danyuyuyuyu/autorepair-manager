import "server-only";

import type { Repositories } from "@/domain/repositories";
import type { SessionStore } from "@/server/auth/session-store";
import { createPrismaSessionStore } from "@/server/auth/session-stores/prisma";
import { createSqliteSessionStore } from "@/server/auth/session-stores/sqlite";
import { prisma } from "@/server/db";
import { createRepositories } from "@/server/repos/prisma";
import { withTranslatedErrors } from "@/server/repos/prisma/client";
import { storageInfoOf, type StorageInfo, type StorageKind } from "@/server/storage";
import {
  createSqliteRepositories,
  initSqliteDb,
  SQLITE_NOT_IMPLEMENTED,
} from "@/server/repos/sqlite/factory";
import { resolveDbPath } from "@/server/repos/sqlite/client";
import { withSqliteErrorTranslation } from "@/server/repos/sqlite/errors";
import { runInTransaction } from "@/server/repos/sqlite/transaction";
import type { DatabaseSync } from "node:sqlite";

/**
 * 存储装配工厂 —— context.ts 的实现细节
 * ---------------------------------------------------------------------------
 * createRepositoriesFor(kind) 返回：
 *   - repos：满足领域接口的仓储集合（接口见 src/domain/repositories.ts）
 *   - transaction：与业务层 `transaction((repos) => Promise<T>)` 对齐
 *   - info：存储元信息
 *
 * PostgreSQL 路径完全沿用现有 Prisma 适配器，一行未改；
 * SQLite 路径先初始化，再装配已完成的真实仓储与 SessionStore。
 */

/** 标记仓储集合归属的非枚举属性（测试用它确认「真正装配的是哪套实现」） */
const STORAGE_BRAND = "__storageBrand";
export type StorageBrand = "prisma-postgresql" | "sqlite";

export interface StorageBrandOf {
  [STORAGE_BRAND]?: StorageBrand;
}

/** 读取仓储集合的装配标识 */
export function storageBrandOf(repos: Repositories): StorageBrand | undefined {
  return (repos as Repositories & StorageBrandOf)[STORAGE_BRAND];
}

function markBrand(repos: Repositories, brand: StorageBrand): Repositories {
  return Object.defineProperty(repos, STORAGE_BRAND, {
    value: brand,
    enumerable: false,
    configurable: false,
    writable: false,
  }) as Repositories;
}

interface AssembledStorage {
  repos: Repositories;
  sessionStore: SessionStore;
  transaction: <T>(fn: (repos: Repositories) => Promise<T>) => Promise<T>;
  info: StorageInfo;
}

/** PostgreSQL：现有 Prisma 适配器原样装配 */
function assemblePostgres(): AssembledStorage {
  const repos = markBrand(createRepositories(prisma), "prisma-postgresql");
  return {
    repos,
    sessionStore: withTranslatedErrors(createPrismaSessionStore(prisma)),
    transaction: <T>(fn: (repos: Repositories) => Promise<T>) =>
      prisma.$transaction((tx) => fn(createRepositories(tx))),
    info: storageInfoOf("postgres", null),
  };
}

/** SQLite：先初始化（PRAGMA + migration），再装配占位仓储 */
function assembleSqlite(): AssembledStorage {
  const db: DatabaseSync = initSqliteDb();
  const repos = markBrand(createSqliteRepositories(db), "sqlite");
  return {
    repos,
    sessionStore: withSqliteErrorTranslation(createSqliteSessionStore(db)),
    transaction: <T>(fn: (repos: Repositories) => Promise<T>) =>
      runInTransaction(db, () => fn(repos)),
    info: storageInfoOf("sqlite", resolveDbPath()),
  };
}

export function createRepositoriesFor(kind: StorageKind): AssembledStorage {
  return kind === "postgres" ? assemblePostgres() : assembleSqlite();
}

/** 未实现占位的稳定错误码，转发给测试用 */
export { SQLITE_NOT_IMPLEMENTED };
