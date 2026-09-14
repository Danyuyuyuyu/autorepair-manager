import type {
  CategoryKind as PrismaCategoryKind,
  Customer as PrismaCustomer,
  Expense as PrismaExpense,
  ExpenseCategory as PrismaExpenseCategory,
  IncomeCategory as PrismaIncomeCategory,
  IncomeSource as PrismaIncomeSource,
  Inventory as PrismaInventory,
  InventoryTransaction as PrismaInventoryTransaction,
  InventoryTxType as PrismaInventoryTxType,
  Part as PrismaPart,
  Payment as PrismaPayment,
  PaymentMethod as PrismaPaymentMethod,
  Prisma,
  Role as PrismaRole,
  ServiceItem as PrismaServiceItem,
  Supplier as PrismaSupplier,
  User as PrismaUser,
  Vehicle as PrismaVehicle,
  VehicleServiceRecord as PrismaVehicleServiceRecord,
  WorkOrder as PrismaWorkOrder,
  WorkOrderItem as PrismaWorkOrderItem,
  WorkOrderItemType as PrismaWorkOrderItemType,
  WorkOrderStatus as PrismaWorkOrderStatus,
} from "@prisma/client";

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
import type {
  Customer,
  Expense,
  Inventory,
  InventoryTransaction,
  Part,
  Payment,
  ServiceItem,
  Supplier,
  User,
  Vehicle,
  VehicleServiceRecord,
  WorkOrder,
  WorkOrderItem,
} from "@/domain/entities";
import type { Money } from "@/domain/entities";
import type {
  CustomerListRow,
  DueServiceVehicleRow,
  ExpenseRow,
  InventoryTxRow,
  PartDetailRow,
  PartListRow,
  PartPickerRow,
  PartSalesAggregateRow,
  PaymentRow,
  ServiceItemPickerRow,
  UnsettledOrderRow,
  VehicleDetailBaseRow,
  VehicleItemHistoryRow,
  VehicleListRow,
  VehicleOrderBriefRow,
  VehicleServiceRecordRow,
  WorkOrderDetailRow,
  WorkOrderListRow,
  WorkOrderMutationRow,
  WorkOrderTotalsRow,
} from "@/domain/rows";
import type {
  customerListSelect,
  expenseSelect,
  inventoryTxSelect,
  partListSelect,
  paymentSelect,
  vehicleListSelect,
  workOrderDetailSelect,
  workOrderListSelect,
} from "@/server/selects";

/**
 * 编译期一致性证明 —— 不产生任何运行时代码
 * ---------------------------------------------------------------------------
 * 领域层（src/domain）刻意不依赖 Prisma。代价是「手写类型」可能与 Prisma 生成类型脱节。
 * 本文件用类型约束把这件事变成编译错误：
 *
 *   - 枚举：Prisma 生成的联合类型必须能赋给领域枚举
 *   - 实体：Prisma 模型必须能赋给领域实体
 *   - 投影：Prisma 的 select 推导结果必须能赋给领域行类型
 *
 * 任何一端加字段、改可空性、改类型，只要不一致就会 `tsc` 报错 —— 无法静默漂移。
 *
 * 验证方式（已实测）：把 `WorkOrderListRow.totalAmount` 从 Decimal 改成 string，
 * 本文件立刻报 3 处错误。
 *
 * 本文件只有类型，运行时不产生任何代码，可以安全地被 tree-shaking 掉。
 */

/** 断言 `Derived` 可以赋给 `Base`（不满足即编译失败） */
type AssertExtends<Base, Derived extends Base> = Derived;

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

export type EnumRole = AssertExtends<Role, PrismaRole>;
export type EnumWorkOrderStatus = AssertExtends<WorkOrderStatus, PrismaWorkOrderStatus>;
export type EnumWorkOrderItemType = AssertExtends<WorkOrderItemType, PrismaWorkOrderItemType>;
export type EnumInventoryTxType = AssertExtends<InventoryTxType, PrismaInventoryTxType>;
export type EnumPaymentMethod = AssertExtends<PaymentMethod, PrismaPaymentMethod>;
export type EnumExpenseCategory = AssertExtends<ExpenseCategory, PrismaExpenseCategory>;
export type EnumIncomeCategory = AssertExtends<IncomeCategory, PrismaIncomeCategory>;
export type EnumIncomeSource = AssertExtends<IncomeSource, PrismaIncomeSource>;
export type EnumCategoryKind = AssertExtends<CategoryKind, PrismaCategoryKind>;

// ---------------------------------------------------------------------------
// 实体
// ---------------------------------------------------------------------------

export type EntityUser = AssertExtends<User, PrismaUser>;
export type EntityCustomer = AssertExtends<Customer, PrismaCustomer>;
export type EntityVehicle = AssertExtends<Vehicle, PrismaVehicle>;
export type EntityVehicleServiceRecord = AssertExtends<
  VehicleServiceRecord,
  PrismaVehicleServiceRecord
>;
export type EntityWorkOrder = AssertExtends<WorkOrder, PrismaWorkOrder>;
export type EntityWorkOrderItem = AssertExtends<WorkOrderItem, PrismaWorkOrderItem>;
export type EntityPayment = AssertExtends<Payment, PrismaPayment>;
export type EntityExpense = AssertExtends<Expense, PrismaExpense>;
export type EntityPart = AssertExtends<Part, PrismaPart>;
export type EntityInventory = AssertExtends<Inventory, PrismaInventory>;
export type EntityInventoryTransaction = AssertExtends<
  InventoryTransaction,
  PrismaInventoryTransaction
>;
export type EntitySupplier = AssertExtends<Supplier, PrismaSupplier>;
export type EntityServiceItem = AssertExtends<ServiceItem, PrismaServiceItem>;

// ---------------------------------------------------------------------------
// 查询投影
// ---------------------------------------------------------------------------

export type ProjectionWorkOrderList = AssertExtends<
  WorkOrderListRow,
  Prisma.WorkOrderGetPayload<{ select: typeof workOrderListSelect }>
>;
export type ProjectionWorkOrderDetail = AssertExtends<
  WorkOrderDetailRow,
  Prisma.WorkOrderGetPayload<{ select: typeof workOrderDetailSelect }>
>;
export type ProjectionCustomerList = AssertExtends<
  CustomerListRow,
  Prisma.CustomerGetPayload<{ select: typeof customerListSelect }>
>;
export type ProjectionVehicleList = AssertExtends<
  VehicleListRow,
  Prisma.VehicleGetPayload<{ select: typeof vehicleListSelect }>
>;
export type ProjectionPartList = AssertExtends<
  PartListRow,
  Prisma.PartGetPayload<{ select: typeof partListSelect }>
>;
export type ProjectionInventoryTx = AssertExtends<
  InventoryTxRow,
  Prisma.InventoryTransactionGetPayload<{ select: typeof inventoryTxSelect }>
>;
export type ProjectionPayment = AssertExtends<
  PaymentRow,
  Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>
>;
export type ProjectionExpense = AssertExtends<
  ExpenseRow,
  Prisma.ExpenseGetPayload<{ select: typeof expenseSelect }>
>;

// 内联投影（写在仓储实现里、没有独立 select 常量的查询）单独断言，
// 保证仓储实现改了字段却忘了改领域行类型时同样会编译失败。
type MutationRowPayload = Prisma.WorkOrderGetPayload<{
  select: {
    id: true;
    orderNo: true;
    status: true;
    createdBy: true;
    customerId: true;
    vehicleId: true;
    discountAmount: true;
    totalAmount: true;
    paidAmount: true;
    mileage: true;
    vehicle: { select: { plateNumber: true } };
    customer: { select: { name: true } };
  };
}>;
export type ProjectionWorkOrderMutation = AssertExtends<WorkOrderMutationRow, MutationRowPayload>;

type TotalsSourcePayload = Prisma.WorkOrderGetPayload<{
  select: {
    discountAmount: true;
    items: { select: { type: true; quantity: true; unitPrice: true; costPrice: true } };
  };
}>;
export type ProjectionWorkOrderTotals = AssertExtends<WorkOrderTotalsRow, TotalsSourcePayload>;

/** 未结清工单候选行（待收款页） */
type UnsettledOrderPayload = Prisma.WorkOrderGetPayload<{
  select: {
    id: true;
    orderNo: true;
    status: true;
    totalAmount: true;
    paidAmount: true;
    createdAt: true;
    customer: { select: { id: true; name: true; phone: true } };
    vehicle: { select: { plateNumber: true } };
  };
}>;
export type ProjectionUnsettledOrder = AssertExtends<UnsettledOrderRow, UnsettledOrderPayload>;

/**
 * 说明：`CustomerOrderStatsRow`（客户消费汇总）走的是 groupBy + 显式映射，
 * 适配器的 `return` 语句本身已被接口返回类型检查，无需额外断言 ——
 * 任何字段不匹配都会在 `createCustomerRepository` 的返回值处直接编译失败。
 */

/** 车辆详情主表（列表投影 + engineNo / remark） */
type VehicleDetailBasePayload = Prisma.VehicleGetPayload<{
  select: typeof vehicleListSelect & { engineNo: true; remark: true };
}>;
export type ProjectionVehicleDetailBase = AssertExtends<
  VehicleDetailBaseRow,
  VehicleDetailBasePayload
>;

/** 车辆保养记录（带工单号） */
type VehicleServiceRecordPayload = Prisma.VehicleServiceRecordGetPayload<{
  select: {
    id: true;
    vehicleId: true;
    workOrderId: true;
    servicedAt: true;
    mileage: true;
    description: true;
    nextServiceAt: true;
    nextServiceMileage: true;
    createdBy: true;
    createdAt: true;
    workOrder: { select: { orderNo: true } };
  };
}>;
export type ProjectionVehicleServiceRecord = AssertExtends<
  VehicleServiceRecordRow,
  VehicleServiceRecordPayload
>;

/** 车辆最近工单摘要 */
type VehicleOrderBriefPayload = Prisma.WorkOrderGetPayload<{
  select: { id: true; orderNo: true; createdAt: true; mileage: true; totalAmount: true };
}>;
export type ProjectionVehicleOrderBrief = AssertExtends<
  VehicleOrderBriefRow,
  VehicleOrderBriefPayload
>;

/** 车辆历史用料/用工明细 */
type VehicleItemHistoryPayload = Prisma.WorkOrderItemGetPayload<{
  select: { type: true; name: true; quantity: true; amount: true };
}>;
export type ProjectionVehicleItemHistory = AssertExtends<
  VehicleItemHistoryRow,
  VehicleItemHistoryPayload
>;

/** 临近保养提醒行 */
type DueServiceVehiclePayload = Prisma.VehicleGetPayload<{
  select: {
    id: true;
    plateNumber: true;
    nextServiceAt: true;
    currentMileage: true;
    customer: { select: { name: true; phone: true } };
  };
}>;
export type ProjectionDueServiceVehicle = AssertExtends<
  DueServiceVehicleRow,
  DueServiceVehiclePayload
>;

/** 配件详情主表（列表投影 + supplier / inventory.location） */
type PartDetailPayload = Prisma.PartGetPayload<{
  select: typeof partListSelect & {
    supplierId: true;
    remark: true;
    supplier: { select: { name: true } };
    inventory: { select: { quantity: true; safeQuantity: true; avgCost: true; location: true } };
  };
}>;
export type ProjectionPartDetail = AssertExtends<PartDetailRow, PartDetailPayload>;

/** 配件编辑回填行 */
type PartForEditPayload = Prisma.PartGetPayload<{
  select: {
    id: true;
    code: true;
    name: true;
    spec: true;
    brand: true;
    unit: true;
    categoryId: true;
    supplierId: true;
    remark: true;
    inventory: { select: { safeQuantity: true; location: true } };
  };
}>;
export type ProjectionPartForEdit = AssertExtends<
  {
    id: string;
    code: string | null;
    name: string;
    spec: string | null;
    brand: string | null;
    unit: string;
    categoryId: string | null;
    supplierId: string | null;
    remark: string | null;
    safeQuantity: Money | null;
    location: string | null;
  },
  Omit<PartForEditPayload, "inventory"> & {
    safeQuantity: Money | null;
    location: string | null;
  }
>;

/** 配件选择器行（库存字段被适配器拍平） */
type PartPickerPayload = Prisma.PartGetPayload<{
  select: {
    id: true;
    name: true;
    spec: true;
    unit: true;
    salePrice: true;
    inventory: { select: { quantity: true; avgCost: true } };
  };
}>;
export type ProjectionPartPicker = AssertExtends<
  PartPickerRow,
  Omit<PartPickerPayload, "inventory"> & {
    avgCost: Money | null;
    stockQuantity: Money | null;
  }
>;

/** 维修项目 / 工时目录行 */
type ServiceItemPickerPayload = Prisma.ServiceItemGetPayload<{
  select: {
    id: true;
    code: true;
    name: true;
    kind: true;
    unit: true;
    defaultPrice: true;
    costPrice: true;
    category: { select: { name: true } };
  };
}>;
export type ProjectionServiceItemPicker = AssertExtends<
  ServiceItemPickerRow,
  Omit<ServiceItemPickerPayload, "kind" | "category"> & {
    kind: WorkOrderItemType;
    categoryName: string | null;
  }
>;

/** 配件累计销售汇总 */
type PartSalesAggregatePayload = {
  totalQuantity: Money | null;
  totalAmount: Money | null;
  orderCount: number;
};
export type ProjectionPartSalesAggregate = AssertExtends<
  PartSalesAggregateRow,
  PartSalesAggregatePayload
>;
