import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { PartRepository } from "@/domain/repositories";
import type {
  PartDetailRow,
  PartListRow,
  PartPickerRow,
  PartStockLevelRow,
  SearchPartRow,
} from "@/domain/rows";
import { toDbDecimal, fromDbDecimal, fromDbDecimalOrZero } from "./decimal";
import { NotFoundError } from "@/server/errors";

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

function execute(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}

const listProjection = `
  SELECT p.id, p.code, p.name, p.spec, p.brand, p.unit, p.category_id,
         p.cost_price, p.sale_price, p.is_active,
         c.name AS category_name,
         i.id AS inventory_id, i.quantity AS inventory_quantity,
         i.safe_quantity AS inventory_safe_quantity, i.avg_cost AS inventory_avg_cost
  FROM parts p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN inventories i ON i.part_id = p.id
`;

const detailProjection = `
  SELECT p.id, p.code, p.name, p.spec, p.brand, p.unit, p.category_id,
         p.cost_price, p.sale_price, p.is_active, p.remark, p.supplier_id,
         c.name AS category_name, s.name AS supplier_name,
         i.id AS inventory_id, i.quantity AS inventory_quantity,
         i.safe_quantity AS inventory_safe_quantity, i.avg_cost AS inventory_avg_cost,
         i.location AS inventory_location
  FROM parts p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN inventories i ON i.part_id = p.id
`;

function mapListRow(row: SqlRow): PartListRow {
  return {
    id: String(row.id),
    code: text(row.code),
    name: String(row.name),
    spec: text(row.spec),
    brand: text(row.brand),
    unit: String(row.unit),
    categoryId: text(row.category_id),
    costPrice: fromDbDecimalOrZero(text(row.cost_price)),
    salePrice: fromDbDecimalOrZero(text(row.sale_price)),
    isActive: Number(row.is_active) === 1,
    category: row.category_name == null ? null : { name: String(row.category_name) },
    inventory:
      row.inventory_id == null
        ? null
        : {
            quantity: fromDbDecimalOrZero(text(row.inventory_quantity)),
            safeQuantity: fromDbDecimalOrZero(text(row.inventory_safe_quantity)),
            avgCost: fromDbDecimalOrZero(text(row.inventory_avg_cost)),
          },
  };
}

function mapDetailRow(row: SqlRow): PartDetailRow {
  return {
    ...mapListRow(row),
    supplierId: text(row.supplier_id),
    remark: text(row.remark),
    supplier: row.supplier_name == null ? null : { name: String(row.supplier_name) },
    inventory:
      row.inventory_id == null
        ? null
        : {
            quantity: fromDbDecimalOrZero(text(row.inventory_quantity)),
            safeQuantity: fromDbDecimalOrZero(text(row.inventory_safe_quantity)),
            avgCost: fromDbDecimalOrZero(text(row.inventory_avg_cost)),
            location: text(row.inventory_location),
          },
  };
}

function keywordClause(keyword: string): { sql: string; params: SQLInputValue[] } {
  return {
    sql: `(
      LOWER(p.name) LIKE LOWER('%' || ? || '%')
      OR LOWER(p.spec) LIKE LOWER('%' || ? || '%')
      OR LOWER(p.brand) LIKE LOWER('%' || ? || '%')
      OR LOWER(p.code) LIKE LOWER('%' || ? || '%')
    )`,
    params: [keyword, keyword, keyword, keyword],
  };
}

export function createSqlitePartRepository(db: DatabaseSync): PartRepository {
  return {
    async findSnapshot(partId) {
      const row = one(
        db,
        `SELECT p.name, p.spec, p.unit, p.cost_price, i.avg_cost
         FROM parts p LEFT JOIN inventories i ON i.part_id = p.id
         WHERE p.id = ? AND p.deleted_at IS NULL`,
        partId,
      );
      if (!row) return null;
      return {
        name: String(row.name),
        spec: text(row.spec),
        unit: String(row.unit),
        costPrice: fromDbDecimalOrZero(text(row.cost_price)),
        avgCost: fromDbDecimal(text(row.avg_cost)),
      };
    },

    async findUnitCost(partId) {
      const row = one(
        db,
        `SELECT p.cost_price, i.avg_cost
         FROM parts p LEFT JOIN inventories i ON i.part_id = p.id
         WHERE p.id = ? AND p.deleted_at IS NULL`,
        partId,
      );
      return row
        ? {
            costPrice: fromDbDecimalOrZero(text(row.cost_price)),
            avgCost: fromDbDecimal(text(row.avg_cost)),
          }
        : null;
    },

    async findBrief(id) {
      const row = one(db, "SELECT id, name FROM parts WHERE id = ? AND deleted_at IS NULL", id);
      return row ? { id: String(row.id), name: String(row.name) } : null;
    },

    async findStockLevel(id) {
      const row = one(
        db,
        `SELECT p.id, p.name, i.quantity
         FROM parts p LEFT JOIN inventories i ON i.part_id = p.id
         WHERE p.id = ? AND p.deleted_at IS NULL`,
        id,
      );
      return row
        ? {
            id: String(row.id),
            name: String(row.name),
            quantity: fromDbDecimal(text(row.quantity)),
          }
        : null;
    },

    async listStockLevels(ids) {
      if (ids.length === 0) return [];
      const marks = ids.map(() => "?").join(",");
      return rows(
        db,
        `SELECT p.id, p.name, i.quantity
         FROM parts p LEFT JOIN inventories i ON i.part_id = p.id
         WHERE p.id IN (${marks}) AND p.deleted_at IS NULL`,
        ...ids,
      ).map((row): PartStockLevelRow => ({
        id: String(row.id),
        name: String(row.name),
        quantity: fromDbDecimal(text(row.quantity)),
      }));
    },

    async list(filter, paging) {
      const where = ["p.deleted_at IS NULL"];
      const params: SQLInputValue[] = [];
      if (!filter.includeInactive) where.push("p.is_active = 1");
      if (filter.categoryId) {
        where.push("p.category_id = ?");
        params.push(filter.categoryId);
      }
      if (filter.keyword) {
        const keyword = keywordClause(filter.keyword);
        where.push(keyword.sql);
        params.push(...keyword.params);
      }
      if (filter.zeroStockOnly) {
        where.push("i.id IS NOT NULL AND CAST(i.quantity AS NUMERIC) <= 0");
      } else if (filter.hasInventoryRowOnly) {
        where.push("i.id IS NOT NULL");
      }
      const whereSql = where.join(" AND ");
      const resultRows = rows(
        db,
        `${listProjection}
         WHERE ${whereSql}
         ORDER BY p.is_active DESC, p.updated_at DESC
         LIMIT ? OFFSET ?`,
        ...params,
        paging.take,
        paging.skip,
      ).map(mapListRow);
      const total = Number(
        one(
          db,
          `SELECT COUNT(*) AS count FROM parts p LEFT JOIN inventories i ON i.part_id = p.id WHERE ${whereSql}`,
          ...params,
        )?.count ?? 0,
      );
      return { rows: resultRows, total };
    },

    async listLowStockCandidates() {
      return rows(
        db,
        `${listProjection}
         WHERE p.deleted_at IS NULL AND p.is_active = 1 AND i.id IS NOT NULL
         ORDER BY p.name ASC`,
      ).map(mapListRow);
    },

    async findDetail(id) {
      const row = one(db, `${detailProjection} WHERE p.id = ? AND p.deleted_at IS NULL`, id);
      return row ? mapDetailRow(row) : null;
    },

    async findForEdit(id) {
      const row = one(
        db,
        `SELECT p.id, p.code, p.name, p.spec, p.brand, p.unit, p.category_id,
                p.supplier_id, p.remark, i.safe_quantity, i.location
         FROM parts p LEFT JOIN inventories i ON i.part_id = p.id
         WHERE p.id = ? AND p.deleted_at IS NULL`,
        id,
      );
      return row
        ? {
            id: String(row.id),
            code: text(row.code),
            name: String(row.name),
            spec: text(row.spec),
            brand: text(row.brand),
            unit: String(row.unit),
            categoryId: text(row.category_id),
            supplierId: text(row.supplier_id),
            remark: text(row.remark),
            safeQuantity: fromDbDecimal(text(row.safe_quantity)),
            location: text(row.location),
          }
        : null;
    },

    async createWithInventory(data, inventory) {
      const id = newId();
      const now = new Date().toISOString();
      execute(
        db,
        `INSERT INTO parts
          (id, code, name, spec, brand, unit, category_id, supplier_id,
           cost_price, sale_price, is_active, remark, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        id,
        data.code,
        data.name,
        data.spec,
        data.brand,
        data.unit,
        data.categoryId,
        data.supplierId,
        toDbDecimal(data.costPrice),
        toDbDecimal(data.salePrice),
        data.remark,
        now,
        now,
      );
      execute(
        db,
        `INSERT INTO inventories (id, part_id, quantity, safe_quantity, avg_cost, location, updated_at)
         VALUES (?, ?, '0.00', ?, ?, ?, ?)`,
        newId(),
        id,
        toDbDecimal(inventory.safeQuantity),
        toDbDecimal(data.costPrice),
        inventory.location,
        now,
      );
      return { id, name: data.name };
    },

    async updateWithInventory(id, data, inventory) {
      const now = new Date().toISOString();
      const changed = execute(
        db,
        `UPDATE parts SET code = ?, name = ?, spec = ?, brand = ?, unit = ?,
          category_id = ?, supplier_id = ?, cost_price = ?, sale_price = ?,
          remark = ?, updated_at = ? WHERE id = ?`,
        data.code,
        data.name,
        data.spec,
        data.brand,
        data.unit,
        data.categoryId,
        data.supplierId,
        toDbDecimal(data.costPrice),
        toDbDecimal(data.salePrice),
        data.remark,
        now,
        id,
      );
      if (changed === 0) throw new NotFoundError();
      const inventoryChanged = execute(
        db,
        "UPDATE inventories SET safe_quantity = ?, location = ?, updated_at = ? WHERE part_id = ?",
        toDbDecimal(inventory.safeQuantity),
        inventory.location,
        now,
        id,
      );
      if (inventoryChanged === 0) throw new NotFoundError();
    },

    async findForDelete(id) {
      const row = one(
        db,
        `SELECT p.id, p.name, i.quantity
         FROM parts p LEFT JOIN inventories i ON i.part_id = p.id
         WHERE p.id = ? AND p.deleted_at IS NULL`,
        id,
      );
      return row
        ? {
            id: String(row.id),
            name: String(row.name),
            quantity: fromDbDecimal(text(row.quantity)),
          }
        : null;
    },

    async softDelete(id) {
      const changed = execute(
        db,
        "UPDATE parts SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?",
        new Date().toISOString(),
        new Date().toISOString(),
        id,
      );
      if (changed === 0) throw new NotFoundError();
    },

    async updateCostAndSupplier(id, patch) {
      const set = ["cost_price = ?", "updated_at = ?"];
      const params: SQLInputValue[] = [toDbDecimal(patch.costPrice), new Date().toISOString()];
      if (patch.supplierId !== undefined) {
        set.push("supplier_id = ?");
        params.push(patch.supplierId);
      }
      params.push(id);
      if (execute(db, `UPDATE parts SET ${set.join(", ")} WHERE id = ?`, ...params) === 0) {
        throw new NotFoundError();
      }
    },

    async searchForPicker(keyword, limit) {
      const where = ["p.deleted_at IS NULL", "p.is_active = 1"];
      const params: SQLInputValue[] = [];
      if (keyword) {
        const clause = keywordClause(keyword);
        where.push(clause.sql);
        params.push(...clause.params);
      }
      return rows(
        db,
        `SELECT p.id, p.name, p.spec, p.unit, p.sale_price,
                i.quantity, i.avg_cost
         FROM parts p LEFT JOIN inventories i ON i.part_id = p.id
         WHERE ${where.join(" AND ")}
         ORDER BY LOWER(p.name) ASC LIMIT ?`,
        ...params,
        limit,
      ).map((row): PartPickerRow => ({
        id: String(row.id),
        name: String(row.name),
        spec: text(row.spec),
        unit: String(row.unit),
        salePrice: fromDbDecimalOrZero(text(row.sale_price)),
        avgCost: fromDbDecimal(text(row.avg_cost)),
        stockQuantity: fromDbDecimal(text(row.quantity)),
      }));
    },

    async countActive() {
      return Number(
        one(db, "SELECT COUNT(*) AS count FROM parts WHERE deleted_at IS NULL AND is_active = 1")
          ?.count ?? 0,
      );
    },

    async searchForGlobal(keyword, limit) {
      return rows(
        db,
        `SELECT p.id, p.name, p.spec, i.quantity, i.safe_quantity
         FROM parts p LEFT JOIN inventories i ON i.part_id = p.id
         WHERE p.deleted_at IS NULL
           AND (
             LOWER(p.name) LIKE LOWER('%' || ? || '%')
             OR LOWER(p.spec) LIKE LOWER('%' || ? || '%')
             OR LOWER(p.code) LIKE LOWER('%' || ? || '%')
             OR LOWER(p.brand) LIKE LOWER('%' || ? || '%')
           )
         ORDER BY LOWER(p.name) ASC LIMIT ?`,
        keyword,
        keyword,
        keyword,
        keyword,
        limit,
      ).map((row): SearchPartRow => ({
        id: String(row.id),
        name: String(row.name),
        spec: text(row.spec),
        quantity: fromDbDecimal(text(row.quantity)),
        safeQuantity: fromDbDecimal(text(row.safe_quantity)),
      }));
    },
  };
}
