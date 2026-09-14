/**
 * 领域实体 —— 后端无关的行形状
 * ---------------------------------------------------------------------------
 * 这些类型描述「一条记录长什么样」，不关心它来自 PostgreSQL、SQLite 还是内存。
 *
 * 约定：
 *   - 金额 / 数量字段类型为 decimal.js 的 `Decimal`
 *     （Prisma 的 `Prisma.Decimal` 本身就是 decimal.js 的 Decimal，两者可互相赋值）
 *   - 时间字段为 `Date`
 *   - 可空字段显式写 `| null`，不使用可选属性 —— 数据库读出来的行始终有这些键
 *
 * 与 Prisma 生成类型的一致性由 `src/server/repos/prisma/type-assertions.ts`
 * 在编译期校验：任何一端加了字段忘了改另一端，都会编译失败。
 */
import type Decimal from "decimal.js";

import type {
  CategoryKind,
  ExpenseCategory,
  IncomeCategory,
  IncomeSource,
  InventoryTxType,
  PaymentMethod,
  Role,
  WorkOrderItemType,
  WorkOrderStatus,
} from "@/domain/enums";

/** 金额 / 数量：统一用 Decimal，禁止 number 参与运算 */
export type Money = Decimal;

// ---------------------------------------------------------------------------
// 账号 / 员工
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  username: string;
  name: string;
  phone: string | null;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Employee {
  id: string;
  name: string;
  phone: string | null;
  position: string | null;
  isTechnician: boolean;
  userId: string | null;
  isActive: boolean;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ---------------------------------------------------------------------------
// 客户 / 车辆
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  name: string;
  phone: string;
  wechat: string | null;
  address: string | null;
  remark: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Vehicle {
  id: string;
  customerId: string;
  plateNumber: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  engineNo: string | null;
  currentMileage: number | null;
  lastServiceAt: Date | null;
  nextServiceAt: Date | null;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface VehicleServiceRecord {
  id: string;
  vehicleId: string;
  workOrderId: string | null;
  servicedAt: Date;
  mileage: number | null;
  description: string;
  nextServiceAt: Date | null;
  nextServiceMileage: number | null;
  createdBy: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// 工单
// ---------------------------------------------------------------------------

export interface WorkOrder {
  id: string;
  orderNo: string;
  status: WorkOrderStatus;
  customerId: string;
  vehicleId: string;
  mileage: number | null;
  faultDescription: string | null;
  remark: string | null;
  technicianId: string | null;
  createdBy: string | null;
  serviceAmount: Money;
  partsAmount: Money;
  laborAmount: Money;
  otherAmount: Money;
  discountAmount: Money;
  totalAmount: Money;
  paidAmount: Money;
  partsCost: Money;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * 工单项。
 * `name` / `unitPrice` / `costPrice` 均为下单时的快照，目录改价不影响历史工单。
 */
export interface WorkOrderItem {
  id: string;
  workOrderId: string;
  type: WorkOrderItemType;
  itemRefId: string | null;
  name: string;
  spec: string | null;
  unit: string | null;
  quantity: Money;
  unitPrice: Money;
  costPrice: Money;
  amount: Money;
  remark: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// 资金流水
// ---------------------------------------------------------------------------

export interface Payment {
  id: string;
  workOrderId: string | null;
  customerId: string | null;
  source: IncomeSource;
  category: IncomeCategory;
  amount: Money;
  method: PaymentMethod;
  occurredAt: Date;
  operatorId: string | null;
  remark: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface Expense {
  id: string;
  category: ExpenseCategory;
  amount: Money;
  method: PaymentMethod;
  occurredAt: Date;
  supplierId: string | null;
  workOrderId: string | null;
  operatorId: string | null;
  remark: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

// ---------------------------------------------------------------------------
// 配件 / 库存
// ---------------------------------------------------------------------------

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Part {
  id: string;
  code: string | null;
  name: string;
  spec: string | null;
  brand: string | null;
  unit: string;
  categoryId: string | null;
  supplierId: string | null;
  costPrice: Money;
  salePrice: Money;
  isActive: boolean;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** 当前库存状态（与 Part 一对一）—— 库存数量的唯一真相来源 */
export interface Inventory {
  id: string;
  partId: string;
  quantity: Money;
  safeQuantity: Money;
  avgCost: Money;
  location: string | null;
  updatedAt: Date;
}

/** 库存流水（只增不改，完整留痕） */
export interface InventoryTransaction {
  id: string;
  partId: string;
  type: InventoryTxType;
  quantity: Money;
  qtyBefore: Money;
  qtyAfter: Money;
  unitCost: Money | null;
  amount: Money | null;
  workOrderId: string | null;
  operatorId: string | null;
  remark: string | null;
  createdAt: Date;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  address: string | null;
  remark: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ServiceItem {
  id: string;
  code: string | null;
  name: string;
  kind: WorkOrderItemType;
  categoryId: string | null;
  unit: string;
  defaultPrice: Money;
  defaultHours: Money | null;
  costPrice: Money;
  isActive: boolean;
  sortOrder: number;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ---------------------------------------------------------------------------
// 审计 / 设置
// ---------------------------------------------------------------------------

export interface AuditLog {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string;
  summary: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: Date;
}
