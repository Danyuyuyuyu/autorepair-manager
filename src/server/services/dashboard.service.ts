import "server-only";

import type { Repositories } from "@/domain/repositories";
import { D, money, outstanding, sumMoney } from "@/lib/money";
import {
  businessDateKey,
  endOfBusinessDay,
  endOfBusinessMonth,
  startOfBusinessDay,
  startOfBusinessMonth,
} from "@/utils/date";
import { repos as defaultRepos } from "@/server/context";
import { toWorkOrderListItem } from "@/server/serializers";
import { countLowStockParts, getStockValue } from "@/server/services/inventory.service";
import { listDueServiceVehicles } from "@/server/services/vehicle.service";
import type { CurrentUser, DashboardStatsDTO, WorkOrderListItemDTO } from "@/types";

/**
 * 首页数据聚合。
 * 一次调用把首页需要的所有数字算完，避免客户端串行请求。
 *
 * 【改造说明】取数全部通过 `Repositories`，本文件不再 import Prisma。
 * 「未收金额 > 0 才算欠款」「待交车 = 待质检 / 待付款」等口径保持原样，
 * 且仍然用 `lib/money` 的 `outstanding()` 计算，不在 SQL 里重算金额。
 */
export async function getDashboardStats(
  user: CurrentUser,
  repos: Repositories = defaultRepos,
): Promise<DashboardStatsDTO> {
  const now = new Date();
  const todayStart = startOfBusinessDay(now);
  const todayEnd = endOfBusinessDay(now);
  const monthStart = startOfBusinessMonth(now);
  const monthEnd = endOfBusinessMonth(now);

  const [
    todayIncome,
    todayExpense,
    monthIncome,
    monthExpense,
    todayOrders,
    openOrders,
    customerCount,
    stockValue,
    lowStockCount,
  ] = await Promise.all([
    repos.finance.sumPaymentsInRange(todayStart, todayEnd),
    repos.finance.sumExpensesInRange(todayStart, todayEnd),
    repos.finance.sumPaymentsInRange(monthStart, monthEnd),
    repos.finance.sumExpensesInRange(monthStart, monthEnd),
    repos.workOrder.listCreatedBetween(todayStart, todayEnd),
    repos.workOrder.listOpenOrderBalances(),
    repos.customer.countActive(),
    getStockValue(repos),
    countLowStockParts(repos),
  ]);

  const todayRevenue = money(todayIncome);
  const todayExpenseTotal = money(todayExpense);
  const monthRevenue = money(monthIncome);
  const monthExpenseTotal = money(monthExpense);

  const unpaid = openOrders.filter((o) => D(outstanding(o.totalAmount, o.paidAmount)).gt(0));
  const pendingPaymentAmount = sumMoney(
    unpaid.map((o) => outstanding(o.totalAmount, o.paidAmount)),
  );

  const pendingDeliveryCount = openOrders.filter(
    (o) => o.status === "PENDING_QC" || o.status === "PENDING_PAYMENT",
  ).length;

  const financeVisible = user.isAdmin;

  return {
    financeVisible,
    todayRevenue: financeVisible ? todayRevenue.toFixed(2) : "0.00",
    todayExpense: financeVisible ? todayExpenseTotal.toFixed(2) : "0.00",
    todayProfit: financeVisible ? money(todayRevenue.minus(todayExpenseTotal)).toFixed(2) : "0.00",
    monthRevenue: financeVisible ? monthRevenue.toFixed(2) : "0.00",
    monthExpense: financeVisible ? monthExpenseTotal.toFixed(2) : "0.00",
    monthProfit: financeVisible ? money(monthRevenue.minus(monthExpenseTotal)).toFixed(2) : "0.00",
    todayOrderCount: todayOrders.length,
    todayCompletedCount: todayOrders.filter((o) => o.status === "COMPLETED").length,
    pendingPaymentCount: unpaid.length,
    pendingPaymentAmount: financeVisible ? pendingPaymentAmount.toFixed(2) : "0.00",
    pendingDeliveryCount,
    lowStockCount,
    customerCount,
    stockValue: financeVisible ? stockValue : "0.00",
    outstandingAmount: financeVisible ? pendingPaymentAmount.toFixed(2) : "0.00",
  };
}

/** 最近工单（首页） */
export async function getRecentWorkOrders(
  limit = 5,
  repos: Repositories = defaultRepos,
): Promise<WorkOrderListItemDTO[]> {
  const rows = await repos.workOrder.listRecent(limit);
  return rows.map(toWorkOrderListItem);
}

/** 今日维修记录（今日有变动的工单） */
export async function getTodayWorkOrders(
  limit = 6,
  repos: Repositories = defaultRepos,
): Promise<WorkOrderListItemDTO[]> {
  const now = new Date();
  const rows = await repos.workOrder.listTouchedBetween(
    startOfBusinessDay(now),
    endOfBusinessDay(now),
    limit,
  );
  return rows.map(toWorkOrderListItem);
}

export interface PendingTask {
  type: "PAYMENT" | "DELIVERY" | "LOW_STOCK" | "SERVICE_DUE";
  title: string;
  description: string;
  href: string;
  badge?: string;
}

/** 待处理事项（首页 + 我的页共用） */
export async function getPendingTasks(repos: Repositories = defaultRepos): Promise<PendingTask[]> {
  const [unpaid, lowStock, dueService] = await Promise.all([
    // 复用「未结清工单候选」查询：同样按创建时间升序取 200 条，欠款判断留给领域层
    repos.workOrder.listUnsettled(200),
    countLowStockParts(repos),
    listDueServiceVehicles(5, repos),
  ]);

  const tasks: PendingTask[] = [];

  const unpaidList = unpaid
    .map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      customerName: o.customer.name,
      plateNumber: o.vehicle.plateNumber,
      balance: outstanding(o.totalAmount, o.paidAmount),
    }))
    .filter((o) => o.balance.gt(0))
    .sort((a, b) => b.balance.comparedTo(a.balance))
    .slice(0, 5);

  for (const order of unpaidList) {
    tasks.push({
      type: "PAYMENT",
      title: `${order.plateNumber} 待收款`,
      description: `${order.customerName} · 欠 ¥${order.balance.toFixed(2)}`,
      href: `/work-orders/${order.id}`,
      badge: order.orderNo,
    });
  }

  if (lowStock > 0) {
    tasks.push({
      type: "LOW_STOCK",
      title: "库存预警",
      description: `${lowStock} 个配件低于安全库存，请及时补货`,
      href: "/inventory?stock=low",
      badge: String(lowStock),
    });
  }

  for (const vehicle of dueService) {
    tasks.push({
      type: "SERVICE_DUE",
      title: `${vehicle.plateNumber} 保养提醒`,
      description: `${vehicle.customerName} · 预约 ${vehicle.nextServiceAt ? formatShort(vehicle.nextServiceAt) : "待定"}`,
      href: `/vehicles/${vehicle.id}`,
    });
  }

  return tasks;
}

function formatShort(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 今日日期标签，供首页标题展示 */
export function getTodayLabel() {
  return businessDateKey();
}
