/**
 * 迁移校验：把「迁移成功」从一句声称变成一组可核对的事实
 * ---------------------------------------------------------------------------
 * 七层校验（任何一层不过 → 迁移验收失败）：
 *   1. 逐表 Count：PostgreSQL vs SQLite
 *   2. SQLite 外键自检：PRAGMA foreign_key_check
 *   3. 孤儿关系：遍历**真实外键边**，两侧各查一次（不是只看 count）
 *   4. 业务聚合对账：用领域仓储在两种存储上各算一遍（客户/车辆/工单/应收/
 *      已收/欠款/收款/支出/库存数量/库存估值/流水/Audit）
 *   5. 全表逐行逐列对账：所有业务表的每一行、每一列都按领域语义归一化后比较
 *      （Decimal 两位小数、DateTime ISO、Boolean 0/1、JSON 语义等价）
 *   6. 工单专项：totalAmount / paidAmount / outstandingAmount / status /
 *      customerId / vehicleId 全量比较（不是只比总额）
 *   7. 配件库存专项：数量 / 安全库存 / 进货价 / 销售价 / 库存估值
 * 另附 §12 要求的边界样本：金额边界值转换、日期最早/最晚、Audit JSON 语义。
 */
import type { PrismaClient } from "@prisma/client";
import type { DatabaseSync } from "node:sqlite";

import type { Repositories } from "@/domain/repositories";
import { D } from "@/lib/money";
import { createRepositories } from "@/server/repos/prisma";
import { createSqliteRepositories } from "@/server/repos/sqlite/factory";
import { toDbDecimal } from "@/server/repos/sqlite/decimal";
import {
  DECIMAL_BOUNDARY_VALUES,
  messageOf,
  snakeCase,
  toSqliteValue,
  type ColumnKind,
  type MigrationPlan,
} from "@/server/migration/plan";

const EPOCH = new Date(0);
const FAR_FUTURE = new Date("9999-12-31T23:59:59.999Z");

export interface TableCountComparison {
  table: string;
  postgres: number;
  sqlite: number;
  equal: boolean;
}

export interface AggregateComparison {
  key: string;
  label: string;
  postgres: string;
  sqlite: string;
  equal: boolean;
}

export interface OrphanComparison {
  relation: string;
  postgres: number;
  sqlite: number;
  equal: boolean;
}

export interface RowMismatch {
  id: string;
  fields: string[];
}

export interface TableRowDiff {
  table: string;
  compared: number;
  mismatches: RowMismatch[];
  missingInSqlite: string[];
  missingInPostgres: string[];
}

export interface FieldDiff {
  model: string;
  compared: number;
  mismatches: RowMismatch[];
  missingInSqlite: string[];
  missingInPostgres: string[];
}

export interface SampleComparison {
  label: string;
  postgres: string;
  sqlite: string;
  equal: boolean;
}

export interface MigrationVerification {
  counts: TableCountComparison[];
  countMismatches: number;
  foreignKeyCheck: { violations: number; rows: unknown[] };
  orphans: OrphanComparison[];
  orphanViolations: number;
  aggregates: AggregateComparison[];
  aggregateMismatches: number;
  rows: TableRowDiff[];
  rowsCompared: number;
  rowMismatchCount: number;
  workOrders: FieldDiff;
  parts: FieldDiff;
  samples: SampleComparison[];
  sampleMismatches: number;
  jsonCompared: number;
  errors: string[];
  ok: boolean;
}

// ---------------------------------------------------------------------------
// 归一化
// ---------------------------------------------------------------------------

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function normalizeCell(kind: ColumnKind, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case "decimal":
      return toDbDecimal(String(value));
    case "date": {
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
    }
    case "bool":
      return value === true || Number(value) === 1 || value === "1" ? "1" : "0";
    case "json":
      return stableStringify(typeof value === "string" ? safeJsonParse(value) : value);
    default:
      return String(value);
  }
}

function money(value: unknown): string {
  return D(String(value ?? "0")).toFixed(2);
}

// ---------------------------------------------------------------------------
// PostgreSQL 列名解析（schema 里可能有 @map，不能假设 camelCase）
// ---------------------------------------------------------------------------

async function resolvePostgresColumns(
  prisma: PrismaClient,
  tables: string[],
): Promise<Map<string, string[]>> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_name = ANY($1::text[])`,
    tables,
  )) as Array<{ table_name: string; column_name: string }>;
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.table_name) ?? [];
    list.push(row.column_name);
    map.set(row.table_name, list);
  }
  return map;
}

function pgColumn(columns: Map<string, string[]>, table: string, field: string): string {
  const available = columns.get(table);
  if (!available) throw new Error(`PostgreSQL 表 ${table} 不存在`);
  if (available.includes(field)) return field;
  const snake = snakeCase(field);
  if (available.includes(snake)) return snake;
  throw new Error(
    `PostgreSQL 表 ${table} 找不到字段 ${field} 对应的列（现有：${available.join(", ")}）`,
  );
}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// 1. 逐表 Count
// ---------------------------------------------------------------------------

async function compareCounts(
  prisma: PrismaClient,
  sqliteDb: DatabaseSync,
  plan: MigrationPlan,
): Promise<TableCountComparison[]> {
  const result: TableCountComparison[] = [];
  const client = prisma as unknown as Record<string, { count: () => Promise<number> }>;
  for (const table of plan.tables) {
    const postgres = await client[table.accessor]!.count();
    const row = sqliteDb.prepare(`SELECT count(*) AS c FROM ${table.table}`).get() as { c: number };
    const sqlite = Number(row.c);
    result.push({ table: table.table, postgres, sqlite, equal: postgres === sqlite });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. 孤儿关系（沿真实外键边）
// ---------------------------------------------------------------------------

function countSqliteOrphans(sqliteDb: DatabaseSync, plan: MigrationPlan): OrphanComparison[] {
  return plan.foreignKeys.map((edge) => {
    const sql =
      `SELECT count(*) AS c FROM ${edge.childTable} ch ` +
      `LEFT JOIN ${edge.parentTable} pa ON pa.${edge.parentColumn} = ch.${edge.childColumn} ` +
      `WHERE ch.${edge.childColumn} IS NOT NULL AND pa.${edge.parentColumn} IS NULL`;
    const row = sqliteDb.prepare(sql).get() as { c: number };
    return {
      relation: `${edge.childTable}.${edge.childColumn} → ${edge.parentTable}.${edge.parentColumn}`,
      postgres: -1,
      sqlite: Number(row.c),
      equal: false,
    };
  });
}

async function compareOrphans(
  prisma: PrismaClient,
  sqliteDb: DatabaseSync,
  plan: MigrationPlan,
  pgColumns: Map<string, string[]>,
): Promise<OrphanComparison[]> {
  const sqliteChecks = countSqliteOrphans(sqliteDb, plan);
  const result: OrphanComparison[] = [];
  for (let index = 0; index < plan.foreignKeys.length; index += 1) {
    const edge = plan.foreignKeys[index]!;
    const child = pgColumn(pgColumns, edge.childTable, edge.childField);
    const parent = pgColumn(pgColumns, edge.parentTable, edge.parentField);
    const sql =
      `SELECT count(*)::int AS c FROM ${quote(edge.childTable)} ch ` +
      `LEFT JOIN ${quote(edge.parentTable)} pa ON pa.${quote(parent)} = ch.${quote(child)} ` +
      `WHERE ch.${quote(child)} IS NOT NULL AND pa.${quote(parent)} IS NULL`;
    const rows = (await prisma.$queryRawUnsafe(sql)) as Array<{ c: number }>;
    const postgres = Number(rows[0]?.c ?? 0);
    const sqlite = sqliteChecks[index]?.sqlite ?? 0;
    result.push({
      relation: `${edge.childTable}.${edge.childColumn} → ${edge.parentTable}.${edge.parentColumn}`,
      postgres,
      sqlite,
      equal: postgres === 0 && sqlite === 0,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 4. 业务聚合对账（两侧都用领域仓储，口径必然一致）
// ---------------------------------------------------------------------------

async function collectAggregates(repos: Repositories): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const set = (key: string, value: unknown) => result.set(key, String(value));

  set("customers.active", await repos.customer.countActive());
  set("vehicles.total", (await repos.vehicle.list({}, { skip: 0, take: 1 })).total);
  set("workOrders.total", (await repos.workOrder.list({}, { skip: 0, take: 1 })).total);
  set(
    "workOrders.completed",
    (await repos.workOrder.list({ status: "COMPLETED" }, { skip: 0, take: 1 })).total,
  );
  set(
    "workOrders.cancelled",
    (await repos.workOrder.list({ status: "CANCELLED" }, { skip: 0, take: 1 })).total,
  );

  const openBalances = await repos.workOrder.listOpenOrderBalances();
  let receivable = D(0);
  let received = D(0);
  for (const row of openBalances) {
    receivable = receivable.plus(D(String(row.totalAmount)));
    received = received.plus(D(String(row.paidAmount)));
  }
  set("finance.receivable", receivable.toFixed(2));
  set("finance.received", received.toFixed(2));
  set("finance.outstanding", receivable.minus(received).toFixed(2));

  const payments = await repos.finance.listPayments(
    { from: EPOCH, to: FAR_FUTURE },
    { skip: 0, take: 1 },
  );
  set("payments.count", payments.total);
  set("payments.sum", (await repos.finance.sumPaymentsInRange(EPOCH, FAR_FUTURE)).toFixed(2));

  const expenses = await repos.finance.listExpenses(
    { from: EPOCH, to: FAR_FUTURE },
    { skip: 0, take: 1 },
  );
  set("expenses.count", expenses.total);
  set("expenses.sum", (await repos.finance.sumExpensesInRange(EPOCH, FAR_FUTURE)).toFixed(2));

  let quantity = D(0);
  let valuation = D(0);
  for (const line of await repos.inventory.listValuationLines()) {
    if (line.partDeletedAt !== null) continue;
    const qty = D(String(line.quantity));
    const unitCost = D(String(line.avgCost)).gt(0)
      ? D(String(line.avgCost))
      : D(String(line.partCostPrice));
    quantity = quantity.plus(qty);
    valuation = valuation.plus(qty.mul(unitCost));
  }
  set("inventory.quantity", quantity.toFixed(2));
  set("inventory.valuation", valuation.toFixed(2));
  set(
    "inventory.transactions",
    (await repos.inventory.listTransactions({}, { skip: 0, take: 1 })).total,
  );
  set("audit.logs", (await repos.audit.list({}, { skip: 0, take: 1 })).total);
  set("users.total", (await repos.user.list()).length);
  return result;
}

const AGGREGATE_LABELS: Record<string, string> = {
  "customers.active": "客户数（在册）",
  "vehicles.total": "车辆总数",
  "workOrders.total": "工单总数",
  "workOrders.completed": "已完成工单",
  "workOrders.cancelled": "已取消工单",
  "finance.receivable": "总应收",
  "finance.received": "总已收",
  "finance.outstanding": "总欠款",
  "payments.count": "收款笔数",
  "payments.sum": "收款总额",
  "expenses.count": "支出笔数",
  "expenses.sum": "支出总额",
  "inventory.quantity": "库存总数量",
  "inventory.valuation": "库存总估值",
  "inventory.transactions": "库存流水数",
  "audit.logs": "审计日志数",
  "users.total": "账号数",
};

// ---------------------------------------------------------------------------
// 5. 全表逐行逐列对账
// ---------------------------------------------------------------------------

async function compareAllRows(
  prisma: PrismaClient,
  sqliteDb: DatabaseSync,
  plan: MigrationPlan,
): Promise<{ diffs: TableRowDiff[]; compared: number; jsonCompared: number }> {
  const diffs: TableRowDiff[] = [];
  let compared = 0;
  let jsonCompared = 0;
  const client = prisma as unknown as Record<
    string,
    { findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>> }
  >;

  for (const table of plan.tables) {
    const primaryKeyField = table.primaryKeyFields[0]!;
    const postgresRows = await client[table.accessor]!.findMany();
    const sqliteRows = sqliteDb.prepare(`SELECT * FROM ${table.table}`).all() as Array<
      Record<string, unknown>
    >;

    const keyOf = (value: unknown) => (value === null || value === undefined ? "" : String(value));
    const postgresByKey = new Map(postgresRows.map((row) => [keyOf(row[primaryKeyField]), row]));
    const sqliteByKey = new Map(sqliteRows.map((row) => [keyOf(row[primaryKeyField]), row]));

    const missingInSqlite = [...postgresByKey.keys()].filter((key) => !sqliteByKey.has(key));
    const missingInPostgres = [...sqliteByKey.keys()].filter((key) => !postgresByKey.has(key));
    const mismatches: RowMismatch[] = [];

    for (const [key, postgresRow] of postgresByKey) {
      const sqliteRow = sqliteByKey.get(key);
      if (!sqliteRow) continue;
      const fields: string[] = [];
      for (const column of table.columns) {
        const left = normalizeCell(column.kind, postgresRow[column.field]);
        const right = normalizeCell(column.kind, sqliteRow[column.column]);
        if (column.kind === "json" && left !== null && right !== null) jsonCompared += 1;
        if (left !== right) fields.push(column.field);
      }
      if (fields.length > 0) mismatches.push({ id: key, fields });
    }

    compared += postgresRows.length;
    diffs.push({
      table: table.table,
      compared: postgresRows.length,
      mismatches,
      missingInSqlite,
      missingInPostgres,
    });
  }
  return { diffs, compared, jsonCompared };
}

// ---------------------------------------------------------------------------
// 6 / 7. 工单与配件专项（含派生字段）
// ---------------------------------------------------------------------------

async function compareWorkOrders(prisma: PrismaClient, sqliteDb: DatabaseSync): Promise<FieldDiff> {
  const postgresRows = await prisma.workOrder.findMany({
    select: {
      id: true,
      totalAmount: true,
      paidAmount: true,
      status: true,
      customerId: true,
      vehicleId: true,
    },
  });
  const sqliteRows = sqliteDb
    .prepare(
      "SELECT id, total_amount, paid_amount, status, customer_id, vehicle_id FROM work_orders",
    )
    .all() as Array<Record<string, unknown>>;

  const shape = (
    id: string,
    total: unknown,
    paid: unknown,
    status: unknown,
    customer: unknown,
    vehicle: unknown,
  ) => {
    const totalText = money(total);
    const paidText = money(paid);
    return {
      id,
      totalAmount: totalText,
      paidAmount: paidText,
      outstandingAmount: D(totalText).minus(paidText).toFixed(2),
      status: String(status),
      customerId: String(customer ?? ""),
      vehicleId: String(vehicle ?? ""),
    };
  };

  const postgresByKey = new Map(
    postgresRows.map((row) => [
      row.id,
      shape(row.id, row.totalAmount, row.paidAmount, row.status, row.customerId, row.vehicleId),
    ]),
  );
  const sqliteByKey = new Map(
    sqliteRows.map((row) => [
      String(row.id),
      shape(
        String(row.id),
        row.total_amount,
        row.paid_amount,
        row.status,
        row.customer_id,
        row.vehicle_id,
      ),
    ]),
  );

  const mismatches: RowMismatch[] = [];
  for (const [id, left] of postgresByKey) {
    const right = sqliteByKey.get(id);
    if (!right) continue;
    const fields = (Object.keys(left) as Array<keyof typeof left>).filter(
      (field) => field !== "id" && left[field] !== right[field],
    );
    if (fields.length > 0) mismatches.push({ id, fields: fields as string[] });
  }

  return {
    model: "WorkOrder",
    compared: postgresByKey.size,
    mismatches,
    missingInSqlite: [...postgresByKey.keys()].filter((id) => !sqliteByKey.has(id)),
    missingInPostgres: [...sqliteByKey.keys()].filter((id) => !postgresByKey.has(id)),
  };
}

async function compareParts(prisma: PrismaClient, sqliteDb: DatabaseSync): Promise<FieldDiff> {
  const postgresRows = await prisma.part.findMany({
    select: {
      id: true,
      costPrice: true,
      salePrice: true,
      inventory: { select: { quantity: true, safeQuantity: true, avgCost: true } },
    },
  });
  const sqliteRows = sqliteDb
    .prepare(
      `SELECT p.id, p.cost_price, p.sale_price, i.quantity, i.safe_quantity, i.avg_cost
       FROM parts p LEFT JOIN inventories i ON i.part_id = p.id`,
    )
    .all() as Array<Record<string, unknown>>;

  const shape = (
    id: string,
    cost: unknown,
    sale: unknown,
    quantity: unknown,
    safe: unknown,
    avg: unknown,
  ) => {
    const costText = money(cost);
    const quantityText = quantity === null || quantity === undefined ? "0.00" : money(quantity);
    const unitCost =
      avg === null || avg === undefined || D(String(avg)).eq(0) ? costText : money(avg);
    return {
      id,
      costPrice: costText,
      salePrice: money(sale),
      currentQuantity: quantityText,
      safetyStock: safe === null || safe === undefined ? "0.00" : money(safe),
      valuation: D(quantityText).mul(unitCost).toFixed(2),
    };
  };

  const postgresByKey = new Map(
    postgresRows.map((row) => [
      row.id,
      shape(
        row.id,
        row.costPrice,
        row.salePrice,
        row.inventory?.quantity ?? null,
        row.inventory?.safeQuantity ?? null,
        row.inventory?.avgCost ?? null,
      ),
    ]),
  );
  const sqliteByKey = new Map(
    sqliteRows.map((row) => [
      String(row.id),
      shape(
        String(row.id),
        row.cost_price,
        row.sale_price,
        row.quantity,
        row.safe_quantity,
        row.avg_cost,
      ),
    ]),
  );

  const mismatches: RowMismatch[] = [];
  for (const [id, left] of postgresByKey) {
    const right = sqliteByKey.get(id);
    if (!right) continue;
    const fields = (Object.keys(left) as Array<keyof typeof left>).filter(
      (field) => field !== "id" && left[field] !== right[field],
    );
    if (fields.length > 0) mismatches.push({ id, fields: fields as string[] });
  }

  return {
    model: "Part+Inventory",
    compared: postgresByKey.size,
    mismatches,
    missingInSqlite: [...postgresByKey.keys()].filter((id) => !sqliteByKey.has(id)),
    missingInPostgres: [...sqliteByKey.keys()].filter((id) => !postgresByKey.has(id)),
  };
}

// ---------------------------------------------------------------------------
// §12 边界样本
// ---------------------------------------------------------------------------

function decimalBoundarySamples(): SampleComparison[] {
  return DECIMAL_BOUNDARY_VALUES.map((value) => {
    const converted = String(toSqliteValue("decimal", value));
    const expected = D(value).toFixed(2);
    return {
      label: `Decimal ${value} → ${expected}`,
      postgres: value,
      sqlite: converted,
      equal: converted === expected,
    };
  });
}

/**
 * 日期最早 / 最晚样本。
 *
 * 刻意**不**用 SQL 的 min()/max() 取 PostgreSQL 值：Prisma 把 DateTime 映射为
 * `timestamp without time zone`，`min(...)::text` 丢掉 UTC 约定后会被 JS 当成
 * 本地时间解析，凭空差出一个时区偏移。这里改为用 Prisma 读回 Date（与逐行对账
 * 完全相同的解释方式），SQLite 侧读 ISO 文本（带 Z，解析无歧义）。
 */
async function dateRangeSamples(
  prisma: PrismaClient,
  sqliteDb: DatabaseSync,
  plan: MigrationPlan,
): Promise<SampleComparison[]> {
  const targets: Array<{ table: string; field: string; column: string; label: string }> = [
    {
      table: "work_orders",
      field: "createdAt",
      column: "created_at",
      label: "work_orders.created_at",
    },
    {
      table: "work_orders",
      field: "completedAt",
      column: "completed_at",
      label: "work_orders.completed_at",
    },
    {
      table: "payments",
      field: "occurredAt",
      column: "occurred_at",
      label: "payments.occurred_at",
    },
    {
      table: "audit_logs",
      field: "createdAt",
      column: "created_at",
      label: "audit_logs.created_at",
    },
    { table: "sessions", field: "expiresAt", column: "expires_at", label: "sessions.expires_at" },
  ];
  const client = prisma as unknown as Record<
    string,
    { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> }
  >;
  const samples: SampleComparison[] = [];

  for (const target of targets) {
    const planned = plan.tables.find((table) => table.table === target.table);
    if (!planned) continue;

    const rows = await client[planned.accessor]!.findMany({ select: { [target.field]: true } });
    const postgresValues = rows
      .map((row) => row[target.field])
      .filter((value): value is Date => value instanceof Date)
      .map((value) => value.toISOString())
      .sort();

    const sqliteValues = (
      sqliteDb
        .prepare(
          `SELECT ${target.column} AS value FROM ${target.table} WHERE ${target.column} IS NOT NULL`,
        )
        .all() as Array<{ value: string }>
    )
      .map((row) => new Date(row.value).toISOString())
      .sort();

    const range = (values: string[]) =>
      values.length === 0 ? "（无）" : `${values[0]} … ${values[values.length - 1]}`;
    const postgres = range(postgresValues);
    const sqlite = range(sqliteValues);
    samples.push({
      label: `日期范围 ${target.label}`,
      postgres,
      sqlite,
      equal: postgres === sqlite,
    });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export async function verifyMigration(
  prisma: PrismaClient,
  sqliteDb: DatabaseSync,
  plan: MigrationPlan,
): Promise<MigrationVerification> {
  const errors: string[] = [];
  let pgColumns = new Map<string, string[]>();
  try {
    pgColumns = await resolvePostgresColumns(
      prisma,
      plan.tables.map((table) => table.table),
    );
  } catch (error) {
    errors.push(`读取 PostgreSQL 列信息失败：${messageOf(error)}`);
  }

  const counts = await compareCounts(prisma, sqliteDb, plan);
  const countMismatches = counts.filter((row) => !row.equal).length;

  const fkRows = sqliteDb.prepare("PRAGMA foreign_key_check").all();

  const orphans = await compareOrphans(prisma, sqliteDb, plan, pgColumns);
  const orphanViolations = orphans.filter((row) => !row.equal).length;

  const postgresAggregates = await collectAggregates(createRepositories(prisma));
  const sqliteAggregates = await collectAggregates(createSqliteRepositories(sqliteDb));
  const aggregates: AggregateComparison[] = [...postgresAggregates.keys()].map((key) => {
    const postgres = postgresAggregates.get(key) ?? "";
    const sqlite = sqliteAggregates.get(key) ?? "";
    return {
      key,
      label: AGGREGATE_LABELS[key] ?? key,
      postgres,
      sqlite,
      equal: postgres === sqlite,
    };
  });
  const aggregateMismatches = aggregates.filter((row) => !row.equal).length;

  const rowDiff = await compareAllRows(prisma, sqliteDb, plan);
  const rowMismatchCount =
    rowDiff.diffs.reduce((total, diff) => total + diff.mismatches.length, 0) +
    rowDiff.diffs.reduce(
      (total, diff) => total + diff.missingInSqlite.length + diff.missingInPostgres.length,
      0,
    );

  const workOrders = await compareWorkOrders(prisma, sqliteDb);
  const parts = await compareParts(prisma, sqliteDb);

  const samples = [
    ...decimalBoundarySamples(),
    ...(await dateRangeSamples(prisma, sqliteDb, plan)),
  ];
  const sampleMismatches = samples.filter((sample) => !sample.equal).length;

  const ok =
    errors.length === 0 &&
    countMismatches === 0 &&
    fkRows.length === 0 &&
    orphanViolations === 0 &&
    aggregateMismatches === 0 &&
    rowMismatchCount === 0 &&
    workOrders.mismatches.length === 0 &&
    workOrders.missingInSqlite.length === 0 &&
    workOrders.missingInPostgres.length === 0 &&
    parts.mismatches.length === 0 &&
    parts.missingInSqlite.length === 0 &&
    parts.missingInPostgres.length === 0 &&
    sampleMismatches === 0;

  return {
    counts,
    countMismatches,
    foreignKeyCheck: { violations: fkRows.length, rows: fkRows },
    orphans,
    orphanViolations,
    aggregates,
    aggregateMismatches,
    rows: rowDiff.diffs,
    rowsCompared: rowDiff.compared,
    rowMismatchCount,
    workOrders,
    parts,
    samples,
    sampleMismatches,
    jsonCompared: rowDiff.jsonCompared,
    errors,
    ok,
  };
}
