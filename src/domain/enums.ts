/**
 * 领域枚举 —— 后端无关的唯一来源
 * ---------------------------------------------------------------------------
 * 为什么不用 Prisma 生成的枚举？
 * 因为手机端（Capacitor + SQLite）跑不了 Prisma。业务层一旦 import 了
 * `@prisma/client` 的枚举类型，整个领域层就被绑死在 Prisma 上，手机端无法复用。
 *
 * 这里用「字符串字面量联合 + as const 数组」定义枚举：
 *   - 运行时是普通字符串，SQLite / PostgreSQL / 内存实现都能直接用
 *   - 类型层是联合类型，写错值直接编译报错
 *
 * 与 Prisma 生成枚举的一致性由 `src/server/repos/prisma/type-assertions.ts`
 * 在编译期双向校验，不会漂移。
 */

// ---------------------------------------------------------------------------
// 账号 / 权限
// ---------------------------------------------------------------------------

export const ROLES = ["ADMIN", "STAFF"] as const;
export type Role = (typeof ROLES)[number];

// ---------------------------------------------------------------------------
// 工单
// ---------------------------------------------------------------------------

/** 工单状态（严格按店内实际流转顺序） */
export const WORK_ORDER_STATUSES = [
  "PENDING_INTAKE", // 待接车
  "IN_PROGRESS", // 维修中
  "PENDING_QC", // 待质检
  "PENDING_PAYMENT", // 待付款
  "COMPLETED", // 已完成
  "CANCELLED", // 已取消
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** 工单项类型 */
export const WORK_ORDER_ITEM_TYPES = ["SERVICE", "PART", "LABOR", "OTHER"] as const;
export type WorkOrderItemType = (typeof WORK_ORDER_ITEM_TYPES)[number];

// ---------------------------------------------------------------------------
// 资金
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = ["CASH", "WECHAT", "ALIPAY", "BANK_CARD", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const EXPENSE_CATEGORIES = [
  "PART_PURCHASE",
  "RENT",
  "UTILITY",
  "SALARY",
  "TOOL_EQUIPMENT",
  "LOGISTICS",
  "OTHER",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const INCOME_CATEGORIES = ["REPAIR_SERVICE", "PART_SALE", "LABOR", "OTHER"] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

/** 收入来源：工单收款 / 手工登记 */
export const INCOME_SOURCES = ["WORK_ORDER", "MANUAL"] as const;
export type IncomeSource = (typeof INCOME_SOURCES)[number];

// ---------------------------------------------------------------------------
// 库存 / 目录
// ---------------------------------------------------------------------------

export const INVENTORY_TX_TYPES = [
  "PURCHASE_IN",
  "WORKORDER_OUT",
  "RETURN_IN",
  "ADJUST",
  "STOCKTAKE",
] as const;
export type InventoryTxType = (typeof INVENTORY_TX_TYPES)[number];

export const CATEGORY_KINDS = ["PART", "SERVICE", "EXPENSE", "INCOME"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
