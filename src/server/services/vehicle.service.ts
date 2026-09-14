import "server-only";

import type { Repositories } from "@/domain/repositories";
import { D, money, sumMoney } from "@/lib/money";
import { writeAuditLog } from "@/server/auth/audit";
import { repos as defaultRepos, transaction } from "@/server/context";
import { BusinessRuleError, NotFoundError } from "@/server/errors";
import { toServiceRecord, toVehicleListItem, toWorkOrderListItem } from "@/server/serializers";
import type { CurrentUser, Paginated, VehicleDetailDTO, VehicleListItemDTO } from "@/types";

/**
 * 车辆服务
 * ---------------------------------------------------------------------------
 * 【改造说明】取数与落库全部改为通过 `Repositories`，本文件不再 import Prisma。
 * 「临近保养 30 天」的口径仍留在领域层：仓储只接收算好的截止日期，
 * 不把业务时间窗口写进 SQL。
 */

export interface VehicleQuery {
  q?: string;
  page: number;
  pageSize: number;
  customerId?: string;
  /** 仅显示临近保养（近 30 天或已过期） */
  dueServiceOnly?: boolean;
}

/** 临近保养的判定窗口（天）—— 业务规则，不下沉到仓储 */
const DUE_SERVICE_WINDOW_DAYS = 30;

export async function listVehicles(
  query: VehicleQuery,
  repos: Repositories = defaultRepos,
): Promise<Paginated<VehicleListItemDTO>> {
  const { q, page, pageSize, customerId, dueServiceOnly } = query;

  const dueServiceBefore = dueServiceOnly
    ? addDays(new Date(), DUE_SERVICE_WINDOW_DAYS)
    : undefined;

  const { rows, total } = await repos.vehicle.list(
    { keyword: q, customerId, dueServiceBefore },
    { skip: (page - 1) * pageSize, take: pageSize },
  );

  return {
    items: rows.map(toVehicleListItem),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** 按车牌号精确查找（新建工单第一步） */
export async function findVehicleByPlate(plate: string, repos: Repositories = defaultRepos) {
  const normalized = plate.trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) return null;

  const vehicle = await repos.vehicle.findDetailBaseByPlate(normalized);
  if (!vehicle) return null;

  const lastOrders = await repos.workOrder.listBriefByVehicle(vehicle.id, 3);

  return {
    ...toVehicleListItem(vehicle),
    engineNo: vehicle.engineNo,
    remark: vehicle.remark,
    recentOrders: lastOrders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      createdAt: o.createdAt.toISOString(),
      mileage: o.mileage,
      totalAmount: money(o.totalAmount).toFixed(2),
    })),
  };
}

export async function getVehicleDetail(
  id: string,
  repos: Repositories = defaultRepos,
): Promise<VehicleDetailDTO> {
  const vehicle = await repos.vehicle.findDetailBaseById(id);
  if (!vehicle) throw new NotFoundError("车辆不存在或已被删除。");

  const [workOrders, serviceRecords, items] = await Promise.all([
    repos.workOrder.listRecentByVehicle(id, 30),
    repos.vehicle.listServiceRecords(id, 30),
    repos.workOrderItem.listVehicleItemHistory(id),
  ]);

  const totalSpent = sumMoney(workOrders.map((o) => o.totalAmount));

  const accumulate = (type: "PART" | "SERVICE" | "LABOR") => {
    const map = new Map<string, { quantity: ReturnType<typeof D>; amount: ReturnType<typeof D> }>();
    for (const item of items) {
      if (item.type !== type) continue;
      const prev = map.get(item.name) ?? { quantity: D(0), amount: D(0) };
      map.set(item.name, {
        quantity: prev.quantity.plus(D(item.quantity)),
        amount: prev.amount.plus(D(item.amount)),
      });
    }
    return [...map.entries()]
      .map(([name, v]) => ({
        name,
        quantity: v.quantity.toFixed(2),
        amount: money(v.amount).toFixed(2),
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, 8);
  };

  return {
    ...toVehicleListItem(vehicle),
    engineNo: vehicle.engineNo,
    remark: vehicle.remark,
    workOrders: workOrders.map(toWorkOrderListItem),
    serviceRecords: serviceRecords.map(toServiceRecord),
    totalSpent: totalSpent.toFixed(2),
    topParts: accumulate("PART"),
    topServices: [...accumulate("SERVICE"), ...accumulate("LABOR")],
  };
}

export interface VehicleInput {
  customerId: string;
  plateNumber: string;
  brand?: string;
  model?: string;
  year?: number;
  vin?: string;
  engineNo?: string;
  currentMileage?: number;
  lastServiceAt?: Date;
  nextServiceAt?: Date;
  remark?: string;
}

export async function createVehicle(
  input: VehicleInput,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  if (!(await repos.customer.existsActive(input.customerId))) {
    throw new BusinessRuleError("所选客户不存在，请重新选择。");
  }

  const duplicate = await repos.vehicle.findDetailBaseByPlate(input.plateNumber);
  if (duplicate) {
    throw new BusinessRuleError(
      `车牌 ${input.plateNumber} 已登记在客户「${duplicate.customer.name}」名下。`,
    );
  }

  const created = await repos.vehicle.create({
    customerId: input.customerId,
    plateNumber: input.plateNumber,
    brand: input.brand || null,
    model: input.model || null,
    year: input.year ?? null,
    vin: input.vin || null,
    engineNo: input.engineNo || null,
    currentMileage: input.currentMileage ?? null,
    lastServiceAt: input.lastServiceAt ?? null,
    nextServiceAt: input.nextServiceAt ?? null,
    remark: input.remark || null,
  });

  await writeAuditLog({
    user,
    action: "VEHICLE_CREATE",
    entity: "vehicle",
    entityId: created.id,
    summary: `新增车辆 ${created.plateNumber}`,
    after: input,
  });

  return created;
}

export async function updateVehicle(
  id: string,
  input: VehicleInput,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const existing = await repos.vehicle.findForEdit(id);
  if (!existing) throw new NotFoundError("车辆不存在或已被删除。");

  if (input.plateNumber !== existing.plateNumber) {
    const duplicate = await repos.vehicle.findDetailBaseByPlate(input.plateNumber, id);
    if (duplicate) throw new BusinessRuleError(`车牌 ${input.plateNumber} 已被其他车辆使用。`);
  }

  await repos.vehicle.update(id, {
    customerId: input.customerId,
    plateNumber: input.plateNumber,
    brand: input.brand || null,
    model: input.model || null,
    year: input.year ?? null,
    vin: input.vin || null,
    engineNo: input.engineNo || null,
    currentMileage: input.currentMileage ?? null,
    lastServiceAt: input.lastServiceAt ?? null,
    nextServiceAt: input.nextServiceAt ?? null,
    remark: input.remark || null,
  });

  await writeAuditLog({
    user,
    action: "VEHICLE_UPDATE",
    entity: "vehicle",
    entityId: id,
    summary: `修改车辆 ${input.plateNumber}`,
    before: existing,
    after: input,
  });

  return { id };
}

export async function deleteVehicle(
  id: string,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const vehicle = await repos.vehicle.findForDelete(id);
  if (!vehicle) throw new NotFoundError("车辆不存在或已被删除。");

  if (vehicle.workOrderCount > 0) {
    throw new BusinessRuleError(`该车辆已有 ${vehicle.workOrderCount} 条维修记录，无法删除。`);
  }

  await repos.vehicle.softDelete(id);

  await writeAuditLog({
    user,
    action: "VEHICLE_DELETE",
    entity: "vehicle",
    entityId: id,
    summary: `删除车辆 ${vehicle.plateNumber}`,
    before: vehicle,
  });

  return { id };
}

export interface ServiceRecordInput {
  vehicleId: string;
  servicedAt: Date;
  mileage?: number;
  description: string;
  nextServiceAt?: Date;
  nextServiceMileage?: number;
}

export async function createServiceRecord(
  input: ServiceRecordInput,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const vehicle = await repos.vehicle.findForEdit(input.vehicleId);
  if (!vehicle) throw new NotFoundError("车辆不存在。");

  const created = await transaction(async (tx) => {
    const record = await tx.vehicle.createServiceRecord({
      vehicleId: input.vehicleId,
      servicedAt: input.servicedAt,
      mileage: input.mileage ?? null,
      description: input.description,
      nextServiceAt: input.nextServiceAt ?? null,
      nextServiceMileage: input.nextServiceMileage ?? null,
      createdBy: user.id,
    });

    await tx.vehicle.updateServiceInfo(input.vehicleId, {
      lastServiceAt: input.servicedAt,
      ...(input.mileage !== undefined ? { currentMileage: input.mileage } : {}),
      ...(input.nextServiceAt ? { nextServiceAt: input.nextServiceAt } : {}),
    });

    return record;
  });

  await writeAuditLog({
    user,
    action: "VEHICLE_UPDATE",
    entity: "vehicle_service_record",
    entityId: created.id,
    summary: `登记保养记录 · ${vehicle.plateNumber}`,
    after: input,
  });

  return { id: created.id };
}

/** 临近保养提醒（首页待处理事项） */
export async function listDueServiceVehicles(limit = 10, repos: Repositories = defaultRepos) {
  const rows = await repos.vehicle.listDueService(
    addDays(new Date(), DUE_SERVICE_WINDOW_DAYS),
    limit,
  );

  return rows.map((row) => ({
    id: row.id,
    plateNumber: row.plateNumber,
    nextServiceAt: row.nextServiceAt?.toISOString() ?? null,
    currentMileage: row.currentMileage,
    customerName: row.customer.name,
    customerPhone: row.customer.phone,
  }));
}

function addDays(from: Date, days: number): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + days);
  return next;
}
