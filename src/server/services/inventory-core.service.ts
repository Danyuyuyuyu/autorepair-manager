import "server-only";

import type { Repositories } from "@/domain/repositories";
import type { Money } from "@/domain/entities";
import type { InventoryTxType } from "@/domain/enums";
import { D, money, weightedAverageCost } from "@/lib/money";
import { AppError, BusinessRuleError, NotFoundError } from "@/server/errors";

/**
 * 库存变动核心 —— 全系统唯一的库存写入入口
 * ---------------------------------------------------------------------------
 * 设计：
 * 1. 先对 inventories 行加排他锁（仓储的 `lockOrCreate`），避免并发超卖
 *    - PostgreSQL 实现：`SELECT ... FOR UPDATE`
 *    - SQLite 实现：写事务（BEGIN IMMEDIATE）天然串行化
 * 2. 任何变动都必须写 InventoryTransaction 流水，且记录变动前后数量
 * 3. 出库数量不足时抛 BusinessRuleError，由上层转换为「当前库存不足，无法出库。」
 *
 * 注意：本模块的函数**必须在事务中调用**（`transaction()` 回调里的 repos），
 * 否则行锁会在语句结束后立即释放，失去防超卖的意义。
 *
 * 【改造说明】原先本模块直接接收 Prisma 的 `TxClient`，现在接收 `Repositories`。
 * 库存算法（加权平均成本、负库存拦截、流水留痕）一行未改，只是取数来源可替换。
 */

export interface StockChangeInput {
  partId: string;
  type: InventoryTxType;
  /** 正数表示入库，负数表示出库；方向由 type 语义决定，此处只表达增减 */
  deltaQuantity: number | string;
  /** 入库时的进价（用于移动加权平均成本） */
  unitCost?: number | string | null;
  workOrderId?: string | null;
  operatorId?: string | null;
  remark?: string | null;
  /** 是否允许库存变为负数（默认不允许） */
  allowNegative?: boolean;
}

export interface StockChangeResult {
  partId: string;
  qtyBefore: string;
  qtyAfter: string;
  avgCost: string;
  transactionId: string;
}

/** 执行一次库存变动（必须在事务中调用） */
export async function applyStockChange(
  repos: Repositories,
  input: StockChangeInput,
): Promise<StockChangeResult> {
  const delta = D(input.deltaQuantity);
  if (delta.isZero()) {
    throw new AppError("库存变动数量不能为 0。", "STOCK_NOOP");
  }

  const locked = await repos.inventory.lockOrCreate(input.partId);
  const qtyBefore = D(locked.quantity);
  const qtyAfter = qtyBefore.plus(delta);

  if (qtyAfter.isNegative() && !input.allowNegative) {
    throw new BusinessRuleError(
      `当前库存不足，无法出库。（现有 ${qtyBefore.toFixed(2)}，需要 ${delta.abs().toFixed(2)}）`,
    );
  }

  // 入库且提供了进价 -> 重算移动加权平均成本
  let avgCost = D(locked.avgCost);
  if (delta.isPositive() && input.unitCost !== null && input.unitCost !== undefined) {
    avgCost = weightedAverageCost(qtyBefore, avgCost, delta, input.unitCost);
  }

  const unitCost: Money | null =
    input.unitCost === null || input.unitCost === undefined ? null : money(input.unitCost);

  const created = await repos.inventory.appendTransaction({
    partId: input.partId,
    type: input.type,
    quantity: money(delta.abs()),
    qtyBefore: money(qtyBefore),
    qtyAfter: money(qtyAfter),
    unitCost: unitCost ?? money(avgCost),
    amount: money(delta.abs().times(unitCost ?? avgCost)),
    workOrderId: input.workOrderId ?? null,
    operatorId: input.operatorId ?? null,
    remark: input.remark ?? null,
  });

  await repos.inventory.applyChange(input.partId, {
    quantity: money(qtyAfter),
    avgCost: money(avgCost),
  });

  return {
    partId: input.partId,
    qtyBefore: qtyBefore.toFixed(2),
    qtyAfter: qtyAfter.toFixed(2),
    avgCost: avgCost.toFixed(2),
    transactionId: created.id,
  };
}

/** 工单配件出库（在同一事务中调用，避免与工单写入脱节） */
export async function consumeForWorkOrder(
  repos: Repositories,
  params: {
    partId: string;
    quantity: string | number;
    workOrderId: string;
    operatorId: string;
    partName?: string;
  },
) {
  return applyStockChange(repos, {
    partId: params.partId,
    type: "WORKORDER_OUT",
    deltaQuantity: `-${D(params.quantity).abs().toString()}`,
    workOrderId: params.workOrderId,
    operatorId: params.operatorId,
    remark: `工单出库${params.partName ? ` · ${params.partName}` : ""}`,
  });
}

/** 工单退单 / 取消时回滚入库 */
export async function returnForWorkOrder(
  repos: Repositories,
  params: {
    partId: string;
    quantity: string | number;
    workOrderId: string;
    operatorId: string;
    partName?: string;
  },
) {
  return applyStockChange(repos, {
    partId: params.partId,
    type: "RETURN_IN",
    deltaQuantity: D(params.quantity).abs().toString(),
    workOrderId: params.workOrderId,
    operatorId: params.operatorId,
    remark: `工单退料回滚${params.partName ? ` · ${params.partName}` : ""}`,
  });
}

/** 读取某配件的当前库存（加锁版本，事务内使用） */
export async function getLockedQuantity(repos: Repositories, partId: string): Promise<string> {
  const locked = await repos.inventory.lockOrCreate(partId);
  return D(locked.quantity).toFixed(2);
}

/**
 * 读取配件成本单价（出库记账用）。
 * 规则：优先库存移动加权均价，均价为 0 时回退到最近进货价。
 */
export async function getPartUnitCost(repos: Repositories, partId: string): Promise<string> {
  const part = await repos.part.findUnitCost(partId);
  if (!part) throw new NotFoundError("配件不存在或已被删除。");
  const avg = D(part.avgCost ?? 0);
  return (avg.isZero() ? D(part.costPrice) : avg).toFixed(2);
}
