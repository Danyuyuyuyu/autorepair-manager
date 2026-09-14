/**
 * 领域常量：所有中文文案、状态流转、导航配置的唯一来源。
 * 页面 / 组件只允许引用这里的映射，不允许各写一份 label。
 */
import type {
  ExpenseCategory,
  IncomeCategory,
  InventoryTxType,
  PaymentMethod,
  Role,
  WorkOrderItemType,
  WorkOrderStatus,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// 角色
// ---------------------------------------------------------------------------
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "管理员",
  STAFF: "员工",
};

// ---------------------------------------------------------------------------
// 工单状态
// ---------------------------------------------------------------------------
export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  PENDING_INTAKE: "待接车",
  IN_PROGRESS: "维修中",
  PENDING_QC: "待质检",
  PENDING_PAYMENT: "待付款",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

export const WORK_ORDER_STATUS_ORDER: WorkOrderStatus[] = [
  "PENDING_INTAKE",
  "IN_PROGRESS",
  "PENDING_QC",
  "PENDING_PAYMENT",
  "COMPLETED",
  "CANCELLED",
];

/** Tailwind 语义色类名（不使用写死色值，保证主题统一） */
export const WORK_ORDER_STATUS_TONE: Record<WorkOrderStatus, string> = {
  PENDING_INTAKE: "bg-info-soft text-info-strong border-info-border",
  IN_PROGRESS: "bg-warning-soft text-warning-strong border-warning-border",
  PENDING_QC: "bg-brand-soft text-brand-strong border-brand-border",
  PENDING_PAYMENT: "bg-danger-soft text-danger-strong border-danger-border",
  COMPLETED: "bg-success-soft text-success-strong border-success-border",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

/**
 * 允许的状态流转（服务端强制校验）。
 * ---------------------------------------------------------------------------
 * 主链路：待接车 → 维修中 → 待质检 →（待付款）→ 已完成
 *
 * 两个刻意的「捷径」：
 * - 待质检 → 已完成：质检通过且款项已结清（进店先付款、月结客户、保修单）时，
 *   强制绕一圈「待付款」在语义上是错的，也让店员无法交车。
 * - 待质检 / 待付款 → 维修中：质检不合格或客户追加项目时返工。
 *
 * 已取消 / 已完成 为终态：报废的账不能改，只能新开一张工单。
 */
export const WORK_ORDER_STATUS_FLOW: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  PENDING_INTAKE: ["IN_PROGRESS", "PENDING_PAYMENT", "CANCELLED"],
  IN_PROGRESS: ["PENDING_QC", "PENDING_PAYMENT", "CANCELLED"],
  PENDING_QC: ["IN_PROGRESS", "PENDING_PAYMENT", "COMPLETED", "CANCELLED"],
  PENDING_PAYMENT: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return WORK_ORDER_STATUS_FLOW[from].includes(to);
}

// ---------------------------------------------------------------------------
// 工单项类型
// ---------------------------------------------------------------------------
export const ITEM_TYPE_LABELS: Record<WorkOrderItemType, string> = {
  SERVICE: "维修项目",
  PART: "配件",
  LABOR: "工时",
  OTHER: "其他费用",
};

export const ITEM_TYPE_ORDER: WorkOrderItemType[] = ["SERVICE", "PART", "LABOR", "OTHER"];

// ---------------------------------------------------------------------------
// 支付方式
// ---------------------------------------------------------------------------
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "现金",
  WECHAT: "微信",
  ALIPAY: "支付宝",
  BANK_CARD: "银行卡",
  OTHER: "其他",
};

// ---------------------------------------------------------------------------
// 收入 / 支出分类
// ---------------------------------------------------------------------------
export const INCOME_CATEGORY_LABELS: Record<IncomeCategory, string> = {
  REPAIR_SERVICE: "维修收入",
  PART_SALE: "配件收入",
  LABOR: "工时收入",
  OTHER: "其他收入",
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  PART_PURCHASE: "配件采购",
  RENT: "房租",
  UTILITY: "水电",
  SALARY: "工资",
  TOOL_EQUIPMENT: "工具设备",
  LOGISTICS: "物流",
  OTHER: "其他支出",
};

// ---------------------------------------------------------------------------
// 库存流水
// ---------------------------------------------------------------------------
export const INVENTORY_TX_LABELS: Record<InventoryTxType, string> = {
  PURCHASE_IN: "采购入库",
  WORKORDER_OUT: "工单出库",
  RETURN_IN: "退单入库",
  ADJUST: "库存调整",
  STOCKTAKE: "库存盘点",
};

export const INVENTORY_IN_TYPES: InventoryTxType[] = ["PURCHASE_IN", "RETURN_IN"];
export const INVENTORY_OUT_TYPES: InventoryTxType[] = ["WORKORDER_OUT"];

// ---------------------------------------------------------------------------
// 常用单位
// ---------------------------------------------------------------------------
export const UNIT_OPTIONS = [
  "个",
  "套",
  "件",
  "只",
  "桶",
  "升",
  "米",
  "条",
  "对",
  "副",
  "项",
  "次",
  "小时",
];

// ---------------------------------------------------------------------------
// 导航
// ---------------------------------------------------------------------------
export interface NavItem {
  href: string;
  label: string;
  /** lucide icon name */
  icon: string;
  /** 仅管理员可见（财务等敏感页） */
  adminOnly?: boolean;
  /** 是否出现在手机端底部导航 */
  mobile: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "首页", icon: "Home", mobile: true },
  { href: "/work-orders", label: "工单", icon: "ClipboardList", mobile: true },
  { href: "/customers", label: "客户", icon: "Users", mobile: true },
  { href: "/inventory", label: "库存", icon: "Package", mobile: true },
  { href: "/me", label: "我的", icon: "UserCircle", mobile: true },
  { href: "/vehicles", label: "车辆", icon: "Car", mobile: false },
  { href: "/finance", label: "财务", icon: "Wallet", adminOnly: true, mobile: false },
  { href: "/reports", label: "报表", icon: "BarChart3", adminOnly: true, mobile: false },
  { href: "/settings", label: "设置", icon: "Settings", adminOnly: true, mobile: false },
];

export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((item) => item.mobile);

// ---------------------------------------------------------------------------
// 工单编号
// ---------------------------------------------------------------------------
export const ORDER_NO_PREFIX = "RO";
export const ORDER_NO_PATTERN = /^RO\d{8}\d{3}$/;

// ---------------------------------------------------------------------------
// 分页
// ---------------------------------------------------------------------------
export const DEFAULT_PAGE_SIZE = 20;
export const MOBILE_PAGE_SIZE = 15;
export const MAX_PAGE_SIZE = 100;
