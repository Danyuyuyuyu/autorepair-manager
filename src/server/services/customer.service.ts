import "server-only";

import type { Repositories } from "@/domain/repositories";
import { D, money, outstanding } from "@/lib/money";
import { writeAuditLog } from "@/server/auth/audit";
import { repos as defaultRepos, transaction } from "@/server/context";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/server/errors";
import { toVehicleListItem, toWorkOrderListItem } from "@/server/serializers";
import type { CurrentUser, CustomerDetailDTO, CustomerListItemDTO, Paginated } from "@/types";

/**
 * 客户服务
 * ---------------------------------------------------------------------------
 * 【改造说明】取数与落库全部改为通过 `Repositories`，本文件不再 import Prisma。
 * 业务规则（手机号重复提示文案、有工单禁止删除、级联软删车辆）一行未改。
 */

/** 客户维度的消费/欠款统计（仓储一次聚合拿回，避免 N+1） */
async function loadCustomerStats(repos: Repositories, ids: string[]) {
  if (ids.length === 0)
    return new Map<string, { spent: string; outstanding: string; lastVisit: Date | null }>();

  const rows = await repos.customer.aggregateOrderStats(ids);

  return new Map(
    rows.map((row) => [
      row.customerId,
      {
        spent: money(row.totalAmount ?? 0).toFixed(2),
        outstanding: money(D(row.totalAmount ?? 0).minus(D(row.paidAmount ?? 0))).toFixed(2),
        lastVisit: row.lastOrderAt,
      },
    ]),
  );
}

export interface CustomerQuery {
  q?: string;
  page: number;
  pageSize: number;
}

export async function listCustomers(
  query: CustomerQuery,
  repos: Repositories = defaultRepos,
): Promise<Paginated<CustomerListItemDTO>> {
  const { q, page, pageSize } = query;

  const { rows, total } = await repos.customer.list(
    { keyword: q },
    { skip: (page - 1) * pageSize, take: pageSize },
  );

  const stats = await loadCustomerStats(
    repos,
    rows.map((r) => r.id),
  );

  return {
    items: rows.map((row) => {
      const stat = stats.get(row.id);
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        wechat: row.wechat,
        vehicleCount: row._count.vehicles,
        workOrderCount: row._count.workOrders,
        totalSpent: stat?.spent ?? "0.00",
        outstandingAmount: stat?.outstanding ?? "0.00",
        lastVisitAt: stat?.lastVisit?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    }),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCustomerDetail(
  id: string,
  repos: Repositories = defaultRepos,
): Promise<CustomerDetailDTO> {
  const row = await repos.customer.findListView(id);
  if (!row) throw new NotFoundError("客户不存在或已被删除。");

  const [vehicles, recentWorkOrders, stats] = await Promise.all([
    repos.vehicle.listByCustomer(id),
    repos.workOrder.listRecentByCustomer(id, 10),
    loadCustomerStats(repos, [id]),
  ]);

  const stat = stats.get(id);

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    wechat: row.wechat,
    address: row.address,
    remark: row.remark,
    vehicleCount: row._count.vehicles,
    workOrderCount: row._count.workOrders,
    totalSpent: stat?.spent ?? "0.00",
    outstandingAmount: stat?.outstanding ?? "0.00",
    lastVisitAt: stat?.lastVisit?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    vehicles: vehicles.map(toVehicleListItem),
    recentWorkOrders: recentWorkOrders.map(toWorkOrderListItem),
  };
}

export interface CustomerInput {
  name: string;
  phone: string;
  wechat?: string;
  address?: string;
  remark?: string;
}

export async function createCustomer(
  input: CustomerInput,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const duplicate = await repos.customer.findByPhone(input.phone);
  if (duplicate) {
    throw new BusinessRuleError(
      `手机号 ${input.phone} 已存在客户「${duplicate.name}」，请直接搜索使用。`,
    );
  }

  const created = await repos.customer.create({
    name: input.name,
    phone: input.phone,
    createdBy: user.id,
  });

  await writeAuditLog({
    user,
    action: "CUSTOMER_CREATE",
    entity: "customer",
    entityId: created.id,
    summary: `新增客户「${created.name}」`,
    after: input,
  });

  return created;
}

export async function updateCustomer(
  id: string,
  input: CustomerInput,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const existing = await repos.customer.findForEdit(id);
  if (!existing) throw new NotFoundError("客户不存在或已被删除。");

  if (input.phone !== existing.phone) {
    const duplicate = await repos.customer.findByPhone(input.phone, id);
    if (duplicate) {
      throw new BusinessRuleError(`手机号已被客户「${duplicate.name}」使用。`);
    }
  }

  await repos.customer.update(id, {
    name: input.name,
    phone: input.phone,
    wechat: input.wechat || null,
    address: input.address || null,
    remark: input.remark || null,
  });

  await writeAuditLog({
    user,
    action: "CUSTOMER_UPDATE",
    entity: "customer",
    entityId: id,
    summary: `修改客户「${input.name}」`,
    before: existing,
    after: input,
  });

  return { id };
}

/** 删除客户：仅管理员，且存在关联工单时禁止删除（保证账目可追溯） */
export async function deleteCustomer(
  id: string,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  if (!user.isAdmin) throw new ForbiddenError("只有管理员可以删除客户。");

  const customer = await repos.customer.findForDelete(id);
  if (!customer) throw new NotFoundError("客户不存在或已被删除。");

  if (customer.workOrderCount > 0) {
    throw new BusinessRuleError(
      `该客户已有 ${customer.workOrderCount} 条维修记录，无法删除。如不再合作，请在备注中标注。`,
    );
  }

  await transaction(async (tx) => {
    await tx.vehicle.softDeleteByCustomer(id);
    await tx.customer.softDelete(id);
  });

  await writeAuditLog({
    user,
    action: "CUSTOMER_DELETE",
    entity: "customer",
    entityId: id,
    summary: `删除客户「${customer.name}」`,
    before: customer,
  });

  return { id };
}

/** 客户下拉选项（车辆建档、选择器使用，只取必要字段） */
export async function listCustomerOptions(limit = 500, repos: Repositories = defaultRepos) {
  return repos.customer.listOptions(limit);
}

/**
 * 只取客户主键（「现场新建客户 + 车辆」一步完成时用，避免为拿 id 拉统计）。
 * 手机号精确匹配，命中未删除客户。
 */
export async function findCustomerIdByPhone(phone: string, repos: Repositories = defaultRepos) {
  return repos.customer.findByPhone(phone.trim());
}

/** 按手机号精确查找客户（新建工单时最高频的入口） */
export async function findCustomerByPhone(phone: string, repos: Repositories = defaultRepos) {
  const customer = await repos.customer.findByPhoneWithVehicles(phone.trim());
  if (!customer) return null;

  const stats = await loadCustomerStats(repos, [customer.id]);
  const stat = stats.get(customer.id);

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    vehicles: customer.vehicles,
    totalSpent: stat?.spent ?? "0.00",
    outstandingAmount: stat?.outstanding ?? "0.00",
  };
}

/** 客户欠款明细（用于「待收款」页面） */
export async function listOutstandingOrders(limit = 50, repos: Repositories = defaultRepos) {
  const rows = await repos.workOrder.listUnsettled(200);

  return rows
    .map((row) => ({
      id: row.id,
      orderNo: row.orderNo,
      status: row.status,
      customerId: row.customer.id,
      customerName: row.customer.name,
      customerPhone: row.customer.phone,
      plateNumber: row.vehicle.plateNumber,
      totalAmount: money(row.totalAmount).toFixed(2),
      paidAmount: money(row.paidAmount).toFixed(2),
      outstandingAmount: outstanding(row.totalAmount, row.paidAmount).toFixed(2),
      createdAt: row.createdAt.toISOString(),
    }))
    .filter((row) => Number(row.outstandingAmount) > 0)
    .slice(0, limit);
}
