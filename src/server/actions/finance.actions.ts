"use server";

import { expenseSchema } from "@/lib/validation/work-order";
import { requireAdminAction, requireUserAction } from "@/server/auth/guard";
import { safeAction } from "@/server/errors";
import {
  createExpense,
  deleteExpense,
  getFinanceSummary,
  listCashFlow,
  listExpenses,
  listPayments,
  updateExpense,
  voidPayment,
} from "@/server/services/finance.service";
import { parseOrThrow } from "@/server/validate";
import {
  revalidateBusiness,
  revalidateFinance,
  revalidateWorkOrder,
} from "@/server/actions/revalidate";
import type { ActionResult } from "@/types";

/** 登记支出（所有角色可用：员工也能登记自己垫付的采购） */
export async function createExpenseAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(expenseSchema, input);
    const created = await createExpense(data, user);
    revalidateFinance();
    return { id: created.id };
  });
}

export async function updateExpenseAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(expenseSchema, input);
    await updateExpense(id, data, user);
    revalidateFinance();
    return { id };
  });
}

export async function deleteExpenseAction(id: string): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    await deleteExpense(id, user);
    revalidateFinance();
    return { id };
  });
}

/** 作废收款（仅管理员） */
export async function voidPaymentAction(
  id: string,
  reason: string,
  workOrderId?: string,
): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireAdminAction();
    await voidPayment(id, reason, user);
    revalidateFinance();
    if (workOrderId) revalidateWorkOrder(workOrderId);
    else revalidateBusiness();
    return { id };
  });
}

/** 财务流水查询（管理员） */
export async function listCashFlowAction(
  from: string,
  to: string,
  page: number,
  keyword?: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listCashFlow>>>> {
  return safeAction(async () => {
    await requireAdminAction();
    return listCashFlow({
      from: new Date(from),
      to: new Date(to),
      page,
      pageSize: 20,
      keyword,
    });
  });
}

export async function listExpensesAction(
  from: string,
  to: string,
  page: number,
  keyword?: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listExpenses>>>> {
  return safeAction(async () => {
    await requireAdminAction();
    return listExpenses({ from: new Date(from), to: new Date(to), page, pageSize: 20, keyword });
  });
}

export async function listPaymentsAction(
  from: string,
  to: string,
  page: number,
  keyword?: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listPayments>>>> {
  return safeAction(async () => {
    await requireAdminAction();
    return listPayments({ from: new Date(from), to: new Date(to), page, pageSize: 20, keyword });
  });
}

export async function getFinanceSummaryAction(
  from: string,
  to: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getFinanceSummary>>>> {
  return safeAction(async () => {
    await requireAdminAction();
    return getFinanceSummary(new Date(from), new Date(to));
  });
}
