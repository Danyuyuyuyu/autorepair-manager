import type { InventoryRepository, LockedInventoryRow } from "@/domain/repositories";
import { inventoryTxSelect } from "@/server/selects";

import type { RepoClient } from "./client";

// ---------------------------------------------------------------------------
// 库存
// ---------------------------------------------------------------------------

export function createInventoryRepository(client: RepoClient): InventoryRepository {
  return {
    async lockOrCreate(partId) {
      // 先加排他锁再读：避免两个工单同时出库同一配件造成超卖。
      // 这条 SQL 是 PostgreSQL 特有的，SQLite 实现将改为写事务串行化
      // （SQLite 单写者模型天然互斥，不需要 FOR UPDATE）。
      const rows = await client.$queryRaw<LockedInventoryRow[]>`
        SELECT id, quantity, "avgCost", "safeQuantity"
        FROM inventories
        WHERE "partId" = ${partId}
        FOR UPDATE
      `;

      const existing = rows[0];
      if (existing) return existing;

      // 库存行不存在（配件为历史数据或初始化异常）时补建
      const created = await client.inventory.create({
        data: { partId, quantity: 0, safeQuantity: 0, avgCost: 0 },
      });
      return {
        id: created.id,
        quantity: created.quantity,
        avgCost: created.avgCost,
        safeQuantity: created.safeQuantity,
      };
    },

    async applyChange(partId, patch) {
      await client.inventory.update({
        where: { partId },
        data: { quantity: patch.quantity, avgCost: patch.avgCost },
      });
    },

    async appendTransaction(data) {
      return client.inventoryTransaction.create({
        data: {
          partId: data.partId,
          type: data.type,
          quantity: data.quantity,
          qtyBefore: data.qtyBefore,
          qtyAfter: data.qtyAfter,
          unitCost: data.unitCost ?? null,
          amount: data.amount ?? null,
          workOrderId: data.workOrderId ?? null,
          operatorId: data.operatorId ?? null,
          remark: data.remark ?? null,
        },
        select: { id: true },
      });
    },

    async listTransactions(filter, paging) {
      const where = {
        ...(filter.partId ? { partId: filter.partId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
      };

      const [rows, total] = await Promise.all([
        client.inventoryTransaction.findMany({
          where,
          select: inventoryTxSelect,
          orderBy: { createdAt: "desc" },
          skip: paging.skip,
          take: paging.take,
        }),
        client.inventoryTransaction.count({ where }),
      ]);
      return { rows, total };
    },

    async listValuationLines() {
      const rows = await client.inventory.findMany({
        select: {
          quantity: true,
          avgCost: true,
          part: { select: { costPrice: true, deletedAt: true } },
        },
      });

      return rows.map((row) => ({
        quantity: row.quantity,
        avgCost: row.avgCost,
        partCostPrice: row.part.costPrice,
        partDeletedAt: row.part.deletedAt,
      }));
    },

    async detachWorkOrder(workOrderId) {
      await client.inventoryTransaction.updateMany({
        where: { workOrderId },
        data: { workOrderId: null },
      });
    },
  };
}
