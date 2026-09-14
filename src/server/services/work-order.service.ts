import "server-only";

import type { Repositories } from "@/domain/repositories";
import type { Money } from "@/domain/entities";
import type { WorkOrderStatus } from "@/domain/enums";
import { canTransition } from "@/lib/constants";
import { D, calcOrderTotals, money, outstanding } from "@/lib/money";
import { businessDateCompact } from "@/utils/date";
import { writeAuditLog } from "@/server/auth/audit";
import { canModifyWorkOrder } from "@/server/auth/permissions";
import { repos as defaultRepos, transaction } from "@/server/context";
import {
  AppError,
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  UniqueConstraintError,
} from "@/server/errors";
import {
  consumeForWorkOrder,
  getPartUnitCost,
  returnForWorkOrder,
} from "@/server/services/inventory-core.service";
import { toWorkOrderDetail, toWorkOrderListItem } from "@/server/serializers";
import type { CurrentUser, Paginated, WorkOrderDetailDTO, WorkOrderListItemDTO } from "@/types";

/**
 * 工单服务
 * ---------------------------------------------------------------------------
 * 【改造说明】本文件原先直接使用 Prisma（`prisma.workOrder.findMany` 等），
 * 现在全部改为通过 `Repositories` 取数：
 *   - 取数 / 落库 -> `repos`（或事务内的 `tx`）
 *   - 事务边界  -> `transaction(async (tx) => ...)`
 * 所有业务规则（状态机、金额重算、库存联动、权限校验、审计留痕）保持原样，
 * 只是数据来源可替换，从而让手机端（SQLite）能复用这一整套逻辑。
 */

// ---------------------------------------------------------------------------
// 工单号
// ---------------------------------------------------------------------------

/** 生成当日流水工单号：RO + yyyyMMdd + 3 位序号 */
export async function generateOrderNo(repos: Repositories = defaultRepos): Promise<string> {
  const prefix = `RO${businessDateCompact()}`;
  const lastOrderNo = await repos.workOrder.findLatestOrderNo(prefix);

  const lastSeq = lastOrderNo ? Number.parseInt(lastOrderNo.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

/**
 * 工单号唯一冲突时自动重试（并发建单场景）。
 * 注意：这里捕获的是**领域异常** `UniqueConstraintError`，不是 Prisma 的 P2002 ——
 * 仓储适配层负责把驱动错误翻译成本层能理解的异常。
 */
async function withOrderNoRetry<T>(
  repos: Repositories,
  fn: (orderNo: string, tx: Repositories) => Promise<T>,
  maxAttempts = 6,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const orderNo = await generateOrderNo(repos);
    try {
      return await transaction((tx) => fn(orderNo, tx));
    } catch (error) {
      if (error instanceof UniqueConstraintError) continue;
      throw error;
    }
  }
  throw new AppError("工单号生成失败，请重试。", "ORDER_NO_EXHAUSTED", 500);
}

// ---------------------------------------------------------------------------
// 金额重算（唯一实现）
// ---------------------------------------------------------------------------

/** 依据工单项重新计算并落库工单金额 */
export async function recalcOrderTotals(repos: Repositories, workOrderId: string) {
  const order = await repos.workOrder.findTotalsSource(workOrderId);
  if (!order) throw new NotFoundError("工单不存在。");

  const totals = calcOrderTotals(order.items, order.discountAmount);

  await repos.workOrder.applyTotals(workOrderId, {
    serviceAmount: totals.serviceAmount,
    partsAmount: totals.partsAmount,
    laborAmount: totals.laborAmount,
    otherAmount: totals.otherAmount,
    discountAmount: totals.discountAmount,
    totalAmount: totals.totalAmount,
    partsCost: totals.partsCost,
  });

  return totals;
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export interface WorkOrderQuery {
  q?: string;
  status?: WorkOrderStatus | "ALL" | "UNPAID";
  page: number;
  pageSize: number;
  customerId?: string;
  vehicleId?: string;
  /** 员工只能看到自己的工单（管理员不受限） */
  restrictToUserId?: string;
}

export async function listWorkOrders(
  query: WorkOrderQuery,
  repos: Repositories = defaultRepos,
): Promise<Paginated<WorkOrderListItemDTO>> {
  const { q, status = "ALL", page, pageSize, customerId, vehicleId, restrictToUserId } = query;

  const { rows, total } = await repos.workOrder.list(
    {
      keyword: q,
      status,
      customerId,
      vehicleId,
      restrictToCreatorId: restrictToUserId,
    },
    { skip: (page - 1) * pageSize, take: pageSize },
  );

  return {
    items: rows.map(toWorkOrderListItem),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getWorkOrderDetail(
  id: string,
  repos: Repositories = defaultRepos,
): Promise<WorkOrderDetailDTO> {
  const row = await repos.workOrder.findDetailById(id);
  if (!row) throw new NotFoundError("工单不存在或已被删除。");
  return toWorkOrderDetail(row);
}

async function loadOrderForMutation(repos: Repositories, id: string) {
  const order = await repos.workOrder.findForMutation(id);
  if (!order) throw new NotFoundError("工单不存在或已被删除。");
  return order;
}

function assertCanModify(user: CurrentUser, order: { createdBy: string | null }) {
  if (!canModifyWorkOrder(user, order)) {
    throw new ForbiddenError("只能修改自己创建的工单，请联系管理员。");
  }
}

// ---------------------------------------------------------------------------
// 创建
// ---------------------------------------------------------------------------

export interface CreateWorkOrderInput {
  customerId?: string;
  vehicleId?: string;
  newCustomerName?: string;
  newCustomerPhone?: string;
  newVehiclePlate?: string;
  newVehicleBrand?: string;
  newVehicleModel?: string;
  newVehicleMileage?: number;
  plateNumber?: string;
  mileage?: number;
  faultDescription?: string;
  remark?: string;
  technicianId?: string;
  discountAmount: string;
  items: Array<{
    type: "SERVICE" | "PART" | "LABOR" | "OTHER";
    itemRefId?: string;
    name: string;
    spec?: string;
    unit?: string;
    quantity: string;
    unitPrice: string;
    costPrice?: string;
    remark?: string;
  }>;
}

/**
 * 创建工单：一站式处理「客户 / 车辆」的匹配与新建 + 工单项 + 配件出库。
 * 整个过程在一个事务里完成，任何一步失败全部回滚。
 */
export async function createWorkOrder(
  input: CreateWorkOrderInput,
  user: CurrentUser,
): Promise<{ id: string; orderNo: string }> {
  return withOrderNoRetry(defaultRepos, async (orderNo, tx) => {
    // 1. 解析客户
    let customerId = input.customerId;
    if (!customerId) {
      if (!input.newCustomerName || !input.newCustomerPhone) {
        throw new AppError("请选择客户，或填写新客户的姓名与手机号。", "CUSTOMER_REQUIRED");
      }
      const existing = await tx.customer.findByPhone(input.newCustomerPhone);
      if (existing) {
        customerId = existing.id;
      } else {
        const created = await tx.customer.create({
          name: input.newCustomerName,
          phone: input.newCustomerPhone,
          createdBy: user.id,
        });
        customerId = created.id;
      }
    }
    if (!customerId) throw new AppError("客户解析失败。", "CUSTOMER_RESOLVE_FAILED");

    // 2. 解析车辆
    let vehicleId = input.vehicleId;
    if (!vehicleId) {
      const plate = input.newVehiclePlate ?? input.plateNumber;
      if (!plate) throw new AppError("请选择车辆，或填写车牌号。", "VEHICLE_REQUIRED");

      const existing = await tx.vehicle.findIdByPlate(plate);

      if (existing) {
        vehicleId = existing.id;
        // 车牌已属于其他客户时，以工单选择的客户为准（车辆过户场景）
        if (existing.customerId !== customerId) {
          await tx.vehicle.reassignToCustomer(existing.id, customerId);
        }
      } else {
        const created = await tx.vehicle.create({
          customerId,
          plateNumber: plate,
          brand: input.newVehicleBrand ?? null,
          model: input.newVehicleModel ?? null,
          currentMileage: input.newVehicleMileage ?? input.mileage ?? null,
        });
        vehicleId = created.id;
      }
    }
    if (!vehicleId) throw new AppError("车辆解析失败。", "VEHICLE_RESOLVE_FAILED");

    // 3. 创建工单主体
    const order = await tx.workOrder.create({
      orderNo,
      customerId,
      vehicleId,
      mileage: input.mileage ?? input.newVehicleMileage ?? null,
      faultDescription: input.faultDescription ?? null,
      remark: input.remark ?? null,
      technicianId: input.technicianId ?? null,
      createdBy: user.id,
      discountAmount: money(input.discountAmount),
    });

    // 4. 工单项（配件需同步出库）
    for (const [index, item] of input.items.entries()) {
      await insertItem(tx, {
        workOrderId: order.id,
        type: item.type,
        itemRefId: item.itemRefId,
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        costPrice: item.costPrice,
        remark: item.remark,
        sortOrder: index,
        operatorId: user.id,
        deductStock: true,
      });
    }

    await recalcOrderTotals(tx, order.id);

    await writeAuditLog(
      {
        user,
        action: "WORK_ORDER_CREATE",
        entity: "work_order",
        entityId: order.id,
        summary: `新建工单 ${order.orderNo}`,
        after: { orderNo: order.orderNo, itemCount: input.items.length },
      },
      tx,
    );

    return { id: order.id, orderNo: order.orderNo };
  });
}

// ---------------------------------------------------------------------------
// 工单项
// ---------------------------------------------------------------------------

interface InsertItemInput {
  workOrderId: string;
  type: "SERVICE" | "PART" | "LABOR" | "OTHER";
  itemRefId?: string;
  name: string;
  spec?: string;
  unit?: string;
  quantity: string;
  unitPrice: string;
  costPrice?: string;
  remark?: string;
  sortOrder?: number;
  operatorId: string;
  deductStock: boolean;
}

/**
 * 写入单个工单项。
 * - 配件：自动出库 + 用库存均价作为成本
 * - 维修项目 / 工时：从目录带出人工成本
 */
async function insertItem(repos: Repositories, input: InsertItemInput) {
  let costPrice: Money | null = input.costPrice ? money(input.costPrice) : null;
  let spec = input.spec ?? null;
  let unit = input.unit ?? null;
  let name = input.name;

  if (input.type === "PART" && input.itemRefId) {
    const part = await repos.part.findSnapshot(input.itemRefId);
    if (!part) throw new NotFoundError("所选配件不存在或已被删除。");

    name = part.name;
    spec = part.spec;
    unit = part.unit;
    if (!costPrice) {
      const avg = D(part.avgCost ?? 0);
      costPrice = avg.isZero() ? money(part.costPrice) : money(avg);
    }
  }

  if ((input.type === "SERVICE" || input.type === "LABOR") && input.itemRefId && !costPrice) {
    const serviceCost = await repos.catalog.findServiceItemCost(input.itemRefId);
    if (serviceCost !== null) costPrice = money(serviceCost);
  }

  const quantity = money(input.quantity);
  const unitPrice = money(input.unitPrice);

  const item = await repos.workOrderItem.create({
    workOrderId: input.workOrderId,
    type: input.type,
    itemRefId: input.itemRefId ?? null,
    name,
    spec,
    unit,
    quantity,
    unitPrice,
    costPrice: costPrice ?? money(0),
    amount: money(quantity.times(unitPrice)),
    remark: input.remark ?? null,
    sortOrder: input.sortOrder ?? 0,
  });

  if (input.type === "PART" && input.itemRefId && input.deductStock) {
    await consumeForWorkOrder(repos, {
      partId: input.itemRefId,
      quantity: quantity.toFixed(2),
      workOrderId: input.workOrderId,
      operatorId: input.operatorId,
      partName: name,
    });
  }

  return item;
}

export async function addWorkOrderItem(
  // operatorId / deductStock / sortOrder 由服务内部决定，调用方不需要（也不应该）传
  input: Omit<InsertItemInput, "operatorId" | "deductStock" | "sortOrder"> & {
    workOrderId: string;
  },
  user: CurrentUser,
  repos: Repositories = defaultRepos,
): Promise<WorkOrderDetailDTO> {
  const order = await loadOrderForMutation(repos, input.workOrderId);
  assertCanModify(user, order);
  if (order.status === "CANCELLED") {
    throw new BusinessRuleError("已取消的工单不能添加项目。");
  }

  const sortOrder = await repos.workOrderItem.countByOrder(order.id);

  await transaction(async (tx) => {
    await insertItem(tx, { ...input, sortOrder, operatorId: user.id, deductStock: true });
    await recalcOrderTotals(tx, order.id);
  });

  await writeAuditLog({
    user,
    action: "WORK_ORDER_ITEM_ADD",
    entity: "work_order",
    entityId: order.id,
    summary: `${order.orderNo} 添加「${input.name}」`,
    after: { type: input.type, quantity: input.quantity, unitPrice: input.unitPrice },
  });

  return getWorkOrderDetail(order.id, repos);
}

/** 修改工单项（数量 / 单价）：数量变化会同步调整库存 */
export async function updateWorkOrderItem(
  itemId: string,
  patch: { quantity?: string; unitPrice?: string; remark?: string },
  user: CurrentUser,
  repos: Repositories = defaultRepos,
): Promise<WorkOrderDetailDTO> {
  const existing = await repos.workOrderItem.findByIdWithOrder(itemId);
  if (!existing) throw new NotFoundError("工单项不存在。");

  assertCanModify(user, existing.workOrder);
  if (existing.workOrder.status === "CANCELLED") {
    throw new BusinessRuleError("已取消的工单不能修改项目。");
  }

  const nextQuantity = patch.quantity !== undefined ? money(patch.quantity) : D(existing.quantity);
  if (nextQuantity.lte(0)) throw new AppError("数量必须大于 0。", "INVALID_QUANTITY");

  const nextUnitPrice =
    patch.unitPrice !== undefined ? money(patch.unitPrice) : D(existing.unitPrice);
  if (nextUnitPrice.isNegative()) throw new AppError("单价不能为负数。", "INVALID_PRICE");

  const quantityDelta = nextQuantity.minus(D(existing.quantity));

  await transaction(async (tx) => {
    // 配件数量变化 -> 补出库 / 回滚入库
    if (existing.type === "PART" && existing.itemRefId && !quantityDelta.isZero()) {
      if (quantityDelta.isPositive()) {
        await consumeForWorkOrder(tx, {
          partId: existing.itemRefId,
          quantity: quantityDelta.toFixed(2),
          workOrderId: existing.workOrder.id,
          operatorId: user.id,
          partName: existing.name,
        });
      } else {
        await returnForWorkOrder(tx, {
          partId: existing.itemRefId,
          quantity: quantityDelta.abs().toFixed(2),
          workOrderId: existing.workOrder.id,
          operatorId: user.id,
          partName: existing.name,
        });
      }
    }

    await tx.workOrderItem.update(itemId, {
      quantity: nextQuantity,
      unitPrice: nextUnitPrice,
      amount: money(nextQuantity.times(nextUnitPrice)),
      ...(patch.remark !== undefined ? { remark: patch.remark || null } : {}),
    });

    await recalcOrderTotals(tx, existing.workOrder.id);
  });

  await writeAuditLog({
    user,
    action: "WORK_ORDER_ITEM_UPDATE",
    entity: "work_order",
    entityId: existing.workOrder.id,
    summary: `${existing.workOrder.orderNo} 修改「${existing.name}」`,
    before: {
      quantity: D(existing.quantity).toFixed(2),
      unitPrice: D(existing.unitPrice).toFixed(2),
    },
    after: { quantity: nextQuantity.toFixed(2), unitPrice: nextUnitPrice.toFixed(2) },
  });

  return getWorkOrderDetail(existing.workOrder.id, repos);
}

/** 删除工单项：配件自动回滚入库 */
export async function removeWorkOrderItem(
  itemId: string,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
): Promise<WorkOrderDetailDTO> {
  const existing = await repos.workOrderItem.findByIdWithOrder(itemId);
  if (!existing) throw new NotFoundError("工单项不存在。");

  assertCanModify(user, existing.workOrder);
  if (existing.workOrder.status === "CANCELLED") {
    throw new BusinessRuleError("已取消的工单不能删除项目。");
  }

  await transaction(async (tx) => {
    if (existing.type === "PART" && existing.itemRefId) {
      await returnForWorkOrder(tx, {
        partId: existing.itemRefId,
        quantity: D(existing.quantity).toFixed(2),
        workOrderId: existing.workOrder.id,
        operatorId: user.id,
        partName: existing.name,
      });
    }
    await tx.workOrderItem.hardDelete(itemId);
    await recalcOrderTotals(tx, existing.workOrder.id);
  });

  await writeAuditLog({
    user,
    action: "WORK_ORDER_ITEM_DELETE",
    entity: "work_order",
    entityId: existing.workOrder.id,
    summary: `${existing.workOrder.orderNo} 删除「${existing.name}」`,
    before: {
      name: existing.name,
      quantity: D(existing.quantity).toFixed(2),
      amount: D(existing.amount).toFixed(2),
    },
  });

  return getWorkOrderDetail(existing.workOrder.id, repos);
}

// ---------------------------------------------------------------------------
// 更新 / 优惠
// ---------------------------------------------------------------------------

export async function updateWorkOrder(
  input: {
    id: string;
    mileage?: number;
    faultDescription?: string;
    remark?: string;
    technicianId?: string;
    discountAmount: string;
  },
  user: CurrentUser,
  repos: Repositories = defaultRepos,
): Promise<WorkOrderDetailDTO> {
  const order = await loadOrderForMutation(repos, input.id);
  assertCanModify(user, order);
  if (order.status === "CANCELLED") throw new BusinessRuleError("已取消的工单不能修改。");

  const before = {
    mileage: order.mileage,
    discountAmount: D(order.discountAmount).toFixed(2),
    totalAmount: D(order.totalAmount).toFixed(2),
  };

  await transaction(async (tx) => {
    await tx.workOrder.updateInfo(order.id, {
      mileage: input.mileage,
      faultDescription: input.faultDescription,
      remark: input.remark,
      technicianId: input.technicianId,
      discountAmount: money(input.discountAmount),
    });
    await recalcOrderTotals(tx, order.id);
  });

  const updatedTotal = await repos.workOrder.findTotalAmount(order.id);

  await writeAuditLog({
    user,
    action: "WORK_ORDER_UPDATE",
    entity: "work_order",
    entityId: order.id,
    summary: `${order.orderNo} 修改工单信息`,
    before,
    after: {
      mileage: input.mileage ?? null,
      discountAmount: money(input.discountAmount).toFixed(2),
      totalAmount: D(updatedTotal).toFixed(2),
    },
  });

  return getWorkOrderDetail(order.id, repos);
}

/** 工单卡片上的快捷改优惠（店长高频操作）：只动优惠金额，不覆盖其他字段 */
export async function updateDiscount(
  input: { id: string; discountAmount: string },
  user: CurrentUser,
  repos: Repositories = defaultRepos,
): Promise<WorkOrderDetailDTO> {
  const order = await loadOrderForMutation(repos, input.id);
  assertCanModify(user, order);
  if (order.status === "CANCELLED") throw new BusinessRuleError("已取消的工单不能修改金额。");

  const before = D(order.discountAmount).toFixed(2);

  await transaction(async (tx) => {
    await tx.workOrder.updateInfo(order.id, { discountAmount: money(input.discountAmount) });
    await recalcOrderTotals(tx, order.id);
  });

  await writeAuditLog({
    user,
    action: "PRICE_UPDATE",
    entity: "work_order",
    entityId: order.id,
    summary: `${order.orderNo} 修改优惠金额`,
    before: { discountAmount: before },
    after: { discountAmount: money(input.discountAmount).toFixed(2) },
  });

  return getWorkOrderDetail(order.id, repos);
}

// ---------------------------------------------------------------------------
// 状态流转
// ---------------------------------------------------------------------------

export interface ChangeStatusInput {
  id: string;
  status: WorkOrderStatus;
  reason?: string;
  mileage?: number;
  createServiceRecord?: boolean;
  serviceDescription?: string;
  nextServiceAt?: Date;
  nextServiceMileage?: number;
}

export async function changeWorkOrderStatus(
  input: ChangeStatusInput,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
): Promise<WorkOrderDetailDTO> {
  const order = await loadOrderForMutation(repos, input.id);
  assertCanModify(user, order);

  if (order.status === input.status) {
    throw new BusinessRuleError("工单已处于该状态。");
  }
  if (!canTransition(order.status, input.status)) {
    throw new BusinessRuleError("当前状态不允许流转到目标状态，请刷新后重试。");
  }

  if (input.status === "CANCELLED") {
    return cancelWorkOrder(input.id, input.reason ?? "未填写原因", user, repos);
  }

  const paid = D(order.paidAmount);
  const total = D(order.totalAmount);

  await transaction(async (tx) => {
    if (input.status === "COMPLETED") {
      await tx.workOrder.changeStatus(order.id, {
        status: "COMPLETED",
        completedAt: new Date(),
        ...(input.mileage !== undefined ? { mileage: input.mileage } : {}),
      });

      // 同步车辆保养信息（里程 / 上次保养 / 下次保养）
      await tx.vehicle.updateServiceInfo(order.vehicleId, {
        ...(input.mileage !== undefined ? { currentMileage: input.mileage } : {}),
        lastServiceAt: new Date(),
        ...(input.nextServiceAt ? { nextServiceAt: input.nextServiceAt } : {}),
      });

      if (input.createServiceRecord) {
        await tx.vehicle.createServiceRecord({
          vehicleId: order.vehicleId,
          workOrderId: order.id,
          servicedAt: new Date(),
          mileage: input.mileage ?? order.mileage ?? null,
          description: input.serviceDescription || "常规维修保养",
          nextServiceAt: input.nextServiceAt ?? null,
          nextServiceMileage: input.nextServiceMileage ?? null,
          createdBy: user.id,
        });
      }
    } else {
      await tx.workOrder.changeStatus(order.id, {
        status: input.status,
        ...(input.mileage !== undefined ? { mileage: input.mileage } : {}),
      });
    }
  });

  await writeAuditLog({
    user,
    action: input.status === "COMPLETED" ? "WORK_ORDER_COMPLETE" : "WORK_ORDER_STATUS",
    entity: "work_order",
    entityId: order.id,
    summary:
      input.status === "COMPLETED"
        ? `${order.orderNo} 完工交车（应收 ${total.toFixed(2)}，已收 ${paid.toFixed(2)}）`
        : `${order.orderNo} 状态变更为 ${input.status}`,
    before: { status: order.status },
    after: { status: input.status, outstanding: outstanding(total, paid).toFixed(2) },
  });

  return getWorkOrderDetail(order.id, repos);
}

/** 取消工单：回滚配件库存；已有收款需管理员作废后才可取消 */
export async function cancelWorkOrder(
  id: string,
  reason: string,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
): Promise<WorkOrderDetailDTO> {
  const order = await loadOrderForMutation(repos, id);
  assertCanModify(user, order);
  if (order.status === "CANCELLED") throw new BusinessRuleError("工单已取消。");
  if (!reason.trim()) throw new AppError("请填写取消原因。", "REASON_REQUIRED");

  const paid = D(order.paidAmount);
  if (paid.gt(0) && !user.isAdmin) {
    throw new ForbiddenError("该工单已有收款记录，需管理员先作废收款后才能取消。");
  }

  const items = await repos.workOrderItem.listPartItems(id);

  await transaction(async (tx) => {
    for (const item of items) {
      if (!item.itemRefId) continue;
      await returnForWorkOrder(tx, {
        partId: item.itemRefId,
        quantity: D(item.quantity).toFixed(2),
        workOrderId: id,
        operatorId: user.id,
        partName: item.name,
      });
    }

    if (paid.gt(0)) {
      await tx.finance.voidPaymentsByWorkOrder(id, reason);
      await tx.workOrder.setPaidAmount(id, money(0));
    }

    await tx.workOrder.changeStatus(id, {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: reason,
    });
  });

  await writeAuditLog({
    user,
    action: "WORK_ORDER_CANCEL",
    entity: "work_order",
    entityId: id,
    summary: `${order.orderNo} 取消工单：${reason}`,
    before: { status: order.status, paidAmount: paid.toFixed(2) },
    after: { status: "CANCELLED", reason, stockRolledBack: items.length },
  });

  return getWorkOrderDetail(id, repos);
}

/** 删除工单（仅管理员，硬删除，用于误建单） */
export async function deleteWorkOrder(
  id: string,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
): Promise<void> {
  if (!user.isAdmin) throw new ForbiddenError("只有管理员可以删除工单。");

  const order = await loadOrderForMutation(repos, id);
  const paid = D(order.paidAmount);
  if (paid.gt(0)) {
    throw new BusinessRuleError("该工单已有收款记录，无法删除。请改为「取消工单」。");
  }

  const items = await repos.workOrderItem.listPartItems(id);
  const snapshot = await repos.workOrder.findSnapshot(id);

  await transaction(async (tx) => {
    // 已取消的工单库存已回滚过，避免重复入库
    if (order.status !== "CANCELLED") {
      for (const item of items) {
        if (!item.itemRefId) continue;
        await returnForWorkOrder(tx, {
          partId: item.itemRefId,
          quantity: D(item.quantity).toFixed(2),
          workOrderId: id,
          operatorId: user.id,
          partName: item.name,
        });
      }
    }

    // 解除库存流水 / 保养记录对工单的引用，保留记录本身（财务可追溯）
    await tx.inventory.detachWorkOrder(id);
    await tx.vehicle.detachServiceRecordsFromWorkOrder(id);
    await tx.workOrder.hardDelete(id);
  });

  await writeAuditLog({
    user,
    action: "WORK_ORDER_DELETE",
    entity: "work_order",
    entityId: id,
    summary: `删除工单 ${snapshot?.orderNo ?? id}`,
    before: snapshot,
  });
}

// ---------------------------------------------------------------------------
// 工单上的配件成本查询（供 UI 显示）
// ---------------------------------------------------------------------------

export async function resolvePartUnitCost(
  partId: string,
  repos: Repositories = defaultRepos,
): Promise<string> {
  return getPartUnitCost(repos, partId);
}
