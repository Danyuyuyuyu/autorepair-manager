import type { Repositories } from "@/domain/repositories";

import { createAuditRepository } from "./audit";
import { createFinanceRepository } from "./finance";
import { createCatalogRepository, createPartRepository } from "./part";
import { createCustomerRepository, createVehicleRepository } from "./party";
import { createInventoryRepository } from "./stock";
import { createUserRepository } from "./user";
import { createWorkOrderItemRepository, createWorkOrderRepository } from "./work-order";
import { withTranslatedErrors, type RepoClient } from "./client";

export type { RepoClient } from "./client";

/**
 * 用指定的 Prisma 客户端组装出全部仓储。
 *
 * 同一个工厂同时服务两种运行形态：
 *   - 普通查询：传 `prisma`（连接池）
 *   - 事务内：传 `tx`（Prisma 的交互式事务客户端）
 * 因此业务层写 `transaction(async (repos) => ...)` 拿到的仓储自动绑定同一事务。
 */
export function createRepositories(client: RepoClient): Repositories {
  return {
    workOrder: withTranslatedErrors(createWorkOrderRepository(client)),
    workOrderItem: withTranslatedErrors(createWorkOrderItemRepository(client)),
    customer: withTranslatedErrors(createCustomerRepository(client)),
    vehicle: withTranslatedErrors(createVehicleRepository(client)),
    inventory: withTranslatedErrors(createInventoryRepository(client)),
    part: withTranslatedErrors(createPartRepository(client)),
    catalog: withTranslatedErrors(createCatalogRepository(client)),
    finance: withTranslatedErrors(createFinanceRepository(client)),
    user: withTranslatedErrors(createUserRepository(client)),
    audit: withTranslatedErrors(createAuditRepository(client)),
  };
}
