import type { AuditLog, Money, VehicleServiceRecord, WorkOrderItem } from "@/domain/entities";
import type {
  ExpenseRow,
  InventoryTxRow,
  PartListRow,
  PaymentRow,
  VehicleListRow,
  WorkOrderDetailRow,
  WorkOrderListRow,
} from "@/domain/rows";
import { D, money, outstanding as calcOutstanding } from "@/lib/money";
import type {
  AuditLogDTO,
  ExpenseDTO,
  InventoryTxDTO,
  PartListItemDTO,
  PaymentDTO,
  VehicleListItemDTO,
  VehicleServiceRecordDTO,
  WorkOrderDetailDTO,
  WorkOrderItemDTO,
  WorkOrderListItemDTO,
} from "@/types";

/**
 * 实体 -> DTO 的唯一转换层。
 * 规则：金额 / 数量一律转字符串（保留 2 位小数），日期一律转 ISO 字符串。
 *
 * 本模块只依赖 `@/domain`（后端无关），因此手机端与 PC 端共用同一套映射逻辑。
 */

const s = (v: Money | null | undefined): string => money(v).toFixed(2);
const iso = (v: Date | null | undefined): string | null => (v ? v.toISOString() : null);
const isoRequired = (v: Date): string => v.toISOString();

// ---------------------------------------------------------------------------
// 工单
// ---------------------------------------------------------------------------

export function toWorkOrderListItem(row: WorkOrderListRow): WorkOrderListItemDTO {
  const total = D(row.totalAmount);
  const paid = D(row.paidAmount);

  return {
    id: row.id,
    orderNo: row.orderNo,
    status: row.status,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerPhone: row.customer.phone,
    vehicleId: row.vehicleId,
    plateNumber: row.vehicle.plateNumber,
    vehicleModel: [row.vehicle.brand, row.vehicle.model].filter(Boolean).join(" ") || null,
    totalAmount: s(total),
    paidAmount: s(paid),
    outstandingAmount: calcOutstanding(total, paid).toFixed(2),
    itemCount: row._count.items,
    technicianName: row.technician?.name ?? null,
    faultDescription: row.faultDescription,
    createdAt: isoRequired(row.createdAt),
    completedAt: iso(row.completedAt),
  };
}

export function toWorkOrderItem(item: WorkOrderItem): WorkOrderItemDTO {
  return {
    id: item.id,
    type: item.type,
    itemRefId: item.itemRefId,
    name: item.name,
    spec: item.spec,
    unit: item.unit,
    quantity: s(item.quantity),
    unitPrice: s(item.unitPrice),
    costPrice: s(item.costPrice),
    amount: s(item.amount),
    remark: item.remark,
    sortOrder: item.sortOrder,
  };
}

export function toWorkOrderDetail(row: WorkOrderDetailRow): WorkOrderDetailDTO {
  const total = D(row.totalAmount);
  const paid = D(row.paidAmount);

  return {
    id: row.id,
    orderNo: row.orderNo,
    status: row.status,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerPhone: row.customer.phone,
    customerWechat: row.customer.wechat,
    vehicleId: row.vehicleId,
    plateNumber: row.vehicle.plateNumber,
    vehicleModel: [row.vehicle.brand, row.vehicle.model].filter(Boolean).join(" ") || null,
    brand: row.vehicle.brand,
    model: row.vehicle.model,
    year: row.vehicle.year,
    vin: row.vehicle.vin,
    mileage: row.mileage,
    faultDescription: row.faultDescription,
    remark: row.remark,
    totalAmount: s(total),
    paidAmount: s(paid),
    outstandingAmount: calcOutstanding(total, paid).toFixed(2),
    itemCount: row.items.length,
    technicianName: row.technician?.name ?? null,
    serviceAmount: s(row.serviceAmount),
    partsAmount: s(row.partsAmount),
    laborAmount: s(row.laborAmount),
    otherAmount: s(row.otherAmount),
    discountAmount: s(row.discountAmount),
    subtotal: money(D(row.totalAmount).plus(D(row.discountAmount))).toFixed(2),
    partsCost: s(row.partsCost),
    createdByName: row.creator?.name ?? null,
    items: row.items.map(toWorkOrderItem),
    payments: row.payments.map((p) => ({
      id: p.id,
      amount: s(p.amount),
      method: p.method,
      category: p.category,
      source: p.source,
      occurredAt: isoRequired(p.occurredAt),
      operatorName: p.operator?.name ?? null,
      remark: p.remark,
      workOrderId: p.workOrderId,
      workOrderNo: row.orderNo,
    })),
    inventoryTxs: row.inventoryTxs.map((tx) => toInventoryTx({ ...tx, workOrder: null })),
    cancelReason: row.cancelReason,
    cancelledAt: iso(row.cancelledAt),
    completedAt: iso(row.completedAt),
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// 客户 / 车辆
// ---------------------------------------------------------------------------

/**
 * 客户列表 / 详情 DTO 在 customer.service 中组装。
 * 原因：客户的「累计消费 / 欠款 / 最近到店」需要跨工单聚合，
 * 用 groupBy 一次算出比在序列化层遍历全部工单更高效，因此不在这里提供映射函数。
 */

export function toVehicleListItem(row: VehicleListRow): VehicleListItemDTO {
  return {
    id: row.id,
    plateNumber: row.plateNumber,
    brand: row.brand,
    model: row.model,
    year: row.year,
    vin: row.vin,
    currentMileage: row.currentMileage,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerPhone: row.customer.phone,
    lastServiceAt: iso(row.lastServiceAt),
    nextServiceAt: iso(row.nextServiceAt),
  };
}

export function toServiceRecord(
  row: VehicleServiceRecord & { workOrder?: { orderNo: string } | null },
): VehicleServiceRecordDTO {
  return {
    id: row.id,
    servicedAt: isoRequired(row.servicedAt),
    mileage: row.mileage,
    description: row.description,
    nextServiceAt: iso(row.nextServiceAt),
    nextServiceMileage: row.nextServiceMileage,
    workOrderId: row.workOrderId,
    workOrderNo: row.workOrder?.orderNo ?? null,
  };
}

// ---------------------------------------------------------------------------
// 配件 / 库存
// ---------------------------------------------------------------------------

export function toPartListItem(row: PartListRow): PartListItemDTO {
  const quantity = D(row.inventory?.quantity ?? 0);
  const safeQuantity = D(row.inventory?.safeQuantity ?? 0);
  const avgCost = D(row.inventory?.avgCost ?? row.costPrice);

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    spec: row.spec,
    brand: row.brand,
    unit: row.unit,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    quantity: quantity.toFixed(2),
    safeQuantity: safeQuantity.toFixed(2),
    avgCost: money(avgCost).toFixed(2),
    costPrice: s(row.costPrice),
    salePrice: s(row.salePrice),
    stockValue: money(quantity.times(avgCost)).toFixed(2),
    isLowStock: quantity.lt(safeQuantity),
    isActive: row.isActive,
  };
}

export function toInventoryTx(row: InventoryTxRow): InventoryTxDTO {
  return {
    id: row.id,
    type: row.type,
    partId: row.partId,
    partName: row.part.name,
    quantity: s(row.quantity),
    qtyBefore: s(row.qtyBefore),
    qtyAfter: s(row.qtyAfter),
    unitCost: row.unitCost === null ? null : s(row.unitCost),
    amount: row.amount === null ? null : s(row.amount),
    workOrderId: row.workOrderId,
    workOrderNo: row.workOrder?.orderNo ?? null,
    operatorName: row.operator?.name ?? null,
    remark: row.remark,
    createdAt: isoRequired(row.createdAt),
  };
}

// ---------------------------------------------------------------------------
// 财务
// ---------------------------------------------------------------------------

export function toPayment(row: PaymentRow): PaymentDTO {
  return {
    id: row.id,
    amount: s(row.amount),
    method: row.method,
    category: row.category,
    source: row.source,
    occurredAt: isoRequired(row.occurredAt),
    operatorName: row.operator?.name ?? null,
    remark: row.remark,
    workOrderId: row.workOrderId,
    workOrderNo: row.workOrder?.orderNo ?? null,
  };
}

export function toExpense(row: ExpenseRow): ExpenseDTO {
  return {
    id: row.id,
    category: row.category,
    amount: s(row.amount),
    method: row.method,
    occurredAt: isoRequired(row.occurredAt),
    supplierName: row.supplier?.name ?? null,
    operatorName: row.operator?.name ?? null,
    remark: row.remark,
    workOrderId: row.workOrderId,
  };
}

// ---------------------------------------------------------------------------
// 审计日志
// ---------------------------------------------------------------------------

export function toAuditLog(row: AuditLog): AuditLogDTO {
  return {
    id: row.id,
    userName: row.userName,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    summary: row.summary,
    before: row.before,
    after: row.after,
    ip: row.ip,
    createdAt: isoRequired(row.createdAt),
  };
}
