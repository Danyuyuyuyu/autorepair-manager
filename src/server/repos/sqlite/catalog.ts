import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { CatalogRepository } from "@/domain/repositories";
import type { CategoryOptionRow, ServiceItemPickerRow, SupplierOptionRow } from "@/domain/rows";
import { fromDbDecimal, fromDbDecimalOrZero, toDbDecimal, toDbDecimalOrZero } from "./decimal";
import { newId } from "./id";

type SqlRow = Record<string, unknown>;

const text = (value: unknown): string | null => (value == null ? null : String(value));

function rows<T extends SqlRow>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

function one<T extends SqlRow>(
  db: DatabaseSync,
  sql: string,
  ...params: SQLInputValue[]
): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

function mapServiceItem(row: SqlRow): ServiceItemPickerRow {
  return {
    id: String(row.id),
    code: text(row.code),
    name: String(row.name),
    kind: row.kind === "LABOR" ? "LABOR" : "SERVICE",
    unit: String(row.unit),
    defaultPrice: fromDbDecimalOrZero(text(row.default_price)),
    costPrice: fromDbDecimalOrZero(text(row.cost_price)),
    categoryName: text(row.category_name),
  };
}

function mapCategory(row: SqlRow): CategoryOptionRow {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind),
    sortOrder: Number(row.sort_order),
  };
}

function mapSupplier(row: SqlRow): SupplierOptionRow {
  return {
    id: String(row.id),
    name: String(row.name),
    contact: text(row.contact),
    phone: text(row.phone),
  };
}

export function createSqliteCatalogRepository(db: DatabaseSync): CatalogRepository {
  return {
    async findServiceItemCost(id) {
      const row = one(
        db,
        "SELECT cost_price FROM service_items WHERE id = ? AND deleted_at IS NULL",
        id,
      );
      return row ? fromDbDecimal(text(row.cost_price)) : null;
    },

    async listServiceItems({ keyword, kind, limit }) {
      const where = ["s.deleted_at IS NULL", "s.is_active = 1"];
      const params: SQLInputValue[] = [];
      if (kind) {
        where.push("s.kind = ?");
        params.push(kind);
      }
      if (keyword) {
        where.push(
          `(LOWER(s.name) LIKE LOWER('%' || ? || '%')
            OR LOWER(s.code) LIKE LOWER('%' || ? || '%'))`,
        );
        params.push(keyword, keyword);
      }
      return rows(
        db,
        `SELECT s.id, s.code, s.name, s.kind, s.unit, s.default_price, s.cost_price,
                c.name AS category_name
         FROM service_items s
         LEFT JOIN categories c ON c.id = s.category_id
         WHERE ${where.join(" AND ")}
         ORDER BY s.sort_order ASC, s.name ASC
         LIMIT ?`,
        ...params,
        limit,
      ).map(mapServiceItem);
    },

    async createServiceItem(data) {
      const id = newId();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO service_items
         (id, code, name, kind, category_id, unit, default_price, default_hours,
          cost_price, is_active, sort_order, remark, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
      ).run(
        id,
        data.code,
        data.name,
        data.kind,
        data.categoryId,
        data.unit,
        toDbDecimalOrZero(data.defaultPrice),
        toDbDecimal(data.defaultHours),
        toDbDecimalOrZero(data.costPrice),
        data.sortOrder,
        data.remark,
        now,
        now,
      );
      return { id, name: data.name };
    },

    async listCategories(kind) {
      const params: SQLInputValue[] = [];
      const where = ["is_active = 1"];
      if (kind) {
        where.push("kind = ?");
        params.push(kind);
      }
      return rows(
        db,
        `SELECT id, name, kind, sort_order
         FROM categories
         WHERE ${where.join(" AND ")}
         ORDER BY kind ASC, sort_order ASC, name ASC`,
        ...params,
      ).map(mapCategory);
    },

    async findCategoryByName(kind, name) {
      const row = one(
        db,
        "SELECT id FROM categories WHERE kind = ? AND name = ? LIMIT 1",
        kind,
        name,
      );
      return row ? { id: String(row.id) } : null;
    },

    async createCategory(data) {
      const id = newId();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO categories (id, name, kind, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      ).run(id, data.name, data.kind, data.sortOrder, now, now);
      return { id, name: data.name, kind: data.kind, sortOrder: data.sortOrder };
    },

    async listSuppliers() {
      return rows(
        db,
        `SELECT id, name, contact, phone
         FROM suppliers
         WHERE deleted_at IS NULL AND is_active = 1
         ORDER BY name ASC`,
      ).map(mapSupplier);
    },

    async createSupplier(data) {
      const id = newId();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO suppliers
         (id, name, contact, phone, address, remark, is_active, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
      ).run(id, data.name, data.contact, data.phone, data.address, data.remark, now, now);
      return { id, name: data.name };
    },
  };
}
