"use server";

import {
  changeStatusSchema,
  createWorkOrderSchema,
  paymentSchema,
  quickDiscountSchema,
  updateWorkOrderSchema,
  workOrderItemSchema,
} from "@/lib/validation/work-order";
import { requireUserAction } from "@/server/auth/guard";
import { safeAction } from "@/server/errors";
import { addPayment } from "@/server/services/finance.service";
import {
  addWorkOrderItem,
  cancelWorkOrder,
  changeWorkOrderStatus,
  createWorkOrder,
  deleteWorkOrder,
  removeWorkOrderItem,
  updateDiscount,
  updateWorkOrder,
  updateWorkOrderItem,
} from "@/server/services/work-order.service";
import { parseOrThrow } from "@/server/validate";
import { revalidateBusiness, revalidateWorkOrder } from "@/server/actions/revalidate";
import type { ActionResult, WorkOrderDetailDTO } from "@/types";

export async function createWorkOrderAction(
  input: unknown,
): Promise<ActionResult<{ id: string; orderNo: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(createWorkOrderSchema, input);
    const created = await createWorkOrder(data, user);
    revalidateWorkOrder(created.id);
    return created;
  });
}

export async function updateWorkOrderAction(
  input: unknown,
): Promise<ActionResult<WorkOrderDetailDTO>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(updateWorkOrderSchema, input);
    const detail = await updateWorkOrder(data, user);
    revalidateWorkOrder(data.id);
    return detail;
  });
}

export async function updateDiscountAction(
  input: unknown,
): Promise<ActionResult<WorkOrderDetailDTO>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(quickDiscountSchema, input);
    const detail = await updateDiscount(data, user);
    revalidateWorkOrder(data.id);
    return detail;
  });
}

export async function changeWorkOrderStatusAction(
  input: unknown,
): Promise<ActionResult<WorkOrderDetailDTO>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(changeStatusSchema, input);
    const detail = await changeWorkOrderStatus(data, user);
    revalidateWorkOrder(data.id);
    return detail;
  });
}

export async function cancelWorkOrderAction(
  id: string,
  reason: string,
): Promise<ActionResult<WorkOrderDetailDTO>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const detail = await cancelWorkOrder(id, reason, user);
    revalidateWorkOrder(id);
    return detail;
  });
}

export async function deleteWorkOrderAction(id: string): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    await deleteWorkOrder(id, user);
    revalidateBusiness();
    return { id };
  });
}

export async function addWorkOrderItemAction(
  workOrderId: string,
  input: unknown,
): Promise<ActionResult<WorkOrderDetailDTO>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(workOrderItemSchema, input);
    const detail = await addWorkOrderItem({ workOrderId, ...data }, user);
    revalidateWorkOrder(workOrderId);
    return detail;
  });
}

export async function updateWorkOrderItemAction(
  itemId: string,
  workOrderId: string,
  patch: { quantity?: string; unitPrice?: string; remark?: string },
): Promise<ActionResult<WorkOrderDetailDTO>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const detail = await updateWorkOrderItem(itemId, patch, user);
    revalidateWorkOrder(workOrderId);
    return detail;
  });
}

export async function removeWorkOrderItemAction(
  itemId: string,
  workOrderId: string,
): Promise<ActionResult<WorkOrderDetailDTO>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const detail = await removeWorkOrderItem(itemId, user);
    revalidateWorkOrder(workOrderId);
    return detail;
  });
}

/** 工单详情页直接收款（最常用的收尾动作） */
export async function collectPaymentAction(
  input: unknown,
): Promise<ActionResult<{ paymentId: string; orderNo: string | null }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(paymentSchema, input);
    const result = await addPayment(data, user);
    if (data.workOrderId) revalidateWorkOrder(data.workOrderId);
    revalidateBusiness();
    return result;
  });
}
