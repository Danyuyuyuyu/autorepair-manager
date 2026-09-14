/**
 * 迁移计划：从 Prisma DMMF 推导「表 / 列 / 值类型 / 外键顺序」
 * ---------------------------------------------------------------------------
 * 不做任何硬编码的表清单或字段清单 —— 顺序来自真实 schema：
 *   - 表名 / 外键边：Prisma DMMF（`@@map` 与 relation 声明）
 *   - 列名与列集合：SQLite 迁移文件建出来的真实表（`PRAGMA table_info`）
 *
 * 两层校验保证「不会静默错列」：
 *   1. SQLite 侧的表集合必须与 `SQLITE_BUSINESS_TABLES` 完全一致
 *   2. 每个 Prisma 标量字段按 camelCase → snake_case 推出的列必须真实存在，
 *      且 SQLite 每一列都必须有对应字段（双向覆盖）
 * 任何一条不成立直接抛错 —— 宁可迁移失败，也不产生静默错位的账。
 */
import { Prisma } from "@prisma/client";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { toDbDecimal } from "@/server/repos/sqlite/decimal";
import { SQLITE_BUSINESS_TABLES, SQLITE_VERSION_TABLE } from "@/server/repos/sqlite/schema-tables";

export type ColumnKind = "decimal" | "date" | "bool" | "json" | "scalar";

export interface PlannedColumn {
  field: string;
  column: string;
  kind: ColumnKind;
}

export interface PlannedTable {
  model: string;
  /** Prisma Client 上的访问器名（user / workOrder / appSetting ...） */
  accessor: string;
  table: string;
  columns: PlannedColumn[];
  primaryKeyFields: string[];
  /** 必须先写入的父表（拓扑排序依据） */
  parents: string[];
}

export interface PlannedForeignKey {
  childTable: string;
  childField: string;
  childColumn: string;
  parentTable: string;
  parentField: string;
  parentColumn: string;
}

export interface MigrationPlan {
  /** 已按外键顺序排好（父 → 子） */
  tables: PlannedTable[];
  foreignKeys: PlannedForeignKey[];
}

export class MigrationPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationPlanError";
  }
}

interface DmmfField {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
  isList: boolean;
  /** 单列 @id 标记（复合主键走 model.primaryKey） */
  isId?: boolean;
  relationFromFields?: readonly string[];
}

interface DmmfModel {
  name: string;
  dbName?: string | null;
  fields: DmmfField[];
  primaryKey: { fields: readonly string[] } | null;
}

export function snakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** §12 要求覆盖的金额边界值（0 / 0.01 / 1.10 / 99999999.99） */
export const DECIMAL_BOUNDARY_VALUES = ["0", "0.01", "1.10", "99999999.99", "1234.5"] as const;

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 领域值 → SQLite 绑定值（与仓库层的写入语义完全一致）：
 *   decimal → 规范两位小数字符串；date → ISO 字符串；bool → 0/1；json → 文本
 */
export function toSqliteValue(kind: ColumnKind, value: unknown): SQLInputValue {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case "decimal":
      return toDbDecimal(String(value));
    case "date":
      return value instanceof Date ? value.toISOString() : String(value);
    case "bool":
      if (typeof value === "boolean") return value ? 1 : 0;
      return Number(value) === 0 ? 0 : 1;
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    default:
      if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
        return value;
      }
      return String(value);
  }
}

function columnKind(field: DmmfField): ColumnKind {
  if (field.kind === "enum" || field.kind === "unsupported") return "scalar";
  switch (field.type) {
    case "Decimal":
      return "decimal";
    case "DateTime":
      return "date";
    case "Boolean":
      return "bool";
    case "Json":
      return "json";
    default:
      return "scalar";
  }
}

function tableColumns(sqliteDb: DatabaseSync, table: string): string[] {
  return (sqliteDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name,
  );
}

function allTables(sqliteDb: DatabaseSync): string[] {
  return (
    sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

export function buildMigrationPlan(sqliteDb: DatabaseSync): MigrationPlan {
  const models = (Prisma as unknown as { dmmf: { datamodel: { models: DmmfModel[] } } }).dmmf
    .datamodel.models;

  // ---- 1. 表集合必须与 SQLite 业务表清单一致 ---------------------------------
  const present = new Set(allTables(sqliteDb).filter((table) => table !== SQLITE_VERSION_TABLE));
  const expected = new Set<string>(SQLITE_BUSINESS_TABLES);
  const missing = [...expected].filter((table) => !present.has(table));
  const unexpected = [...present].filter((table) => !expected.has(table));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new MigrationPlanError(
      `SQLite 表集合与业务表清单不一致：缺失 [${missing.join(", ")}]，多出 [${unexpected.join(", ")}]。` +
        `新增 migration 时请同步维护 src/server/repos/sqlite/schema-tables.ts。`,
    );
  }

  const tables: PlannedTable[] = [];
  const foreignKeys: PlannedForeignKey[] = [];

  // ---- 2. 逐模型建立列映射（双向覆盖校验） -----------------------------------
  for (const model of models) {
    const table = model.dbName ?? model.name;
    if (!expected.has(table)) {
      throw new MigrationPlanError(
        `Prisma 模型 ${model.name} 映射到表 ${table}，但它不在 SQLite 业务表清单里。`,
      );
    }
    const actualColumns = new Set(tableColumns(sqliteDb, table));
    if (actualColumns.size === 0) {
      throw new MigrationPlanError(`SQLite 表 ${table} 不存在或没有列`);
    }

    const scalarFields = model.fields.filter((field) => field.kind !== "object");
    const columns: PlannedColumn[] = scalarFields.map((field) => ({
      field: field.name,
      column: snakeCase(field.name),
      kind: columnKind(field),
    }));

    for (const column of columns) {
      if (!actualColumns.has(column.column)) {
        throw new MigrationPlanError(
          `表 ${table}：字段 ${column.field} 推导出的列 ${column.column} 在 SQLite 中不存在。` +
            `命名约定可能已改变，请修正映射而不是继续迁移。`,
        );
      }
    }
    const mapped = new Set(columns.map((column) => column.column));
    const uncovered = [...actualColumns].filter((column) => !mapped.has(column));
    if (uncovered.length > 0) {
      throw new MigrationPlanError(
        `表 ${table}：SQLite 列 [${uncovered.join(", ")}] 没有任何 Prisma 字段对应，会丢失数据。`,
      );
    }

    // 单列 @id 时 DMMF 的 model.primaryKey 为 null，标记在字段上
    const primaryKeyFields = model.primaryKey?.fields
      ? [...model.primaryKey.fields]
      : model.fields.filter((field) => field.isId === true).map((field) => field.name);
    if (primaryKeyFields.length !== 1) {
      throw new MigrationPlanError(
        `表 ${table}：迁移工具要求单列主键，实际为 [${primaryKeyFields.join(", ") || "无"}]。`,
      );
    }
    if (!columns.some((column) => column.field === primaryKeyFields[0])) {
      throw new MigrationPlanError(`表 ${table}：主键字段 ${primaryKeyFields[0]} 不是标量字段。`);
    }

    const planned: PlannedTable = {
      model: model.name,
      accessor: model.name.charAt(0).toLowerCase() + model.name.slice(1),
      table,
      columns,
      primaryKeyFields,
      parents: [],
    };
    tables.push(planned);

    // 外键边（用于孤儿检测与迁移顺序）
    for (const field of model.fields) {
      if (field.kind !== "object" || field.isList) continue;
      const fromFields = field.relationFromFields ?? [];
      const relationToFields = (field as unknown as { relationToFields?: readonly string[] })
        .relationToFields;
      const toFields = relationToFields ?? [];
      if (fromFields.length === 0) continue;
      const parent = models.find((candidate) => candidate.name === field.type);
      if (!parent) continue;
      for (let index = 0; index < fromFields.length; index += 1) {
        foreignKeys.push({
          childTable: table,
          childField: fromFields[index]!,
          childColumn: snakeCase(fromFields[index]!),
          parentTable: parent.dbName ?? parent.name,
          parentField: toFields[index] ?? "id",
          parentColumn: snakeCase(toFields[index] ?? "id"),
        });
      }
    }
  }

  // ---- 3. 拓扑排序：父 → 子（顺序完全来自真实外键边） -------------------------
  for (const planned of tables) {
    planned.parents = [
      ...new Set(
        foreignKeys
          .filter((edge) => edge.childTable === planned.table)
          .map((edge) => edge.parentTable),
      ),
    ];
  }

  const emitted: string[] = [];
  const emittedSet = new Set<string>();
  const remaining = [...tables].sort((a, b) => a.table.localeCompare(b.table));
  while (remaining.length > 0) {
    const ready = remaining.filter((planned) =>
      planned.parents.every((parent) => emittedSet.has(parent)),
    );
    if (ready.length === 0) {
      throw new MigrationPlanError(
        `外键关系中存在环，无法确定迁移顺序：${remaining.map((item) => item.table).join(", ")}`,
      );
    }
    for (const planned of ready) {
      emitted.push(planned.table);
      emittedSet.add(planned.table);
      remaining.splice(remaining.indexOf(planned), 1);
    }
  }

  const ordered = emitted.map((table) => {
    const planned = tables.find((candidate) => candidate.table === table);
    if (!planned) throw new MigrationPlanError(`拓扑排序结果损坏：找不到表 ${table}`);
    return planned;
  });

  return { tables: ordered, foreignKeys };
}
