import "server-only";

import { D, money } from "@/lib/money";
import type { GlobalSearchResult } from "@/types";
import { repos as defaultRepos } from "@/server/context";
import type { Repositories } from "@/domain/repositories";

/**
 * 全局快速搜索。
 * 支持：客户姓名 / 手机号 / 车牌 / VIN / 工单编号 / 配件名称。
 * 结果按「最可能用到」排序：工单 > 车辆 > 客户 > 配件。
 *
 * 【改造说明】取数全部通过 `Repositories`，本文件不再 import Prisma。
 */
export async function globalSearch(
  rawQuery: string,
  limit = 5,
  repos: Repositories = defaultRepos,
): Promise<GlobalSearchResult> {
  const q = rawQuery.trim();
  if (q.length < 1) {
    return { customers: [], vehicles: [], workOrders: [], parts: [] };
  }

  const [customers, vehicles, workOrders, parts] = await Promise.all([
    repos.customer.searchForGlobal(q, limit),
    repos.vehicle.searchForGlobal(q, limit),
    repos.workOrder.searchForGlobal(q, limit),
    repos.part.searchForGlobal(q, limit),
  ]);

  return {
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      vehicleCount: c.vehicleCount,
    })),
    vehicles: vehicles.map((v) => ({
      id: v.id,
      plateNumber: v.plateNumber,
      brand: v.brand,
      model: v.model,
      customerName: v.customerName,
    })),
    workOrders: workOrders.map((w) => ({
      id: w.id,
      orderNo: w.orderNo,
      status: w.status,
      plateNumber: w.plateNumber,
      totalAmount: money(w.totalAmount).toFixed(2),
    })),
    parts: parts.map((p) => ({
      id: p.id,
      name: p.name,
      spec: p.spec,
      stockValue: money(p.quantity ?? 0).toFixed(2),
      isLowStock: D(p.quantity ?? 0).lt(D(p.safeQuantity ?? 0)),
    })),
  };
}

/** 搜索建议（输入框联想，比全局搜索更轻） */
export async function searchSuggestions(q: string, limit = 8, repos: Repositories = defaultRepos) {
  const query = q.trim();
  if (!query) return [];

  const [vehicles, customers] = await Promise.all([
    repos.vehicle.suggestByPlate(query, limit),
    repos.customer.suggest(query, limit),
  ]);

  return [
    ...vehicles.map((v) => ({
      type: "vehicle" as const,
      id: v.id,
      label: v.plateNumber,
      sub: v.customerName,
    })),
    ...customers.map((c) => ({
      type: "customer" as const,
      id: c.id,
      label: c.name,
      sub: c.phone,
    })),
  ].slice(0, limit);
}
