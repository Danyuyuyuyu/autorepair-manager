import type { SQLiteDBConnection } from "@capacitor-community/sqlite";

import { queryOne, queryRows } from "./sqlite-helpers";

const MOBILE_BOOTSTRAP_KEY = "system.mobile.bootstrap.completed";
const EMPTY_BOOTSTRAP_TABLES = [
  "users",
  "sessions",
  "employees",
  "customers",
  "vehicles",
  "work_orders",
  "work_order_items",
  "payments",
  "expenses",
  "categories",
  "parts",
  "inventories",
  "inventory_transactions",
  "suppliers",
  "service_items",
  "vehicle_service_records",
  "audit_logs",
] as const;

export interface MobileBootstrapCounts {
  customers: number;
  vehicles: number;
  workOrders: number;
  payments: number;
  expenses: number;
}

export interface MobileBootstrapResult {
  outcome: "initialized" | "already-ready";
  counts: MobileBootstrapCounts;
}

async function tableCount(db: SQLiteDBConnection, table: string): Promise<number> {
  const row = await queryOne<{ count: number }>(db, `SELECT COUNT(*) AS count FROM ${table}`);
  return Number(row?.count ?? 0);
}

async function bootstrapCounts(db: SQLiteDBConnection): Promise<MobileBootstrapCounts> {
  return {
    customers: await tableCount(db, "customers"),
    vehicles: await tableCount(db, "vehicles"),
    workOrders: await tableCount(db, "work_orders"),
    payments: await tableCount(db, "payments"),
    expenses: await tableCount(db, "expenses"),
  };
}

/**
 * Mobile 首次运行只认领空业务库，不创建 demo 数据。
 * 本地身份在 User/Audit 切片单独决策；Customer 切片允许 createdBy=null。
 */
export async function bootstrapMobileDatabase(
  db: SQLiteDBConnection,
): Promise<MobileBootstrapResult> {
  const marker = await queryOne<{ value: string }>(
    db,
    "SELECT value FROM app_settings WHERE key = ?",
    [MOBILE_BOOTSTRAP_KEY],
  );
  if (marker) {
    if (marker.value !== "1") {
      throw new Error(`Mobile bootstrap marker 非法：${marker.value}`);
    }
    return { outcome: "already-ready", counts: await bootstrapCounts(db) };
  }

  const populated: Array<{ table: string; count: number }> = [];
  for (const table of EMPTY_BOOTSTRAP_TABLES) {
    const count = await tableCount(db, table);
    if (count > 0) populated.push({ table, count });
  }
  if (populated.length > 0) {
    throw new Error(
      `Mobile bootstrap 拒绝认领非空且无 marker 的数据库：${populated
        .map((entry) => `${entry.table}=${entry.count}`)
        .join(", ")}`,
    );
  }

  await db.beginTransaction();
  try {
    await db.run(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
      [MOBILE_BOOTSTRAP_KEY, "1", new Date().toISOString()],
      false,
    );
    await db.commitTransaction();
  } catch (error) {
    await db.rollbackTransaction().catch(() => undefined);
    throw error;
  }
  return { outcome: "initialized", counts: await bootstrapCounts(db) };
}

export async function listMobileBusinessTableCounts(
  db: SQLiteDBConnection,
): Promise<Record<string, number>> {
  const rows = await queryRows<{ name: string }>(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_version'
     ORDER BY name`,
  );
  const counts: Record<string, number> = {};
  for (const { name } of rows) counts[name] = await tableCount(db, name);
  return counts;
}
