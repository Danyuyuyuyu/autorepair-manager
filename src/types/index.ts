/**
 * 全局 DTO 类型
 * ---------------------------------------------------------------------------
 * 约定：所有金额 / 数量在跨越「服务端 → 客户端」边界时统一序列化为字符串，
 * 客户端只做展示与格式化，不做运算（运算统一在 src/lib/money.ts 中完成）。
 */
import type {
  ExpenseCategory,
  IncomeCategory,
  IncomeSource,
  InventoryTxType,
  PaymentMethod,
  Role,
  WorkOrderItemType,
  WorkOrderStatus,
} from "@prisma/client";

export type MoneyString = string;

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export interface CurrentUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  isAdmin: boolean;
}

// ---------------------------------------------------------------------------
// 工单
// ---------------------------------------------------------------------------

export interface WorkOrderItemDTO {
  id: string;
  type: WorkOrderItemType;
  itemRefId: string | null;
  name: string;
  spec: string | null;
  unit: string | null;
  quantity: MoneyString;
  unitPrice: MoneyString;
  costPrice: MoneyString;
  amount: MoneyString;
  remark: string | null;
  sortOrder: number;
}

export interface WorkOrderListItemDTO {
  id: string;
  orderNo: string;
  status: WorkOrderStatus;
  customerId: string;
  customerName: string;
  customerPhone: string;
  vehicleId: string;
  plateNumber: string;
  vehicleModel: string | null;
  totalAmount: MoneyString;
  paidAmount: MoneyString;
  outstandingAmount: MoneyString;
  itemCount: number;
  technicianName: string | null;
  faultDescription: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WorkOrderDetailDTO extends WorkOrderListItemDTO {
  customerWechat: string | null;
  mileage: number | null;
  vin: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  remark: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  serviceAmount: MoneyString;
  partsAmount: MoneyString;
  laborAmount: MoneyString;
  otherAmount: MoneyString;
  discountAmount: MoneyString;
  subtotal: MoneyString;
  partsCost: MoneyString;
  createdByName: string | null;
  items: WorkOrderItemDTO[];
  payments: PaymentDTO[];
  inventoryTxs: InventoryTxDTO[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 客户 / 车辆
// ---------------------------------------------------------------------------

export interface CustomerListItemDTO {
  id: string;
  name: string;
  phone: string;
  wechat: string | null;
  vehicleCount: number;
  workOrderCount: number;
  totalSpent: MoneyString;
  outstandingAmount: MoneyString;
  lastVisitAt: string | null;
  createdAt: string;
}

export interface CustomerDetailDTO extends CustomerListItemDTO {
  address: string | null;
  remark: string | null;
  vehicles: VehicleListItemDTO[];
  recentWorkOrders: WorkOrderListItemDTO[];
}

export interface VehicleListItemDTO {
  id: string;
  plateNumber: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  currentMileage: number | null;
  customerId: string;
  customerName: string;
  customerPhone: string;
  lastServiceAt: string | null;
  nextServiceAt: string | null;
}

export interface VehicleDetailDTO extends VehicleListItemDTO {
  engineNo: string | null;
  remark: string | null;
  workOrders: WorkOrderListItemDTO[];
  serviceRecords: VehicleServiceRecordDTO[];
  totalSpent: MoneyString;
  topParts: Array<{ name: string; quantity: MoneyString; amount: MoneyString }>;
  topServices: Array<{ name: string; quantity: MoneyString; amount: MoneyString }>;
}

export interface VehicleServiceRecordDTO {
  id: string;
  servicedAt: string;
  mileage: number | null;
  description: string;
  nextServiceAt: string | null;
  nextServiceMileage: number | null;
  workOrderId: string | null;
  workOrderNo: string | null;
}

// ---------------------------------------------------------------------------
// 收款 / 支出
// ---------------------------------------------------------------------------

export interface PaymentDTO {
  id: string;
  amount: MoneyString;
  method: PaymentMethod;
  category: IncomeCategory;
  source: IncomeSource;
  occurredAt: string;
  operatorName: string | null;
  remark: string | null;
  workOrderId: string | null;
  workOrderNo: string | null;
}

export interface ExpenseDTO {
  id: string;
  category: ExpenseCategory;
  amount: MoneyString;
  method: PaymentMethod;
  occurredAt: string;
  supplierName: string | null;
  operatorName: string | null;
  remark: string | null;
  workOrderId: string | null;
}

/** 统一收支流水（收入 + 支出合并视图） */
export interface CashFlowEntry {
  id: string;
  kind: "INCOME" | "EXPENSE";
  /** 分类枚举原始值，展示时通过 constants 中的映射翻译 */
  categoryLabel: string;
  amount: MoneyString;
  method: string;
  occurredAt: string;
  workOrderId: string | null;
  workOrderNo: string | null;
  operatorName: string | null;
  remark: string | null;
}

/** 财务汇总 */
export interface FinanceSummaryDTO {
  income: MoneyString;
  expense: MoneyString;
  profit: MoneyString;
  partsCost: MoneyString;
  grossProfit: MoneyString;
  grossMarginRate: number;
  orderCount: number;
  incomeByCategory: Array<{ category: IncomeCategory; amount: MoneyString; count: number }>;
  expenseByCategory: Array<{ category: ExpenseCategory; amount: MoneyString; count: number }>;
  incomeByMethod: Array<{ method: string; amount: MoneyString; count: number }>;
}

// ---------------------------------------------------------------------------
// 配件 / 库存
// ---------------------------------------------------------------------------

export interface PartListItemDTO {
  id: string;
  code: string | null;
  name: string;
  spec: string | null;
  brand: string | null;
  unit: string;
  categoryId: string | null;
  categoryName: string | null;
  quantity: MoneyString;
  safeQuantity: MoneyString;
  avgCost: MoneyString;
  costPrice: MoneyString;
  salePrice: MoneyString;
  stockValue: MoneyString;
  isLowStock: boolean;
  isActive: boolean;
}

export interface InventoryTxDTO {
  id: string;
  type: InventoryTxType;
  partId: string;
  partName: string;
  quantity: MoneyString;
  qtyBefore: MoneyString;
  qtyAfter: MoneyString;
  unitCost: MoneyString | null;
  amount: MoneyString | null;
  workOrderId: string | null;
  workOrderNo: string | null;
  operatorName: string | null;
  remark: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 首页 / 报表
// ---------------------------------------------------------------------------

export interface DashboardStatsDTO {
  /** 普通员工看不到金额时，UI 应展示「仅管理员可见」而不是 0 */
  financeVisible: boolean;
  todayRevenue: MoneyString;
  todayExpense: MoneyString;
  todayProfit: MoneyString;
  todayOrderCount: number;
  todayCompletedCount: number;
  pendingPaymentCount: number;
  pendingPaymentAmount: MoneyString;
  pendingDeliveryCount: number;
  lowStockCount: number;
  monthRevenue: MoneyString;
  monthExpense: MoneyString;
  monthProfit: MoneyString;
  customerCount: number;
  stockValue: MoneyString;
  outstandingAmount: MoneyString;
}

export interface ReportOverviewDTO {
  todayRevenue: MoneyString;
  monthRevenue: MoneyString;
  monthExpense: MoneyString;
  monthProfit: MoneyString;
  monthOrderCount: number;
  customerCount: number;
  stockValue: MoneyString;
  outstandingAmount: MoneyString;
  monthPartsCost: MoneyString;
  monthPartsRevenue: MoneyString;
  monthLaborRevenue: MoneyString;
  monthServiceRevenue: MoneyString;
  grossProfit: MoneyString;
  grossMarginRate: number;
  receivables: MoneyString;
}

export interface TrendPointDTO {
  date: string;
  revenue: MoneyString;
  expense: MoneyString;
  profit: MoneyString;
  orderCount: number;
}

export interface RankingItemDTO {
  name: string;
  quantity: MoneyString;
  amount: MoneyString;
  count?: number;
}

export interface ReportChartsDTO {
  trend: TrendPointDTO[];
  serviceRanking: RankingItemDTO[];
  partRanking: RankingItemDTO[];
  paymentMethodStats: Array<{ method: PaymentMethod; amount: MoneyString; count: number }>;
}

// ---------------------------------------------------------------------------
// 搜索
// ---------------------------------------------------------------------------

export interface GlobalSearchResult {
  customers: Array<{ id: string; name: string; phone: string; vehicleCount: number }>;
  vehicles: Array<{
    id: string;
    plateNumber: string;
    brand: string | null;
    model: string | null;
    customerName: string;
  }>;
  workOrders: Array<{
    id: string;
    orderNo: string;
    status: WorkOrderStatus;
    plateNumber: string;
    totalAmount: MoneyString;
  }>;
  parts: Array<{
    id: string;
    name: string;
    spec: string | null;
    stockValue: MoneyString;
    isLowStock: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// 审计日志
// ---------------------------------------------------------------------------

export interface AuditLogDTO {
  id: string;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string;
  summary: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

/** 员工账号 */
export interface UserListItemDTO {
  id: string;
  username: string;
  name: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  workOrderCount: number;
  paymentCount: number;
}

/** 技师档案 */
export interface EmployeeDTO {
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

/** 维修项目 / 工时目录项 */
export interface ServiceItemOptionDTO {
  id: string;
  code: string | null;
  name: string;
  kind: WorkOrderItemType;
  unit: string;
  defaultPrice: MoneyString;
  costPrice: MoneyString;
  categoryName: string | null;
}

// ---------------------------------------------------------------------------
// 通用分页
// ---------------------------------------------------------------------------

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
