"use server";

import {
  adjustStockSchema,
  inventoryQuerySchema,
  partSchema,
  purchaseInSchema,
  serviceItemSchema,
  stocktakeSchema,
  supplierSchema,
} from "@/lib/validation/inventory";
import { requireUserAction } from "@/server/auth/guard";
import { safeAction } from "@/server/errors";
import {
  adjustStock,
  createPart,
  createServiceItem,
  createSupplier,
  deletePart,
  listInventoryTransactions,
  listParts,
  purchaseIn,
  searchPartsForPicker,
  stocktake,
  updatePart,
} from "@/server/services/inventory.service";
import { parseOrThrow } from "@/server/validate";
import { revalidateInventory } from "@/server/actions/revalidate";
import type { ActionResult, InventoryTxDTO, Paginated, PartListItemDTO } from "@/types";

export async function listPartsAction(
  input: unknown,
): Promise<ActionResult<Paginated<PartListItemDTO>>> {
  return safeAction(async () => {
    await requireUserAction();
    const query = parseOrThrow(inventoryQuerySchema, input);
    return listParts(query);
  });
}

export async function createPartAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(partSchema, input);
    const created = await createPart(data, user);
    revalidateInventory();
    return { id: created.id };
  });
}

export async function updatePartAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(partSchema, input);
    await updatePart(id, data, user);
    revalidateInventory();
    return { id };
  });
}

export async function deletePartAction(id: string): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    await deletePart(id, user);
    revalidateInventory();
    return { id };
  });
}

export async function purchaseInAction(input: unknown): Promise<ActionResult<{ partId: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(purchaseInSchema, input);
    const result = await purchaseIn(data, user);
    revalidateInventory();
    return { partId: result.partId };
  });
}

export async function adjustStockAction(input: unknown): Promise<ActionResult<{ partId: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(adjustStockSchema, input);
    const result = await adjustStock(data, user);
    revalidateInventory();
    return { partId: result.partId };
  });
}

export async function stocktakeAction(input: unknown): Promise<ActionResult<{ adjusted: number }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(stocktakeSchema, input);
    const result = await stocktake(data.items, data.remark, user);
    revalidateInventory();
    return { adjusted: result.adjusted };
  });
}

export async function listInventoryTransactionsAction(
  input: unknown,
): Promise<ActionResult<Paginated<InventoryTxDTO>>> {
  return safeAction(async () => {
    await requireUserAction();
    const data = parseOrThrow(
      inventoryQuerySchema.pick({ page: true, pageSize: true }).extend({
        partId: inventoryQuerySchema.shape.categoryId.optional(),
        type: inventoryQuerySchema.shape.stock.optional(),
      }),
      input,
    );
    return listInventoryTransactions({
      partId: data.partId,
      type: data.type,
      page: data.page,
      pageSize: data.pageSize,
    });
  });
}

/** 配件选择器搜索（工单添加配件） */
export async function searchPartsPickerAction(
  q: string,
): Promise<ActionResult<Awaited<ReturnType<typeof searchPartsForPicker>>>> {
  return safeAction(async () => {
    await requireUserAction();
    return searchPartsForPicker(q);
  });
}

export async function createSupplierAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(supplierSchema, input);
    const created = await createSupplier(data, user);
    revalidateInventory();
    return { id: created.id };
  });
}

export async function createServiceItemAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(serviceItemSchema, input);
    const created = await createServiceItem(data, user);
    revalidateInventory();
    return { id: created.id };
  });
}
