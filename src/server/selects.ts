import type { Prisma } from "@prisma/client";

/**
 * 查询投影集中管理。
 * 好处：列表 / 详情 / 序列化三处共用同一份字段定义，不会出现「加了字段忘了改 DTO」。
 *
 * 【重要】行类型不再由 Prisma 推导，而是从 `@/domain/rows` re-export。
 * 原因：Prisma 推导出的类型会把 serializers / service 绑死在 Prisma 上，
 * 手机端（Capacitor + SQLite）无法复用这些模块。现在本文件只负责「投影定义」，
 * 而「投影长什么样」由领域层规定。
 *
 * Prisma 推导结果与领域行类型的一致性由编译期断言保证：
 *   src/server/repos/prisma/type-assertions.ts
 */

// ---------------------------------------------------------------------------
// 工单
// ---------------------------------------------------------------------------

export const workOrderListSelect = {
  id: true,
  orderNo: true,
  status: true,
  customerId: true,
  vehicleId: true,
  totalAmount: true,
  paidAmount: true,
  createdAt: true,
  completedAt: true,
  faultDescription: true,
  customer: { select: { name: true, phone: true } },
  vehicle: { select: { plateNumber: true, brand: true, model: true } },
  technician: { select: { name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.WorkOrderSelect;

export type { WorkOrderListRow } from "@/domain/rows";

export const workOrderDetailSelect = {
  id: true,
  orderNo: true,
  status: true,
  customerId: true,
  vehicleId: true,
  mileage: true,
  faultDescription: true,
  remark: true,
  serviceAmount: true,
  partsAmount: true,
  laborAmount: true,
  otherAmount: true,
  discountAmount: true,
  totalAmount: true,
  paidAmount: true,
  partsCost: true,
  completedAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { name: true, phone: true, wechat: true } },
  vehicle: {
    select: { plateNumber: true, brand: true, model: true, year: true, vin: true },
  },
  technician: { select: { name: true } },
  creator: { select: { name: true } },
  items: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
  payments: {
    where: { deletedAt: null },
    orderBy: { occurredAt: "desc" },
    select: {
      id: true,
      amount: true,
      method: true,
      category: true,
      source: true,
      occurredAt: true,
      remark: true,
      workOrderId: true,
      operator: { select: { name: true } },
    },
  },
  inventoryTxs: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      partId: true,
      quantity: true,
      qtyBefore: true,
      qtyAfter: true,
      unitCost: true,
      amount: true,
      workOrderId: true,
      remark: true,
      createdAt: true,
      part: { select: { name: true } },
      operator: { select: { name: true } },
    },
  },
} satisfies Prisma.WorkOrderSelect;

export type { WorkOrderDetailRow } from "@/domain/rows";

// ---------------------------------------------------------------------------
// 客户 / 车辆
// ---------------------------------------------------------------------------

export const customerListSelect = {
  id: true,
  name: true,
  phone: true,
  wechat: true,
  address: true,
  remark: true,
  createdAt: true,
  _count: { select: { vehicles: true, workOrders: true } },
} satisfies Prisma.CustomerSelect;

export type { CustomerListRow } from "@/domain/rows";

export const vehicleListSelect = {
  id: true,
  plateNumber: true,
  brand: true,
  model: true,
  year: true,
  vin: true,
  currentMileage: true,
  lastServiceAt: true,
  nextServiceAt: true,
  customerId: true,
  customer: { select: { name: true, phone: true } },
} satisfies Prisma.VehicleSelect;

export type { VehicleListRow } from "@/domain/rows";

// ---------------------------------------------------------------------------
// 配件 / 库存
// ---------------------------------------------------------------------------

export const partListSelect = {
  id: true,
  code: true,
  name: true,
  spec: true,
  brand: true,
  unit: true,
  categoryId: true,
  costPrice: true,
  salePrice: true,
  isActive: true,
  category: { select: { name: true } },
  inventory: {
    select: { quantity: true, safeQuantity: true, avgCost: true },
  },
} satisfies Prisma.PartSelect;

export type { PartListRow } from "@/domain/rows";

export const inventoryTxSelect = {
  id: true,
  type: true,
  partId: true,
  quantity: true,
  qtyBefore: true,
  qtyAfter: true,
  unitCost: true,
  amount: true,
  workOrderId: true,
  remark: true,
  createdAt: true,
  part: { select: { name: true } },
  operator: { select: { name: true } },
  workOrder: { select: { orderNo: true } },
} satisfies Prisma.InventoryTransactionSelect;

export type { InventoryTxRow } from "@/domain/rows";

// ---------------------------------------------------------------------------
// 财务
// ---------------------------------------------------------------------------

export const paymentSelect = {
  id: true,
  amount: true,
  method: true,
  category: true,
  source: true,
  occurredAt: true,
  remark: true,
  workOrderId: true,
  operator: { select: { name: true } },
  workOrder: { select: { orderNo: true } },
} satisfies Prisma.PaymentSelect;

export type { PaymentRow } from "@/domain/rows";

export const expenseSelect = {
  id: true,
  category: true,
  amount: true,
  method: true,
  occurredAt: true,
  remark: true,
  workOrderId: true,
  operator: { select: { name: true } },
  supplier: { select: { name: true } },
} satisfies Prisma.ExpenseSelect;

export type { ExpenseRow } from "@/domain/rows";
