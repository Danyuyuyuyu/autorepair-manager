import "server-only";

import type { Repositories } from "@/domain/repositories";
import type { CategoryKind } from "@/domain/enums";
import { INVENTORY_TX_TYPES } from "@/domain/enums";
import { D, money, sumMoney } from "@/lib/money";
import { writeAuditLog } from "@/server/auth/audit";
import { repos as defaultRepos, transaction } from "@/server/context";
import { BusinessRuleError, NotFoundError } from "@/server/errors";
import { applyStockChange } from "@/server/services/inventory-core.service";
import { toInventoryTx, toPartListItem } from "@/server/serializers";
import type { CurrentUser, InventoryTxDTO, Paginated, PartListItemDTO } from "@/types";

/**
 * 库存 / 配件服务
 * ---------------------------------------------------------------------------
 * 【改造说明】本文件原先直接使用 Prisma 客户端（含 4 处借用事务客户端的过渡桥接），
 * 现在全部改为通过 `Repositories`，过渡桥接已彻底移除。
 *
 * 事务仍然由 `transaction(async (tx) => ...)` 提供，`tx` 是同一事务上的仓储集合 ——
 * 「库存变动 + 配件档案 + 支出流水」这类多表写入始终在同一个事务内完成。
 * 加锁语义未变：`applyStockChange` 内部仍先取库存行排他锁（PostgreSQL `FOR UPDATE`）。
 */

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export interface PartQuery {
  q?: string;
  categoryId?: string;
  stock?: "all" | "low" | "zero";
  includeInactive?: boolean;
  page: number;
  pageSize: number;
}

export async function listParts(
  query: PartQuery,
  repos: Repositories = defaultRepos,
): Promise<Paginated<PartListItemDTO>> {
  const { q, categoryId, stock = "all", includeInactive = false, page, pageSize } = query;

  const { rows, total } = await repos.part.list(
    {
      keyword: q,
      categoryId,
      includeInactive,
      zeroStockOnly: stock === "zero",
      hasInventoryRowOnly: stock === "low",
    },
    { skip: (page - 1) * pageSize, take: pageSize },
  );

  let items = rows.map(toPartListItem);
  // 低库存筛选在领域层完成（「库存数量 < 安全库存」是列间比较，不适合下沉到 SQL）
  if (stock === "low") items = items.filter((item) => item.isLowStock);

  const effectiveTotal = stock === "low" ? items.length : total;

  return {
    items,
    total: effectiveTotal,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(effectiveTotal / pageSize)),
  };
}

export async function getPartDetail(id: string, repos: Repositories = defaultRepos) {
  const part = await repos.part.findDetail(id);
  if (!part) throw new NotFoundError("配件不存在或已被删除。");

  const [transactions, sold] = await Promise.all([
    repos.inventory.listTransactions({ partId: id }, { skip: 0, take: 30 }),
    repos.workOrderItem.aggregatePartSales(id),
  ]);

  return {
    ...toPartListItem(part),
    supplierId: part.supplierId,
    supplierName: part.supplier?.name ?? null,
    location: part.inventory?.location ?? null,
    remark: part.remark,
    transactions: transactions.rows.map(toInventoryTx),
    soldQuantity: money(sold.totalQuantity ?? 0).toFixed(2),
    soldAmount: money(sold.totalAmount ?? 0).toFixed(2),
    soldCount: sold.orderCount,
  };
}

export async function listInventoryTransactions(
  params: {
    partId?: string;
    type?: string;
    page: number;
    pageSize: number;
  },
  repos: Repositories = defaultRepos,
): Promise<Paginated<InventoryTxDTO>> {
  const type = isInventoryTxType(params.type) ? params.type : undefined;

  const { rows, total } = await repos.inventory.listTransactions(
    { partId: params.partId, type },
    { skip: (params.page - 1) * params.pageSize, take: params.pageSize },
  );

  return {
    items: rows.map(toInventoryTx),
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

/** 低库存清单（首页库存预警） */
export async function listLowStockParts(limit = 20, repos: Repositories = defaultRepos) {
  const rows = await repos.part.listLowStockCandidates();

  return rows
    .map(toPartListItem)
    .filter((item) => item.isLowStock)
    .sort((a, b) => Number(a.quantity) - Number(b.quantity))
    .slice(0, limit);
}

export async function countLowStockParts(repos: Repositories = defaultRepos): Promise<number> {
  const rows = await repos.part.listLowStockCandidates();
  return rows.filter((row) =>
    D(row.inventory?.quantity ?? 0).lt(D(row.inventory?.safeQuantity ?? 0)),
  ).length;
}

/** 启用中的配件总数（库存页概览；已停用与已删除的不计） */
export async function countActiveParts(repos: Repositories = defaultRepos): Promise<number> {
  return repos.part.countActive();
}

/** 库存总金额（报表用） */
export async function getStockValue(repos: Repositories = defaultRepos): Promise<string> {
  const lines = await repos.inventory.listValuationLines();

  return sumMoney(
    lines
      .filter((line) => !line.partDeletedAt)
      .map((line) => {
        const avg = D(line.avgCost);
        const cost = avg.isZero() ? D(line.partCostPrice) : avg;
        return cost.times(D(line.quantity));
      }),
  ).toFixed(2);
}

// ---------------------------------------------------------------------------
// 配件档案
// ---------------------------------------------------------------------------

export interface PartInput {
  code?: string;
  name: string;
  spec?: string;
  brand?: string;
  unit: string;
  categoryId?: string;
  supplierId?: string;
  costPrice: string;
  salePrice: string;
  safeQuantity: string;
  location?: string;
  remark?: string;
  initialQuantity?: string;
}

/** 建档配件：档案 + 库存行 + 期初入库流水在同一事务内完成 */
export async function createPart(input: PartInput, user: CurrentUser) {
  const created = await transaction(async (tx) => {
    const part = await tx.part.createWithInventory(
      {
        code: input.code || null,
        name: input.name,
        spec: input.spec || null,
        brand: input.brand || null,
        unit: input.unit,
        categoryId: input.categoryId || null,
        supplierId: input.supplierId || null,
        costPrice: money(input.costPrice),
        salePrice: money(input.salePrice),
        remark: input.remark || null,
      },
      { safeQuantity: money(input.safeQuantity), location: input.location || null },
    );

    const initial = D(input.initialQuantity ?? 0);
    if (initial.gt(0)) {
      await applyStockChange(tx, {
        partId: part.id,
        type: "PURCHASE_IN",
        deltaQuantity: initial.toFixed(2),
        unitCost: input.costPrice,
        operatorId: user.id,
        remark: "建档期初库存",
      });
    }

    return part;
  });

  await writeAuditLog({
    user,
    action: "PART_CREATE",
    entity: "part",
    entityId: created.id,
    summary: `新增配件「${created.name}」`,
    after: { ...input },
  });

  return created;
}

export async function updatePart(
  id: string,
  input: PartInput,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const existing = await repos.part.findForEdit(id);
  if (!existing) throw new NotFoundError("配件不存在或已被删除。");

  await transaction(async (tx) => {
    await tx.part.updateWithInventory(
      id,
      {
        code: input.code || null,
        name: input.name,
        spec: input.spec || null,
        brand: input.brand || null,
        unit: input.unit,
        categoryId: input.categoryId || null,
        supplierId: input.supplierId || null,
        costPrice: money(input.costPrice),
        salePrice: money(input.salePrice),
        remark: input.remark || null,
      },
      { safeQuantity: money(input.safeQuantity), location: input.location || null },
    );
  });

  await writeAuditLog({
    user,
    action: "PART_UPDATE",
    entity: "part",
    entityId: id,
    summary: `修改配件「${input.name}」`,
    before: existing,
    after: input,
  });

  return { id };
}

export async function deletePart(
  id: string,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const part = await repos.part.findForDelete(id);
  if (!part) throw new NotFoundError("配件不存在或已被删除。");

  if (D(part.quantity ?? 0).gt(0)) {
    throw new BusinessRuleError("该配件仍有库存，请先出库或盘点清零后再删除。");
  }

  await repos.part.softDelete(id);

  await writeAuditLog({
    user,
    action: "PART_DELETE",
    entity: "part",
    entityId: id,
    summary: `删除配件「${part.name}」`,
    before: part,
  });

  return { id };
}

// ---------------------------------------------------------------------------
// 库存操作
// ---------------------------------------------------------------------------

export interface PurchaseInInput {
  partId: string;
  quantity: string;
  unitCost: string;
  updateCostPrice: boolean;
  supplierId?: string;
  occurredAt: Date;
  remark?: string;
}

/** 采购入库：同时更新移动加权成本，并按需自动登记一笔采购支出 */
export async function purchaseIn(
  input: PurchaseInInput,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const part = await repos.part.findBrief(input.partId);
  if (!part) throw new NotFoundError("配件不存在或已被删除。");

  const amount = money(D(input.quantity).times(D(input.unitCost)));

  const result = await transaction(async (tx) => {
    const change = await applyStockChange(tx, {
      partId: input.partId,
      type: "PURCHASE_IN",
      deltaQuantity: input.quantity,
      unitCost: input.unitCost,
      operatorId: user.id,
      remark: input.remark || `采购入库 · ${part.name}`,
    });

    if (input.updateCostPrice) {
      await tx.part.updateCostAndSupplier(input.partId, {
        costPrice: money(input.unitCost),
        supplierId: input.supplierId || undefined,
      });
    }

    await tx.finance.createExpense({
      category: "PART_PURCHASE",
      amount,
      method: "CASH",
      occurredAt: input.occurredAt,
      supplierId: input.supplierId || null,
      operatorId: user.id,
      // 把店员填写的备注一并带过去，否则财务只看到「采购入库 xxx」，
      // 无法分辨是补货、退货换货还是替客户代购。
      remark: input.remark
        ? `采购入库 ${part.name} × ${D(input.quantity).toFixed(2)}（${input.remark}）`
        : `采购入库 ${part.name} × ${D(input.quantity).toFixed(2)}`,
    });

    return change;
  });

  await writeAuditLog({
    user,
    action: "STOCK_PURCHASE_IN",
    entity: "part",
    entityId: input.partId,
    summary: `采购入库「${part.name}」${D(input.quantity).toFixed(2)} @ ${money(input.unitCost).toFixed(2)}`,
    before: { quantity: result.qtyBefore },
    after: { quantity: result.qtyAfter, amount: amount.toFixed(2) },
  });

  return result;
}

export interface AdjustStockInput {
  partId: string;
  targetQuantity: string;
  unitCost?: string;
  remark: string;
}

/** 库存调整：以「目标数量」为准，系统算出差额并留痕 */
export async function adjustStock(
  input: AdjustStockInput,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const part = await repos.part.findStockLevel(input.partId);
  if (!part) throw new NotFoundError("配件不存在或已被删除。");

  const current = D(part.quantity ?? 0);
  const target = money(input.targetQuantity);
  const delta = target.minus(current);

  if (delta.isZero()) {
    throw new BusinessRuleError("调整后数量与当前库存一致，无需调整。");
  }

  const result = await transaction(async (tx) =>
    applyStockChange(tx, {
      partId: input.partId,
      type: "ADJUST",
      deltaQuantity: delta.toFixed(2),
      unitCost: input.unitCost ?? null,
      operatorId: user.id,
      remark: input.remark,
    }),
  );

  await writeAuditLog({
    user,
    action: "STOCK_ADJUST",
    entity: "part",
    entityId: input.partId,
    summary: `调整库存「${part.name}」${current.toFixed(2)} → ${target.toFixed(2)}`,
    before: { quantity: current.toFixed(2) },
    after: { quantity: target.toFixed(2), reason: input.remark },
  });

  return result;
}

export interface StocktakeItem {
  partId: string;
  countedQuantity: string;
}

/** 库存盘点：一次提交多个配件的实盘数量 */
export async function stocktake(
  items: StocktakeItem[],
  remark: string | undefined,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const parts = await repos.part.listStockLevels(items.map((i) => i.partId));
  const map = new Map(parts.map((p) => [p.id, p]));

  const changes: Array<{
    partId: string;
    name: string;
    before: string;
    after: string;
    delta: string;
  }> = [];

  await transaction(async (tx) => {
    for (const item of items) {
      const part = map.get(item.partId);
      if (!part) throw new NotFoundError("盘点清单中包含不存在的配件，请刷新后重试。");

      const before = D(part.quantity ?? 0);
      const counted = money(item.countedQuantity);
      const delta = counted.minus(before);
      if (delta.isZero()) continue;

      await applyStockChange(tx, {
        partId: item.partId,
        type: "STOCKTAKE",
        deltaQuantity: delta.toFixed(2),
        operatorId: user.id,
        remark: remark || `盘点差异修正 · ${part.name}`,
      });

      changes.push({
        partId: item.partId,
        name: part.name,
        before: before.toFixed(2),
        after: counted.toFixed(2),
        delta: delta.toFixed(2),
      });
    }
  });

  await writeAuditLog({
    user,
    action: "STOCK_STOCKTAKE",
    entity: "inventory",
    entityId: items[0]?.partId ?? "batch",
    summary: `库存盘点，调整 ${changes.length} 项`,
    after: { changes, remark },
  });

  return { adjusted: changes.length, changes };
}

// ---------------------------------------------------------------------------
// 基础资料：分类 / 供应商 / 维修项目
// ---------------------------------------------------------------------------

export async function listCategories(kind?: CategoryKind, repos: Repositories = defaultRepos) {
  return repos.catalog.listCategories(kind);
}

export async function createCategory(
  input: { name: string; kind: CategoryKind; sortOrder: number },
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const existing = await repos.catalog.findCategoryByName(input.kind, input.name);
  if (existing) throw new BusinessRuleError("同类型下已存在同名分类。");

  const created = await repos.catalog.createCategory(input);

  await writeAuditLog({
    user,
    action: "SERVICE_ITEM_SAVE",
    entity: "category",
    entityId: created.id,
    summary: `新增分类「${created.name}」`,
  });

  return created;
}

export async function listSuppliers(repos: Repositories = defaultRepos) {
  return repos.catalog.listSuppliers();
}

export async function createSupplier(
  input: { name: string; contact?: string; phone?: string; address?: string; remark?: string },
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const created = await repos.catalog.createSupplier({
    name: input.name,
    contact: input.contact || null,
    phone: input.phone || null,
    address: input.address || null,
    remark: input.remark || null,
  });

  await writeAuditLog({
    user,
    action: "SERVICE_ITEM_SAVE",
    entity: "supplier",
    entityId: created.id,
    summary: `新增供应商「${created.name}」`,
  });

  return created;
}

/** 维修项目 / 工时目录（工单选择器数据源） */
export async function listServiceItems(
  params?: { q?: string; kind?: "SERVICE" | "LABOR"; limit?: number },
  repos: Repositories = defaultRepos,
) {
  const rows = await repos.catalog.listServiceItems({
    keyword: params?.q,
    kind: params?.kind,
    limit: params?.limit ?? 100,
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind === "LABOR" ? ("LABOR" as const) : ("SERVICE" as const),
    unit: row.unit,
    defaultPrice: money(row.defaultPrice).toFixed(2),
    costPrice: money(row.costPrice).toFixed(2),
    categoryName: row.categoryName,
  }));
}

export async function createServiceItem(
  input: {
    code?: string;
    name: string;
    kind: "SERVICE" | "LABOR";
    categoryId?: string;
    unit: string;
    defaultPrice: string;
    defaultHours?: string;
    costPrice: string;
    sortOrder: number;
    remark?: string;
  },
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const created = await repos.catalog.createServiceItem({
    code: input.code || null,
    name: input.name,
    kind: input.kind,
    categoryId: input.categoryId || null,
    unit: input.unit,
    defaultPrice: money(input.defaultPrice),
    defaultHours: input.defaultHours ? money(input.defaultHours) : null,
    costPrice: money(input.costPrice),
    sortOrder: input.sortOrder,
    remark: input.remark || null,
  });

  await writeAuditLog({
    user,
    action: "SERVICE_ITEM_SAVE",
    entity: "service_item",
    entityId: created.id,
    summary: `新增维修项目「${created.name}」`,
    after: input,
  });

  return created;
}

/** 配件选择器：按关键字搜索可用配件 */
export async function searchPartsForPicker(
  q: string,
  limit = 30,
  repos: Repositories = defaultRepos,
) {
  const rows = await repos.part.searchForPicker(q, limit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    spec: row.spec,
    unit: row.unit,
    salePrice: money(row.salePrice).toFixed(2),
    costPrice: money(D(row.avgCost ?? 0).isZero() ? 0 : row.avgCost).toFixed(2),
    stock: money(row.stockQuantity ?? 0).toFixed(2),
  }));
}

function isInventoryTxType(
  value: string | undefined,
): value is "PURCHASE_IN" | "WORKORDER_OUT" | "RETURN_IN" | "ADJUST" | "STOCKTAKE" {
  return value !== undefined && (INVENTORY_TX_TYPES as readonly string[]).includes(value);
}
