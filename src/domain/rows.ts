/**
 * 查询投影行类型 —— 后端无关
 * ---------------------------------------------------------------------------
 * 这些类型原本由 `Prisma.XGetPayload<{ select: ... }>` 推导，那样会把
 * serializers / service 全部绑死在 Prisma 上。现在改为手写接口，
 * Prisma 实现侧用编译期断言证明它产出的行满足这些接口（见
 * `src/server/repos/prisma/type-assertions.ts`）。
 *
 * 好处：serializers 只依赖本文件，手机端 SQLite 实现产出同样的形状即可复用全部映射逻辑。
 */
import type { Money, VehicleServiceRecord } from "@/domain/entities";
import type {
  ExpenseCategory,
  IncomeCategory,
  IncomeSource,
  InventoryTxType,
  PaymentMethod,
  Role,
  WorkOrderItemType,
  WorkOrderStatus,
} from "@/domain/enums";

// ---------------------------------------------------------------------------
// 工单
// ---------------------------------------------------------------------------

export interface WorkOrderListRow {
  id: string;
  orderNo: string;
  status: WorkOrderStatus;
  customerId: string;
  vehicleId: string;
  totalAmount: Money;
  paidAmount: Money;
  createdAt: Date;
  completedAt: Date | null;
  faultDescription: string | null;
  customer: { name: string; phone: string };
  vehicle: { plateNumber: string; brand: string | null; model: string | null };
  technician: { name: string } | null;
  _count: { items: number };
}

/** 工单详情里的收款条目（比 PaymentRow 少一层工单号，由父级提供） */
export interface WorkOrderPaymentRow {
  id: string;
  amount: Money;
  method: PaymentMethod;
  category: IncomeCategory;
  source: IncomeSource;
  occurredAt: Date;
  remark: string | null;
  workOrderId: string | null;
  operator: { name: string } | null;
}

/** 工单详情里的库存流水条目 */
export interface WorkOrderInventoryTxRow {
  id: string;
  type: InventoryTxType;
  partId: string;
  quantity: Money;
  qtyBefore: Money;
  qtyAfter: Money;
  unitCost: Money | null;
  amount: Money | null;
  workOrderId: string | null;
  remark: string | null;
  createdAt: Date;
  part: { name: string };
  operator: { name: string } | null;
}

export interface WorkOrderDetailItemRow {
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

export interface WorkOrderDetailRow {
  id: string;
  orderNo: string;
  status: WorkOrderStatus;
  customerId: string;
  vehicleId: string;
  mileage: number | null;
  faultDescription: string | null;
  remark: string | null;
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
  customer: { name: string; phone: string; wechat: string | null };
  vehicle: {
    plateNumber: string;
    brand: string | null;
    model: string | null;
    year: number | null;
    vin: string | null;
  };
  technician: { name: string } | null;
  creator: { name: string } | null;
  items: WorkOrderDetailItemRow[];
  payments: WorkOrderPaymentRow[];
  inventoryTxs: WorkOrderInventoryTxRow[];
}

/** 工单加锁 / 改动校验所需的最小行 */
export interface WorkOrderMutationRow {
  id: string;
  orderNo: string;
  status: WorkOrderStatus;
  createdBy: string | null;
  customerId: string;
  vehicleId: string;
  discountAmount: Money;
  totalAmount: Money;
  paidAmount: Money;
  mileage: number | null;
  vehicle: { plateNumber: string };
  customer: { name: string };
}

/** 重新计算金额所需的工单项行 */
export interface WorkOrderTotalsRow {
  discountAmount: Money;
  items: Array<{
    type: WorkOrderItemType;
    quantity: Money;
    unitPrice: Money;
    costPrice: Money;
  }>;
}

// ---------------------------------------------------------------------------
// 客户 / 车辆
// ---------------------------------------------------------------------------

export interface CustomerListRow {
  id: string;
  name: string;
  phone: string;
  wechat: string | null;
  address: string | null;
  remark: string | null;
  createdAt: Date;
  _count: { vehicles: number; workOrders: number };
}

export interface VehicleListRow {
  id: string;
  plateNumber: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  currentMileage: number | null;
  lastServiceAt: Date | null;
  nextServiceAt: Date | null;
  customerId: string;
  customer: { name: string; phone: string };
}

/** 车辆详情主表（列表投影 + 只在详情/按车牌查询时才需要的字段） */
export interface VehicleDetailBaseRow extends VehicleListRow {
  engineNo: string | null;
  remark: string | null;
}

/** 车辆详情里的保养记录（带所属工单号） */
export interface VehicleServiceRecordRow extends VehicleServiceRecord {
  workOrder: { orderNo: string } | null;
}

/** 按车牌查车时展示的最近工单摘要 */
export interface VehicleOrderBriefRow {
  id: string;
  orderNo: string;
  createdAt: Date;
  mileage: number | null;
  totalAmount: Money;
}

/** 车辆历史用料/用工聚合（车辆详情页「常换配件 / 常做项目」） */
export interface VehicleItemHistoryRow {
  type: WorkOrderItemType;
  name: string;
  quantity: Money;
  amount: Money;
}

/** 临近保养提醒行 */
export interface DueServiceVehicleRow {
  id: string;
  plateNumber: string;
  nextServiceAt: Date | null;
  currentMileage: number | null;
  customer: { name: string; phone: string };
}

/** 客户维度的工单汇总（累计消费 / 欠款 / 最近到店），由仓储一次性聚合返回 */
export interface CustomerOrderStatsRow {
  customerId: string;
  /** 合计值，无匹配行时为 null（由领域层决定如何折算） */
  totalAmount: Money | null;
  paidAmount: Money | null;
  lastOrderAt: Date | null;
}

/** 未结清工单候选行（「待收款」页面用） */
export interface UnsettledOrderRow {
  id: string;
  orderNo: string;
  status: WorkOrderStatus;
  totalAmount: Money;
  paidAmount: Money;
  createdAt: Date;
  customer: { id: string; name: string; phone: string };
  vehicle: { plateNumber: string };
}

// ---------------------------------------------------------------------------
// 配件 / 库存
// ---------------------------------------------------------------------------

export interface PartListRow {
  id: string;
  code: string | null;
  name: string;
  spec: string | null;
  brand: string | null;
  unit: string;
  categoryId: string | null;
  costPrice: Money;
  salePrice: Money;
  isActive: boolean;
  category: { name: string } | null;
  inventory: { quantity: Money; safeQuantity: Money; avgCost: Money } | null;
}

export interface InventoryTxRow {
  id: string;
  type: InventoryTxType;
  partId: string;
  quantity: Money;
  qtyBefore: Money;
  qtyAfter: Money;
  unitCost: Money | null;
  amount: Money | null;
  workOrderId: string | null;
  remark: string | null;
  createdAt: Date;
  part: { name: string };
  operator: { name: string } | null;
  workOrder: { orderNo: string } | null;
}

/** 配件详情主表（列表投影 + 详情专有字段） */
export interface PartDetailRow extends PartListRow {
  supplierId: string | null;
  remark: string | null;
  supplier: { name: string } | null;
  inventory: {
    quantity: Money;
    safeQuantity: Money;
    avgCost: Money;
    location: string | null;
  } | null;
}

/**
 * 库存估值明细行。
 * 「均价为 0 时回退进货价」属于金额口径，由领域层决定，仓储只提供原始值。
 */
export interface StockValuationLine {
  quantity: Money;
  avgCost: Money;
  partCostPrice: Money;
  /** 配件是否已软删除（已删配件不计入库存总额） */
  partDeletedAt: Date | null;
}

/** 某配件的累计销售汇总（配件详情页） */
export interface PartSalesAggregateRow {
  totalQuantity: Money | null;
  totalAmount: Money | null;
  orderCount: number;
}

/** 库存盘点 / 调整时需要的现状行 */
export interface PartStockLevelRow {
  id: string;
  name: string;
  quantity: Money | null;
}

/** 配件选择器行 */
export interface PartPickerRow {
  id: string;
  name: string;
  spec: string | null;
  unit: string;
  salePrice: Money;
  avgCost: Money | null;
  stockQuantity: Money | null;
}

/** 维修项目 / 工时目录行（工单选择器数据源） */
export interface ServiceItemPickerRow {
  id: string;
  code: string | null;
  name: string;
  kind: WorkOrderItemType;
  unit: string;
  defaultPrice: Money;
  costPrice: Money;
  categoryName: string | null;
}

/** 分类选项行 */
export interface CategoryOptionRow {
  id: string;
  name: string;
  kind: string;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// 账号 / 员工
// ---------------------------------------------------------------------------

export interface UserListRow {
  id: string;
  username: string;
  name: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  workOrderCount: number;
  paymentCount: number;
}

export interface EmployeeListRow {
  id: string;
  name: string;
  phone: string | null;
  position: string | null;
  isTechnician: boolean;
  isActive: boolean;
  userId: string | null;
  remark: string | null;
  workOrderCount: number;
}

// ---------------------------------------------------------------------------
// 全局搜索
// ---------------------------------------------------------------------------

export interface SearchCustomerRow {
  id: string;
  name: string;
  phone: string;
  vehicleCount: number;
}

export interface SearchVehicleRow {
  id: string;
  plateNumber: string;
  brand: string | null;
  model: string | null;
  customerName: string;
}

export interface SearchWorkOrderRow {
  id: string;
  orderNo: string;
  status: WorkOrderStatus;
  plateNumber: string;
  totalAmount: Money;
}

export interface SearchPartRow {
  id: string;
  name: string;
  spec: string | null;
  quantity: Money | null;
  safeQuantity: Money | null;
}

export interface VehicleSuggestionRow {
  id: string;
  plateNumber: string;
  customerName: string;
}

export interface CustomerSuggestionRow {
  id: string;
  name: string;
  phone: string;
}

/** 供应商选项行 */
export interface SupplierOptionRow {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
}

// ---------------------------------------------------------------------------
// 财务
// ---------------------------------------------------------------------------

export interface PaymentRow {
  id: string;
  amount: Money;
  method: PaymentMethod;
  category: IncomeCategory;
  source: IncomeSource;
  occurredAt: Date;
  remark: string | null;
  workOrderId: string | null;
  operator: { name: string } | null;
  workOrder: { orderNo: string } | null;
}

export interface ExpenseRow {
  id: string;
  category: ExpenseCategory;
  amount: Money;
  method: PaymentMethod;
  occurredAt: Date;
  remark: string | null;
  workOrderId: string | null;
  operator: { name: string } | null;
  supplier: { name: string } | null;
}
