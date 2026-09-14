import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { FinanceRepository } from "@/domain/repositories";
import type { ExpenseRow, PaymentRow } from "@/domain/rows";
import { D } from "@/lib/money";
import { NotFoundError } from "@/server/errors";

import { fromDbDecimalOrZero, toDbDecimal } from "./decimal";
import { newId } from "./id";

type SqlRow = Record<string, unknown>;
const text = (value: unknown): string | null => (value == null ? null : String(value));
const date = (value: unknown): Date => new Date(String(value));

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

function mapPayment(row: SqlRow): PaymentRow {
  return {
    id: String(row.id),
    amount: fromDbDecimalOrZero(text(row.amount)),
    method: String(row.method) as PaymentRow["method"],
    category: String(row.category) as PaymentRow["category"],
    source: String(row.source) as PaymentRow["source"],
    occurredAt: date(row.occurred_at),
    remark: text(row.remark),
    workOrderId: text(row.work_order_id),
    operator: row.operator_name == null ? null : { name: String(row.operator_name) },
    workOrder: row.order_no == null ? null : { orderNo: String(row.order_no) },
  };
}

function mapExpense(row: SqlRow): ExpenseRow {
  return {
    id: String(row.id),
    category: String(row.category) as ExpenseRow["category"],
    amount: fromDbDecimalOrZero(text(row.amount)),
    method: String(row.method) as ExpenseRow["method"],
    occurredAt: date(row.occurred_at),
    remark: text(row.remark),
    workOrderId: text(row.work_order_id),
    operator: row.operator_name == null ? null : { name: String(row.operator_name) },
    supplier: row.supplier_name == null ? null : { name: String(row.supplier_name) },
  };
}

function sumRows(input: SqlRow[], field = "amount") {
  return input.reduce((sum, row) => sum.plus(fromDbDecimalOrZero(text(row[field]))), D(0));
}

function groupRows(input: SqlRow[], field: string) {
  const grouped = new Map<string, { amount: ReturnType<typeof D>; count: number }>();
  for (const row of input) {
    const key = String(row[field]);
    const current = grouped.get(key);
    grouped.set(key, {
      amount: (current?.amount ?? D(0)).plus(fromDbDecimalOrZero(text(row.amount))),
      count: (current?.count ?? 0) + 1,
    });
  }
  return grouped;
}

const paymentProjection = `
  SELECT p.id, p.amount, p.method, p.category, p.source, p.occurred_at,
         p.remark, p.work_order_id, u.name AS operator_name, w.order_no
  FROM payments p
  LEFT JOIN users u ON u.id = p.operator_id
  LEFT JOIN work_orders w ON w.id = p.work_order_id
  LEFT JOIN customers c ON c.id = p.customer_id
`;

const expenseProjection = `
  SELECT e.id, e.category, e.amount, e.method, e.occurred_at,
         e.remark, e.work_order_id, u.name AS operator_name, s.name AS supplier_name
  FROM expenses e
  LEFT JOIN users u ON u.id = e.operator_id
  LEFT JOIN suppliers s ON s.id = e.supplier_id
`;

export function createSqliteFinanceRepository(db: DatabaseSync): FinanceRepository {
  return {
    async voidPaymentsByWorkOrder(workOrderId, reason) {
      return execute(
        db,
        "UPDATE payments SET deleted_at = ?, remark = ? WHERE work_order_id = ? AND deleted_at IS NULL",
        new Date().toISOString(),
        `工单取消失败收款作废：${reason}`,
        workOrderId,
      );
    },

    async createPayment(data) {
      const id = newId();
      const now = new Date().toISOString();
      execute(
        db,
        `INSERT INTO payments
          (id, work_order_id, customer_id, source, category, amount, method,
           occurred_at, operator_id, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.workOrderId ?? null,
        data.customerId ?? null,
        data.source,
        data.category,
        toDbDecimal(data.amount),
        data.method,
        data.occurredAt.toISOString(),
        data.operatorId,
        data.remark ?? null,
        now,
      );
      return { id };
    },

    async sumPaymentsByWorkOrder(workOrderId) {
      const paymentRows = rows(
        db,
        "SELECT amount FROM payments WHERE work_order_id = ? AND deleted_at IS NULL",
        workOrderId,
      );
      return sumRows(paymentRows);
    },

    async findPaymentForVoid(id) {
      const row = one(
        db,
        "SELECT id, amount, work_order_id, remark FROM payments WHERE id = ? AND deleted_at IS NULL",
        id,
      );
      return row
        ? {
            id: String(row.id),
            amount: fromDbDecimalOrZero(text(row.amount)),
            workOrderId: text(row.work_order_id),
            remark: text(row.remark),
          }
        : null;
    },

    async voidPayment(id, remark) {
      if (
        execute(
          db,
          "UPDATE payments SET deleted_at = ?, remark = ? WHERE id = ?",
          new Date().toISOString(),
          remark,
          id,
        ) === 0
      ) {
        throw new NotFoundError();
      }
    },

    async listPayments(filter, paging) {
      const where = ["p.deleted_at IS NULL", "p.occurred_at >= ?", "p.occurred_at <= ?"];
      const params: SQLInputValue[] = [filter.from.toISOString(), filter.to.toISOString()];
      if (filter.keyword) {
        where.push(`(
          LOWER(w.order_no) LIKE LOWER('%' || ? || '%')
          OR LOWER(c.name) LIKE LOWER('%' || ? || '%')
          OR LOWER(p.remark) LIKE LOWER('%' || ? || '%')
        )`);
        params.push(filter.keyword, filter.keyword, filter.keyword);
      }
      const whereSql = where.join(" AND ");
      const resultRows = rows(
        db,
        `${paymentProjection}
         WHERE ${whereSql}
         ORDER BY p.occurred_at DESC
         LIMIT ? OFFSET ?`,
        ...params,
        paging.take,
        paging.skip,
      ).map(mapPayment);
      const total = Number(
        one(
          db,
          `SELECT COUNT(*) AS count
           FROM payments p
           LEFT JOIN work_orders w ON w.id = p.work_order_id
           LEFT JOIN customers c ON c.id = p.customer_id
           WHERE ${whereSql}`,
          ...params,
        )?.count ?? 0,
      );
      return { rows: resultRows, total };
    },

    async groupPaymentsByCategory(from, to) {
      const input = rows(
        db,
        "SELECT category, amount FROM payments WHERE deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ?",
        from.toISOString(),
        to.toISOString(),
      );
      return [...groupRows(input, "category")].map(([category, value]) => ({
        category: category as PaymentRow["category"],
        amount: value.amount,
        count: value.count,
      }));
    },

    async groupPaymentsByMethod(from, to) {
      const input = rows(
        db,
        "SELECT method, amount FROM payments WHERE deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ?",
        from.toISOString(),
        to.toISOString(),
      );
      return [...groupRows(input, "method")].map(([method, value]) => ({
        method: method as PaymentRow["method"],
        amount: value.amount,
        count: value.count,
      }));
    },

    async createExpense(data) {
      const id = newId();
      const now = new Date().toISOString();
      execute(
        db,
        `INSERT INTO expenses
          (id, category, amount, method, occurred_at, supplier_id, work_order_id,
           operator_id, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.category,
        toDbDecimal(data.amount),
        data.method,
        data.occurredAt.toISOString(),
        data.supplierId ?? null,
        data.workOrderId ?? null,
        data.operatorId,
        data.remark ?? null,
        now,
      );
      return { id };
    },

    async findExpenseForEdit(id) {
      const row = one(
        db,
        `SELECT id, category, amount, method, occurred_at, remark
         FROM expenses WHERE id = ? AND deleted_at IS NULL`,
        id,
      );
      return row
        ? {
            id: String(row.id),
            category: String(row.category) as ExpenseRow["category"],
            amount: fromDbDecimalOrZero(text(row.amount)),
            method: String(row.method) as ExpenseRow["method"],
            occurredAt: date(row.occurred_at),
            remark: text(row.remark),
          }
        : null;
    },

    async updateExpense(id, patch) {
      if (
        execute(
          db,
          `UPDATE expenses
           SET category = ?, amount = ?, method = ?, occurred_at = ?,
               supplier_id = ?, work_order_id = ?, remark = ?
           WHERE id = ?`,
          patch.category,
          toDbDecimal(patch.amount),
          patch.method,
          patch.occurredAt.toISOString(),
          patch.supplierId,
          patch.workOrderId,
          patch.remark,
          id,
        ) === 0
      ) {
        throw new NotFoundError();
      }
    },

    async findExpenseForDelete(id) {
      const row = one(
        db,
        "SELECT id, category, amount, remark FROM expenses WHERE id = ? AND deleted_at IS NULL",
        id,
      );
      return row
        ? {
            id: String(row.id),
            category: String(row.category) as ExpenseRow["category"],
            amount: fromDbDecimalOrZero(text(row.amount)),
            remark: text(row.remark),
          }
        : null;
    },

    async softDeleteExpense(id) {
      if (
        execute(
          db,
          "UPDATE expenses SET deleted_at = ? WHERE id = ?",
          new Date().toISOString(),
          id,
        ) === 0
      ) {
        throw new NotFoundError();
      }
    },

    async listExpenses(filter, paging) {
      const where = ["e.deleted_at IS NULL", "e.occurred_at >= ?", "e.occurred_at <= ?"];
      const params: SQLInputValue[] = [filter.from.toISOString(), filter.to.toISOString()];
      if (filter.keyword) {
        where.push(`(
          LOWER(e.remark) LIKE LOWER('%' || ? || '%')
          OR LOWER(s.name) LIKE LOWER('%' || ? || '%')
        )`);
        params.push(filter.keyword, filter.keyword);
      }
      const whereSql = where.join(" AND ");
      const resultRows = rows(
        db,
        `${expenseProjection}
         WHERE ${whereSql}
         ORDER BY e.occurred_at DESC
         LIMIT ? OFFSET ?`,
        ...params,
        paging.take,
        paging.skip,
      ).map(mapExpense);
      const total = Number(
        one(
          db,
          `SELECT COUNT(*) AS count
           FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
           WHERE ${whereSql}`,
          ...params,
        )?.count ?? 0,
      );
      return { rows: resultRows, total };
    },

    async groupExpensesByCategory(from, to) {
      const input = rows(
        db,
        "SELECT category, amount FROM expenses WHERE deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ?",
        from.toISOString(),
        to.toISOString(),
      );
      return [...groupRows(input, "category")].map(([category, value]) => ({
        category: category as ExpenseRow["category"],
        amount: value.amount,
        count: value.count,
      }));
    },

    async sumPaymentsInRange(from, to) {
      return sumRows(
        rows(
          db,
          "SELECT amount FROM payments WHERE deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ?",
          from.toISOString(),
          to.toISOString(),
        ),
      );
    },

    async sumExpensesInRange(from, to) {
      return sumRows(
        rows(
          db,
          "SELECT amount FROM expenses WHERE deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ?",
          from.toISOString(),
          to.toISOString(),
        ),
      );
    },

    async listPaymentEntries(from, to) {
      return rows(
        db,
        "SELECT amount, occurred_at FROM payments WHERE deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ?",
        from.toISOString(),
        to.toISOString(),
      ).map((row) => ({
        amount: fromDbDecimalOrZero(text(row.amount)),
        occurredAt: date(row.occurred_at),
      }));
    },

    async listExpenseEntries(from, to) {
      return rows(
        db,
        "SELECT amount, occurred_at FROM expenses WHERE deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ?",
        from.toISOString(),
        to.toISOString(),
      ).map((row) => ({
        amount: fromDbDecimalOrZero(text(row.amount)),
        occurredAt: date(row.occurred_at),
      }));
    },
  };
}
