import type { DatabaseSync } from "node:sqlite";

import type { Repositories } from "@/domain/repositories";
import { createMemoryDb, getInitializedSqliteDb } from "./client";
import { createSqliteCustomerRepository } from "./customer";
import { createSqliteCatalogRepository } from "./catalog";
import { createSqliteAuditRepository } from "./audit";
import { withSqliteErrorTranslation } from "./errors";
import { createSqliteFinanceRepository } from "./finance";
import { createSqlitePartRepository } from "./part";
import { createSqliteInventoryRepository } from "./stock";
import { createSqliteUserRepository } from "./user";
import { createSqliteWorkOrderItemRepository, createSqliteWorkOrderRepository } from "./work-order";
import { createSqliteVehicleRepository } from "./vehicle";

/**
 * SQLite 仓储工厂（阶段 2 · Step 3）
 * ---------------------------------------------------------------------------
 * 本阶段按仓储逐个交付 SQLite 实现，未完成槽位保持 fail-fast。
 * 占位策略：每个槽位是一个「访问即报错」的代理 —— 任何方法调用都会抛出
 * 明确的开发期错误，绝不伪装成可工作的实现，也绝不静默路由到 Prisma。
 *
 * 已完成 Step 3 的仓储从 PLACEHOLDER_KEYS 中移出，接上真实实现即可；
 * context 装配代码不需要改。
 */

/** 仓储键位 → 接口名（错误信息用） */
const REPO_LABELS = {
  workOrder: "WorkOrderRepository",
  workOrderItem: "WorkOrderItemRepository",
  customer: "CustomerRepository",
  vehicle: "VehicleRepository",
  inventory: "InventoryRepository",
  part: "PartRepository",
  catalog: "CatalogRepository",
  finance: "FinanceRepository",
  user: "UserRepository",
  audit: "AuditRepository",
} as const;

export type RepoKey = keyof typeof REPO_LABELS;

/** 尚未实现、仍为占位的仓储键位（Step 3 逐个摘除） */
const PLACEHOLDER_KEYS: readonly RepoKey[] = [];

/** 未实现错误的稳定标识（测试断言用） */
export const SQLITE_NOT_IMPLEMENTED = "SQLITE_REPO_NOT_IMPLEMENTED";

function createPlaceholder(repoKey: RepoKey): unknown {
  const label = REPO_LABELS[repoKey];
  return new Proxy(
    {},
    {
      get() {
        const error = new Error(
          `SQLite repository "${label}" is not implemented yet. (阶段 2 Step 3 将逐个实现)`,
        );
        (error as Error & { code: string }).code = SQLITE_NOT_IMPLEMENTED;
        throw error;
      },
      // 防御 Object.keys / 展开等内省操作假装「可用」
      has() {
        const error = new Error(
          `SQLite repository "${label}" is not implemented yet. (阶段 2 Step 3 将逐个实现)`,
        );
        (error as Error & { code: string }).code = SQLITE_NOT_IMPLEMENTED;
        throw error;
      },
    },
  );
}

/**
 * 创建 SQLite 仓储集合。
 * `db` 参数已保证完成 PRAGMA + migration（getSqliteDb 内部顺序），
 * 未完成槽位仍接收它，真实实现直接沿用同一签名。
 */
export function createSqliteRepositories(db: DatabaseSync): Repositories {
  const repos = {} as Record<RepoKey, unknown>;
  repos.workOrder = withSqliteErrorTranslation(createSqliteWorkOrderRepository(db));
  repos.workOrderItem = withSqliteErrorTranslation(createSqliteWorkOrderItemRepository(db));
  repos.customer = withSqliteErrorTranslation(createSqliteCustomerRepository(db));
  repos.vehicle = withSqliteErrorTranslation(createSqliteVehicleRepository(db));
  repos.part = withSqliteErrorTranslation(createSqlitePartRepository(db));
  repos.inventory = withSqliteErrorTranslation(createSqliteInventoryRepository(db));
  repos.finance = withSqliteErrorTranslation(createSqliteFinanceRepository(db));
  repos.catalog = withSqliteErrorTranslation(createSqliteCatalogRepository(db));
  repos.user = withSqliteErrorTranslation(createSqliteUserRepository(db));
  repos.audit = withSqliteErrorTranslation(createSqliteAuditRepository(db));
  for (const key of PLACEHOLDER_KEYS) {
    repos[key] = createPlaceholder(key);
  }
  return repos as unknown as Repositories;
}

/** Step 3 用：把已实现的键位从占位列表摘除后的剩余数量（测试与进度展示用） */
export function placeholderCount(): number {
  return PLACEHOLDER_KEYS.length;
}

/** 供 context 初始化 SQLite（触发 PRAGMA + migration，保证先于任何仓储查询） */
export function initSqliteDb(): DatabaseSync {
  // `next build` 的静态分析 worker 会加载页面依赖，但不属于应用启动。
  // 给它一次性的内存 schema，避免构建并发触碰真实 SQLite 文件或要求 bootstrap 凭据。
  if (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PRIVATE_BUILD_WORKER === "1"
  ) {
    return createMemoryDb();
  }
  return getInitializedSqliteDb();
}
