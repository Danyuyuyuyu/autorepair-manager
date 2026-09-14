import "server-only";

import type { Repositories } from "@/domain/repositories";
import type { ExpenseCategory, IncomeCategory } from "@/domain/enums";
import { money, outstanding, sumMoney } from "@/lib/money";
import { writeAuditLog } from "@/server/auth/audit";
import { repos as defaultRepos, transaction } from "@/server/context";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/server/errors";
import { toExpense, toPayment } from "@/server/serializers";
import type { CurrentUser, ExpenseDTO, Paginated, PaymentDTO } from "@/types";

/**
 * 财务服务
 * ---------------------------------------------------------------------------
 * 【改造说明】取数与落库全部改为通过 `Repositories`，本文件不再 import Prisma。
 *
 * **业务含义一行未改**：应收 / 已收 / 未收 / 营业额 / 成本 / 利润的口径完全保持原样。
 * 尤其注意：
 *   - `paidAmount` 始终由 `sumPaymentsByWorkOrder` 重新汇总，不做手工累加；
 *   - 毛利 = 营业收入 − 配件成本；净利 = 营业收入 − 全部支出（营业额 ≠ 利润）。
 */

// ---------------------------------------------------------------------------
// 收款
// ---------------------------------------------------------------------------

export interface PaymentInput {
  workOrderId?: string;
  customerId?: string;
  amount: string;
  method: "CASH" | "WECHAT" | "ALIPAY" | "BANK_CARD" | "OTHER";
  category: IncomeCategory;
  occurredAt: Date;
  remark?: string;
}

/**
 * 登记收款。
 * paidAmount 始终由 payments 汇总重算，避免手工累加产生漂移。
 */
export async function addPayment(
  input: PaymentInput,
  user: CurrentUser,
): Promise<{ paymentId: string; orderNo: string | null }> {
  const amount = money(input.amount);
  if (amount.lte(0)) throw new BusinessRuleError("收款金额必须大于 0。");

  let customerId = input.customerId ?? null;
  const workOrderId = input.workOrderId;

  const result = await transaction(async (tx) => {
    let orderNo: string | null = null;

    if (workOrderId) {
      const order = await tx.workOrder.findForPayment(workOrderId);
      if (!order) throw new NotFoundError("工单不存在或已被删除。");
      if (order.status === "CANCELLED") {
        throw new BusinessRuleError("已取消的工单不能收款。");
      }
      customerId = order.customerId;
      orderNo = order.orderNo;
    }

    const payment = await tx.finance.createPayment({
      workOrderId: workOrderId ?? null,
      customerId,
      source: workOrderId ? "WORK_ORDER" : "MANUAL",
      category: input.category,
      amount,
      method: input.method,
      occurredAt: input.occurredAt,
      operatorId: user.id,
      remark: input.remark || null,
    });

    if (workOrderId) {
      const paid = await tx.finance.sumPaymentsByWorkOrder(workOrderId);
      await tx.workOrder.setPaidAmount(workOrderId, money(paid));
    }

    return { paymentId: payment.id, orderNo };
  });

  await writeAuditLog({
    user,
    action: "PAYMENT_CREATE",
    entity: workOrderId ? "work_order" : "payment",
    entityId: workOrderId ?? result.paymentId,
    summary: `登记收款 ${amount.toFixed(2)} 元${result.orderNo ? ` · ${result.orderNo}` : ""}`,
    after: { amount: amount.toFixed(2), method: input.method, category: input.category },
  });

  return result;
}

/** 作废收款（仅管理员，软删除，保留痕迹） */
export async function voidPayment(
  id: string,
  reason: string,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  if (!user.isAdmin) throw new ForbiddenError("只有管理员可以作废收款记录。");

  const payment = await repos.finance.findPaymentForVoid(id);
  if (!payment) throw new NotFoundError("收款记录不存在。");

  await transaction(async (tx) => {
    await tx.finance.voidPayment(
      id,
      `${payment.remark ? `${payment.remark} | ` : ""}作废：${reason}`,
    );

    if (payment.workOrderId) {
      const paid = await tx.finance.sumPaymentsByWorkOrder(payment.workOrderId);
      await tx.workOrder.setPaidAmount(payment.workOrderId, money(paid));
    }
  });

  await writeAuditLog({
    user,
    action: "PAYMENT_DELETE",
    entity: "payment",
    entityId: id,
    summary: `作废收款 ${money(payment.amount).toFixed(2)} 元：${reason}`,
    before: { amount: money(payment.amount).toFixed(2), workOrderId: payment.workOrderId },
  });

  return { id };
}

/** 重算工单已收金额（修复历史数据用） */
export async function recalcOrderPaid(workOrderId: string, repos: Repositories = defaultRepos) {
  const paid = await repos.finance.sumPaymentsByWorkOrder(workOrderId);
  await repos.workOrder.setPaidAmount(workOrderId, money(paid));
  return money(paid).toFixed(2);
}

export interface FinanceQuery {
  from: Date;
  to: Date;
  page: number;
  pageSize: number;
  keyword?: string;
}

export async function listPayments(
  query: FinanceQuery,
  repos: Repositories = defaultRepos,
): Promise<Paginated<PaymentDTO>> {
  const { rows, total } = await repos.finance.listPayments(
    { from: query.from, to: query.to, keyword: query.keyword },
    { skip: (query.page - 1) * query.pageSize, take: query.pageSize },
  );

  return {
    items: rows.map(toPayment),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

// ---------------------------------------------------------------------------
// 支出
// ---------------------------------------------------------------------------

export interface ExpenseInput {
  category: ExpenseCategory;
  amount: string;
  method: "CASH" | "WECHAT" | "ALIPAY" | "BANK_CARD" | "OTHER";
  occurredAt: Date;
  supplierId?: string;
  workOrderId?: string;
  remark?: string;
}

export async function createExpense(
  input: ExpenseInput,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const amount = money(input.amount);
  if (amount.lte(0)) throw new BusinessRuleError("支出金额必须大于 0。");

  const created = await repos.finance.createExpense({
    category: input.category,
    amount,
    method: input.method,
    occurredAt: input.occurredAt,
    supplierId: input.supplierId || null,
    workOrderId: input.workOrderId || null,
    operatorId: user.id,
    remark: input.remark || null,
  });

  await writeAuditLog({
    user,
    action: "EXPENSE_CREATE",
    entity: "expense",
    entityId: created.id,
    summary: `登记支出 ${amount.toFixed(2)} 元（${input.category}）`,
    after: { amount: amount.toFixed(2), category: input.category },
  });

  return created;
}

export async function updateExpense(
  id: string,
  input: ExpenseInput,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const existing = await repos.finance.findExpenseForEdit(id);
  if (!existing) throw new NotFoundError("支出记录不存在。");

  await repos.finance.updateExpense(id, {
    category: input.category,
    amount: money(input.amount),
    method: input.method,
    occurredAt: input.occurredAt,
    supplierId: input.supplierId || null,
    workOrderId: input.workOrderId || null,
    remark: input.remark || null,
  });

  await writeAuditLog({
    user,
    action: "EXPENSE_UPDATE",
    entity: "expense",
    entityId: id,
    summary: `修改支出 ${money(input.amount).toFixed(2)} 元`,
    before: {
      ...existing,
      amount: money(existing.amount).toFixed(2),
      occurredAt: existing.occurredAt,
    },
    after: { ...input, amount: money(input.amount).toFixed(2) },
  });

  return { id };
}

export async function deleteExpense(
  id: string,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  if (!user.isAdmin) throw new ForbiddenError("只有管理员可以删除支出记录。");

  const existing = await repos.finance.findExpenseForDelete(id);
  if (!existing) throw new NotFoundError("支出记录不存在。");

  await repos.finance.softDeleteExpense(id);

  await writeAuditLog({
    user,
    action: "EXPENSE_DELETE",
    entity: "expense",
    entityId: id,
    summary: `删除支出 ${money(existing.amount).toFixed(2)} 元（${existing.category}）`,
    before: existing,
  });

  return { id };
}

export async function listExpenses(
  query: FinanceQuery,
  repos: Repositories = defaultRepos,
): Promise<Paginated<ExpenseDTO>> {
  const { rows, total } = await repos.finance.listExpenses(
    { from: query.from, to: query.to, keyword: query.keyword },
    { skip: (query.page - 1) * query.pageSize, take: query.pageSize },
  );

  return {
    items: rows.map(toExpense),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/** 统一流水视图（收入 + 支出合并，按时间倒序） */
export interface CashFlowEntry {
  id: string;
  kind: "INCOME" | "EXPENSE";
  categoryLabel: string;
  amount: string;
  method: string;
  occurredAt: string;
  workOrderId: string | null;
  workOrderNo: string | null;
  operatorName: string | null;
  remark: string | null;
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

export interface FinanceSummary {
  income: string;
  expense: string;
  profit: string;
  partsCost: string;
  grossProfit: string;
  grossMarginRate: number;
  orderCount: number;
  incomeByCategory: Array<{ category: IncomeCategory; amount: string; count: number }>;
  expenseByCategory: Array<{ category: ExpenseCategory; amount: string; count: number }>;
  incomeByMethod: Array<{ method: string; amount: string; count: number }>;
}

/**
 * 财务汇总。
 * 注意：营业额 ≠ 利润。
 *   grossProfit（毛利）= 营业收入 - 配件成本
 *   profit（净利）  = 营业收入 - 全部支出
 */
export async function getFinanceSummary(
  from: Date,
  to: Date,
  repos: Repositories = defaultRepos,
): Promise<FinanceSummary> {
  const [incomeGroups, expenseGroups, incomeByMethod, orderStats] = await Promise.all([
    repos.finance.groupPaymentsByCategory(from, to),
    repos.finance.groupExpensesByCategory(from, to),
    repos.finance.groupPaymentsByMethod(from, to),
    repos.workOrder.aggregateCreatedOrders(from, to),
  ]);

  const income = sumMoney(incomeGroups.map((g) => g.amount ?? 0));
  const expense = sumMoney(expenseGroups.map((g) => g.amount ?? 0));
  const partsCost = money(orderStats.partsCost ?? 0);
  const grossProfit = money(income.minus(partsCost));

  return {
    income: income.toFixed(2),
    expense: expense.toFixed(2),
    profit: money(income.minus(expense)).toFixed(2),
    partsCost: partsCost.toFixed(2),
    grossProfit: grossProfit.toFixed(2),
    grossMarginRate: income.isZero() ? 0 : grossProfit.div(income).toNumber(),
    orderCount: orderStats.orderCount,
    incomeByCategory: incomeGroups
      .map((g) => ({
        category: g.category,
        amount: money(g.amount ?? 0).toFixed(2),
        count: g.count,
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
    expenseByCategory: expenseGroups
      .map((g) => ({
        category: g.category,
        amount: money(g.amount ?? 0).toFixed(2),
        count: g.count,
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
    incomeByMethod: incomeByMethod
      .map((g) => ({
        method: g.method,
        amount: money(g.amount ?? 0).toFixed(2),
        count: g.count,
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
  };
}

/** 应收 / 欠款总额 */
export async function getReceivablesTotal(repos: Repositories = defaultRepos): Promise<string> {
  const rows = await repos.workOrder.listOpenOrderBalances();
  return sumMoney(rows.map((row) => outstanding(row.totalAmount, row.paidAmount))).toFixed(2);
}

/** 统一流水（分页合并收入与支出） */
export async function listCashFlow(
  query: FinanceQuery,
  repos: Repositories = defaultRepos,
): Promise<Paginated<CashFlowEntry>> {
  const [{ items: payments }, { items: expenses }] = await Promise.all([
    listPayments({ ...query, page: 1, pageSize: 500 }, repos),
    listExpenses({ ...query, page: 1, pageSize: 500 }, repos),
  ]);

  const merged: CashFlowEntry[] = [
    ...payments.map((p) => ({
      id: p.id,
      kind: "INCOME" as const,
      categoryLabel: p.category,
      amount: p.amount,
      method: p.method,
      occurredAt: p.occurredAt,
      workOrderId: p.workOrderId,
      workOrderNo: p.workOrderNo,
      operatorName: p.operatorName,
      remark: p.remark,
    })),
    ...expenses.map((e) => ({
      id: e.id,
      kind: "EXPENSE" as const,
      categoryLabel: e.category,
      amount: e.amount,
      method: e.method,
      occurredAt: e.occurredAt,
      workOrderId: e.workOrderId,
      workOrderNo: null,
      operatorName: e.operatorName,
      remark: e.remark ?? e.supplierName,
    })),
  ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const start = (query.page - 1) * query.pageSize;
  const items = merged.slice(start, start + query.pageSize);

  return {
    items,
    total: merged.length,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(merged.length / query.pageSize)),
  };
}

/** 工单欠款明细（用于收款页与首页「待收款」） */
export async function getWorkOrderBalance(workOrderId: string, repos: Repositories = defaultRepos) {
  const order = await repos.workOrder.findBalance(workOrderId);
  if (!order) throw new NotFoundError("工单不存在。");
  return {
    total: money(order.totalAmount).toFixed(2),
    paid: money(order.paidAmount).toFixed(2),
    outstanding: outstanding(order.totalAmount, order.paidAmount).toFixed(2),
  };
}

/** 财务模块需要管理员权限的入口（供 action 复用） */
export async function assertFinanceAccess(user: CurrentUser) {
  if (!user.isAdmin) throw new ForbiddenError("没有权限查看财务数据。");
  return user;
}
