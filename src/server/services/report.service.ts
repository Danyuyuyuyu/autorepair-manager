import "server-only";

import type { Repositories } from "@/domain/repositories";
import { D, money, outstanding, sumMoney } from "@/lib/money";
import {
  businessDateKey,
  daysAgoStart,
  endOfBusinessDay,
  endOfBusinessMonth,
  eachDayKey,
  startOfBusinessDay,
  startOfBusinessMonth,
} from "@/utils/date";
import { repos as defaultRepos } from "@/server/context";
import { getFinanceSummary, getReceivablesTotal } from "@/server/services/finance.service";
import { getStockValue } from "@/server/services/inventory.service";
import type { RankingItemDTO, ReportChartsDTO, ReportOverviewDTO, TrendPointDTO } from "@/types";

/**
 * 报表服务
 * ---------------------------------------------------------------------------
 * 【改造说明】取数全部通过 `Repositories`，本文件不再 import Prisma。
 * 按日归集、补零、排行口径、毛利率算法均保持原样（金额仍走 lib/money）。
 */

/** 报表总览（首页 KPI + 报表页头部） */
export async function getReportOverview(
  repos: Repositories = defaultRepos,
): Promise<ReportOverviewDTO> {
  const now = new Date();
  const monthStart = startOfBusinessMonth(now);
  const monthEnd = endOfBusinessMonth(now);
  const todayStart = startOfBusinessDay(now);
  const todayEnd = endOfBusinessDay(now);

  const [
    monthSummary,
    todayIncome,
    customerCount,
    stockValue,
    receivables,
    monthOrderCount,
    itemGroups,
  ] = await Promise.all([
    getFinanceSummary(monthStart, monthEnd, repos),
    repos.finance.sumPaymentsInRange(todayStart, todayEnd),
    repos.customer.countActive(),
    getStockValue(repos),
    getReceivablesTotal(repos),
    repos.workOrder.countCreatedBetween(monthStart, monthEnd, { excludeCancelled: true }),
    repos.workOrderItem.sumAmountByType(monthStart, monthEnd),
  ]);

  const sumOf = (type: "SERVICE" | "PART" | "LABOR") =>
    money(itemGroups.find((g) => g.type === type)?.amount ?? 0);

  const monthRevenue = D(monthSummary.income);
  const partsRevenue = sumOf("PART");
  const partsCost = D(monthSummary.partsCost);
  const grossProfit = monthRevenue.minus(partsCost);

  return {
    todayRevenue: money(todayIncome).toFixed(2),
    monthRevenue: monthRevenue.toFixed(2),
    monthExpense: monthSummary.expense,
    monthProfit: monthSummary.profit,
    monthOrderCount,
    customerCount,
    stockValue,
    outstandingAmount: receivables,
    monthPartsCost: partsCost.toFixed(2),
    monthPartsRevenue: partsRevenue.toFixed(2),
    monthLaborRevenue: sumOf("LABOR").toFixed(2),
    monthServiceRevenue: sumOf("SERVICE").toFixed(2),
    grossProfit: money(grossProfit).toFixed(2),
    grossMarginRate: monthRevenue.isZero() ? 0 : grossProfit.div(monthRevenue).toNumber(),
    receivables,
  };
}

/** 每日营业额 / 收支趋势（默认近 14 天） */
export async function getRevenueTrend(
  days = 14,
  repos: Repositories = defaultRepos,
): Promise<TrendPointDTO[]> {
  const now = new Date();
  const from = daysAgoStart(days - 1, now);
  const to = endOfBusinessDay(now);

  const [payments, expenses, orders] = await Promise.all([
    repos.finance.listPaymentEntries(from, to),
    repos.finance.listExpenseEntries(from, to),
    repos.workOrder.listCreatedDates(from, to),
  ]);

  const keys = eachDayKey(from, new Date(to.getTime() + 1));
  const revenueMap = new Map<string, ReturnType<typeof D>>();
  const expenseMap = new Map<string, ReturnType<typeof D>>();
  const orderMap = new Map<string, number>();

  for (const key of keys) {
    revenueMap.set(key, D(0));
    expenseMap.set(key, D(0));
    orderMap.set(key, 0);
  }

  for (const payment of payments) {
    const key = businessDateKey(payment.occurredAt);
    revenueMap.set(key, (revenueMap.get(key) ?? D(0)).plus(D(payment.amount)));
  }
  for (const expense of expenses) {
    const key = businessDateKey(expense.occurredAt);
    expenseMap.set(key, (expenseMap.get(key) ?? D(0)).plus(D(expense.amount)));
  }
  for (const order of orders) {
    const key = businessDateKey(order.createdAt);
    orderMap.set(key, (orderMap.get(key) ?? 0) + 1);
  }

  return keys.map((key) => {
    const revenue = revenueMap.get(key) ?? D(0);
    const expense = expenseMap.get(key) ?? D(0);
    return {
      date: key,
      revenue: revenue.toFixed(2),
      expense: expense.toFixed(2),
      profit: revenue.minus(expense).toFixed(2),
      orderCount: orderMap.get(key) ?? 0,
    };
  });
}

type RankingType = "SERVICE" | "PART" | "LABOR";

/** 工单项排行（维修项目 / 配件 / 工时通用） */
export async function getItemRanking(
  type: RankingType,
  options?: { from?: Date; to?: Date; limit?: number },
  repos: Repositories = defaultRepos,
): Promise<RankingItemDTO[]> {
  const from = options?.from ?? startOfBusinessMonth();
  const to = options?.to ?? endOfBusinessMonth();
  const limit = options?.limit ?? 10;

  const rows = await repos.workOrderItem.groupByName(type, from, to, limit);

  return rows.map((row) => ({
    name: row.name,
    quantity: money(row.quantity ?? 0).toFixed(2),
    amount: money(row.amount ?? 0).toFixed(2),
    count: row.count,
  }));
}

/** 报表页图表数据一次性返回 */
export async function getReportCharts(
  days = 14,
  repos: Repositories = defaultRepos,
): Promise<ReportChartsDTO> {
  const [trend, serviceRanking, partRanking, monthSummary] = await Promise.all([
    getRevenueTrend(days, repos),
    getItemRanking("SERVICE", { limit: 8 }, repos),
    getItemRanking("PART", { limit: 8 }, repos),
    getFinanceSummary(startOfBusinessMonth(), endOfBusinessMonth(), repos),
  ]);

  return {
    trend,
    serviceRanking,
    partRanking,
    paymentMethodStats: monthSummary.incomeByMethod.map((item) => ({
      method: item.method as ReportChartsDTO["paymentMethodStats"][number]["method"],
      amount: item.amount,
      count: item.count,
    })),
  };
}

/** 按月汇总（管理员自定义区间） */
export async function getRangeSummary(from: Date, to: Date, repos: Repositories = defaultRepos) {
  const [summary, orderCount, newCustomers, receivables, completed] = await Promise.all([
    getFinanceSummary(from, to, repos),
    repos.workOrder.countCreatedBetween(from, to, { excludeCancelled: true }),
    repos.customer.countCreatedBetween(from, to),
    getReceivablesTotal(repos),
    repos.workOrder.findCompletedBetween(from, to),
  ]);

  const completedRevenue = money(completed.totalAmount ?? 0);
  const completedCost = money(completed.partsCost ?? 0);

  return {
    ...summary,
    orderCount,
    newCustomers,
    receivables,
    completedOrderCount: completed.count,
    completedRevenue: completedRevenue.toFixed(2),
    completedPartsCost: completedCost.toFixed(2),
    completedGrossProfit: money(completedRevenue.minus(completedCost)).toFixed(2),
    avgOrderAmount: completed.count
      ? money(completedRevenue.div(completed.count)).toFixed(2)
      : "0.00",
  };
}

/** 支付方式统计（报表页饼图） */
export async function getPaymentMethodStats(
  from?: Date,
  to?: Date,
  repos: Repositories = defaultRepos,
) {
  const start = from ?? startOfBusinessMonth();
  const end = to ?? endOfBusinessMonth();

  const rows = await repos.finance.groupPaymentsByMethod(start, end);
  const total = sumMoney(rows.map((r) => r.amount ?? 0));

  return rows
    .map((row) => ({
      method: row.method,
      amount: money(row.amount ?? 0).toFixed(2),
      count: row.count,
      ratio: total.isZero()
        ? 0
        : D(row.amount ?? 0)
            .div(total)
            .toNumber(),
    }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
}

/** 待收款明细汇总（报表页欠款卡片） */
export async function getOutstandingSummary(repos: Repositories = defaultRepos) {
  const rows = await repos.workOrder.listOpenOrderBalances();

  const total = sumMoney(rows.map((r) => outstanding(r.totalAmount, r.paidAmount)));
  const pending = rows.filter((r) => outstanding(r.totalAmount, r.paidAmount).gt(0));

  return {
    total: total.toFixed(2),
    orderCount: pending.length,
    customerCount: new Set(pending.map((r) => r.customerId)).size,
  };
}
