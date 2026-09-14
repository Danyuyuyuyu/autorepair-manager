/**
 * SQLite 业务表清单 —— 全项目单一口径
 * ---------------------------------------------------------------------------
 * 用途：
 *   - 备份完整性校验：备份文件必须包含全部业务表
 *   - 迁移计划交叉校验：PRAGMA 推出的表集合必须与这里一致（多了/少了都要报错）
 *   - 目标库「是否为空」判定：逐表计数后再决定是否允许覆盖
 *
 * 新增 migration 建表时，**必须**同步维护本清单，否则备份会被判为不完整。
 * 版本表 `schema_version` 单独列出：它是 migration 运行器的元数据，不是业务表。
 */

export const SQLITE_BUSINESS_TABLES = [
  "app_settings",
  "audit_logs",
  "categories",
  "customers",
  "employees",
  "expenses",
  "inventories",
  "inventory_transactions",
  "parts",
  "payments",
  "service_items",
  "sessions",
  "suppliers",
  "users",
  "vehicle_service_records",
  "vehicles",
  "work_order_items",
  "work_orders",
] as const;

export type SqliteBusinessTable = (typeof SQLITE_BUSINESS_TABLES)[number];

/** migration 运行器的版本表（由 migrate() 自动创建） */
export const SQLITE_VERSION_TABLE = "schema_version";
