import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { InventoryRepository } from "@/domain/repositories";
import type { InventoryTxRow, StockValuationLine } from "@/domain/rows";
import { fromDbDecimal, fromDbDecimalOrZero, toDbDecimal } from "./decimal";
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

function mapTransaction(row: SqlRow): InventoryTxRow {
  return {
    id: String(row.id),
    type: row.type as InventoryTxRow["type"],
    partId: String(row.part_id),
    quantity: fromDbDecimalOrZero(text(row.quantity)),
    qtyBefore: fromDbDecimalOrZero(text(row.qty_before)),
    qtyAfter: fromDbDecimalOrZero(text(row.qty_after)),
    unitCost: fromDbDecimal(text(row.unit_cost)),
    amount: fromDbDecimal(text(row.amount)),
    workOrderId: text(row.work_order_id),
    remark: text(row.remark),
    createdAt: new Date(String(row.created_at)),
    part: { name: String(row.part_name) },
    operator: row.operator_name == null ? null : { name: String(row.operator_name) },
    workOrder: row.order_no == null ? null : { orderNo: String(row.order_no) },
  };
}

export function createSqliteInventoryRepository(db: DatabaseSync): InventoryRepository {
  return {
    async lockOrCreate(partId) {
      const existing = one(
        db,
        "SELECT id, quantity, avg_cost, safe_quantity FROM inventories WHERE part_id = ?",
        partId,
      );
      if (existing) {
        return {
          id: String(existing.id),
          quantity: fromDbDecimalOrZero(text(existing.quantity)),
          avgCost: fromDbDecimalOrZero(text(existing.avg_cost)),
          safeQuantity: fromDbDecimalOrZero(text(existing.safe_quantity)),
        };
      }

      const id = newId();
      execute(
        db,
        `INSERT INTO inventories (id, part_id, quantity, safe_quantity, avg_cost, updated_at)
         VALUES (?, ?, '0.00', '0.00', '0.00', ?)`,
        id,
        partId,
        new Date().toISOString(),
      );
      return {
        id,
        quantity: fromDbDecimalOrZero("0"),
        avgCost: fromDbDecimalOrZero("0"),
        safeQuantity: fromDbDecimalOrZero("0"),
      };
    },

    async applyChange(partId, patch) {
      const changed = execute(
        db,
        "UPDATE inventories SET quantity = ?, avg_cost = ?, updated_at = ? WHERE part_id = ?",
        toDbDecimal(patch.quantity),
        toDbDecimal(patch.avgCost),
        new Date().toISOString(),
        partId,
      );
      if (changed === 0) throw new NotFoundError();
    },

    async appendTransaction(data) {
      const id = newId();
      execute(
        db,
        `INSERT INTO inventory_transactions
          (id, part_id, type, quantity, qty_before, qty_after, unit_cost, amount,
           work_order_id, operator_id, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.partId,
        data.type,
        toDbDecimal(data.quantity),
        toDbDecimal(data.qtyBefore),
        toDbDecimal(data.qtyAfter),
        toDbDecimal(data.unitCost),
        toDbDecimal(data.amount),
        data.workOrderId ?? null,
        data.operatorId ?? null,
        data.remark ?? null,
        new Date().toISOString(),
      );
      return { id };
    },

    async listTransactions(filter, paging) {
      const where: string[] = [];
      const params: SQLInputValue[] = [];
      if (filter.partId) {
        where.push("t.part_id = ?");
        params.push(filter.partId);
      }
      if (filter.type) {
        where.push("t.type = ?");
        params.push(filter.type);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const projection = `
        SELECT t.id, t.type, t.part_id, t.quantity, t.qty_before, t.qty_after,
               t.unit_cost, t.amount, t.work_order_id, t.remark, t.created_at,
               p.name AS part_name, u.name AS operator_name, w.order_no
        FROM inventory_transactions t
        JOIN parts p ON p.id = t.part_id
        LEFT JOIN users u ON u.id = t.operator_id
        LEFT JOIN work_orders w ON w.id = t.work_order_id
        ${whereSql}`;
      const resultRows = rows(
        db,
        `${projection} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
        ...params,
        paging.take,
        paging.skip,
      ).map(mapTransaction);
      const total = Number(
        one(db, `SELECT COUNT(*) AS count FROM inventory_transactions t ${whereSql}`, ...params)
          ?.count ?? 0,
      );
      return { rows: resultRows, total };
    },

    async listValuationLines() {
      return rows(
        db,
        `SELECT i.quantity, i.avg_cost, p.cost_price, p.deleted_at
         FROM inventories i JOIN parts p ON p.id = i.part_id`,
      ).map((row): StockValuationLine => ({
        quantity: fromDbDecimalOrZero(text(row.quantity)),
        avgCost: fromDbDecimalOrZero(text(row.avg_cost)),
        partCostPrice: fromDbDecimalOrZero(text(row.cost_price)),
        partDeletedAt: row.deleted_at == null ? null : new Date(String(row.deleted_at)),
      }));
    },

    async detachWorkOrder(workOrderId) {
      execute(
        db,
        "UPDATE inventory_transactions SET work_order_id = NULL WHERE work_order_id = ?",
        workOrderId,
      );
    },
  };
}
