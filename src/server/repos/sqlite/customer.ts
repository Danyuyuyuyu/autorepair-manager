import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { CustomerRepository } from "@/domain/repositories";
import type {
  CustomerListRow,
  CustomerOrderStatsRow,
  CustomerSuggestionRow,
  SearchCustomerRow,
} from "@/domain/rows";
import { D } from "@/lib/money";
import { NotFoundError } from "@/server/errors";

import { newId } from "./id";

type SqlRow = Record<string, unknown>;

const text = (value: unknown): string | null => (value == null ? null : String(value));
const requiredDate = (value: unknown): Date => new Date(String(value));

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

function mapListRow(row: SqlRow): CustomerListRow {
  return {
    id: String(row.id),
    name: String(row.name),
    phone: String(row.phone),
    wechat: text(row.wechat),
    address: text(row.address),
    remark: text(row.remark),
    createdAt: requiredDate(row.created_at),
    _count: {
      vehicles: Number(row.vehicle_count),
      workOrders: Number(row.work_order_count),
    },
  };
}

const customerListProjection = `
  SELECT c.id, c.name, c.phone, c.wechat, c.address, c.remark, c.created_at,
         (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id) AS vehicle_count,
         (SELECT COUNT(*) FROM work_orders w WHERE w.customer_id = c.id) AS work_order_count
  FROM customers c
`;

function keywordClause(keyword: string): { sql: string; params: SQLInputValue[] } {
  return {
    sql: `(
      LOWER(c.name) LIKE LOWER('%' || ? || '%')
      OR c.phone LIKE '%' || ? || '%'
      OR LOWER(c.wechat) LIKE LOWER('%' || ? || '%')
      OR EXISTS (
        SELECT 1 FROM vehicles v
        WHERE v.customer_id = c.id AND instr(v.plate_number, ?) > 0
      )
    )`,
    params: [keyword, keyword, keyword, keyword.toUpperCase()],
  };
}

export function createSqliteCustomerRepository(db: DatabaseSync): CustomerRepository {
  return {
    async findByPhone(phone, excludeId) {
      const row = one(
        db,
        `SELECT id, name FROM customers
         WHERE phone = ? AND deleted_at IS NULL${excludeId ? " AND id <> ?" : ""}
         LIMIT 1`,
        ...([phone, ...(excludeId ? [excludeId] : [])] as SQLInputValue[]),
      );
      return row ? { id: String(row.id), name: String(row.name) } : null;
    },

    async list(filter, paging) {
      const where = ["c.deleted_at IS NULL"];
      const params: SQLInputValue[] = [];
      if (filter.keyword) {
        const keyword = keywordClause(filter.keyword);
        where.push(keyword.sql);
        params.push(...keyword.params);
      }
      const whereSql = where.join(" AND ");
      const resultRows = rows(
        db,
        `${customerListProjection}
         WHERE ${whereSql}
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        ...params,
        paging.take,
        paging.skip,
      ).map(mapListRow);
      const total = Number(
        one(db, `SELECT COUNT(*) AS count FROM customers c WHERE ${whereSql}`, ...params)?.count ??
          0,
      );
      return { rows: resultRows, total };
    },

    async findListView(id) {
      const row = one(db, `${customerListProjection} WHERE c.id = ? AND c.deleted_at IS NULL`, id);
      return row ? mapListRow(row) : null;
    },

    async listOptions(limit) {
      return rows(
        db,
        `SELECT id, name, phone FROM customers
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC
         LIMIT ?`,
        limit,
      ).map((row) => ({ id: String(row.id), name: String(row.name), phone: String(row.phone) }));
    },

    async findByPhoneWithVehicles(phone) {
      const customer = one(
        db,
        `SELECT id, name, phone FROM customers
         WHERE phone = ? AND deleted_at IS NULL LIMIT 1`,
        phone,
      );
      if (!customer) return null;
      return {
        id: String(customer.id),
        name: String(customer.name),
        phone: String(customer.phone),
        vehicles: rows(
          db,
          `SELECT id, plate_number FROM vehicles
           WHERE customer_id = ? AND deleted_at IS NULL`,
          String(customer.id),
        ).map((vehicle) => ({
          id: String(vehicle.id),
          plateNumber: String(vehicle.plate_number),
        })),
      };
    },

    async aggregateOrderStats(customerIds) {
      if (customerIds.length === 0) return [];
      const placeholders = customerIds.map(() => "?").join(",");
      const orderRows = rows(
        db,
        `SELECT customer_id, total_amount, paid_amount, created_at
         FROM work_orders
         WHERE customer_id IN (${placeholders})
           AND deleted_at IS NULL
           AND status <> 'CANCELLED'`,
        ...customerIds,
      );
      const grouped = new Map<string, CustomerOrderStatsRow>();
      for (const row of orderRows) {
        const customerId = String(row.customer_id);
        const current = grouped.get(customerId);
        const createdAt = requiredDate(row.created_at);
        grouped.set(customerId, {
          customerId,
          totalAmount: (current?.totalAmount ?? D(0)).plus(D(text(row.total_amount))),
          paidAmount: (current?.paidAmount ?? D(0)).plus(D(text(row.paid_amount))),
          lastOrderAt:
            !current?.lastOrderAt || current.lastOrderAt < createdAt
              ? createdAt
              : current.lastOrderAt,
        });
      }
      return [...grouped.values()];
    },

    async create(data) {
      const id = newId();
      const now = new Date().toISOString();
      execute(
        db,
        `INSERT INTO customers (id, name, phone, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        data.name,
        data.phone,
        data.createdBy,
        now,
        now,
      );
      return { id, name: data.name };
    },

    async findForEdit(id) {
      const row = one(
        db,
        `SELECT id, name, phone, wechat, address, remark FROM customers
         WHERE id = ? AND deleted_at IS NULL`,
        id,
      );
      return row
        ? {
            id: String(row.id),
            name: String(row.name),
            phone: String(row.phone),
            wechat: text(row.wechat),
            address: text(row.address),
            remark: text(row.remark),
          }
        : null;
    },

    async update(id, patch) {
      const changed = execute(
        db,
        `UPDATE customers
         SET name = ?, phone = ?, wechat = ?, address = ?, remark = ?, updated_at = ?
         WHERE id = ?`,
        patch.name,
        patch.phone,
        patch.wechat,
        patch.address,
        patch.remark,
        new Date().toISOString(),
        id,
      );
      if (changed === 0) throw new NotFoundError();
    },

    async findForDelete(id) {
      const row = one(
        db,
        `SELECT c.id, c.name, c.phone,
                (SELECT COUNT(*) FROM work_orders w WHERE w.customer_id = c.id) AS work_order_count,
                (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id) AS vehicle_count
         FROM customers c
         WHERE c.id = ? AND c.deleted_at IS NULL`,
        id,
      );
      return row
        ? {
            id: String(row.id),
            name: String(row.name),
            phone: String(row.phone),
            workOrderCount: Number(row.work_order_count),
            vehicleCount: Number(row.vehicle_count),
          }
        : null;
    },

    async softDelete(id) {
      const now = new Date().toISOString();
      const changed = execute(
        db,
        "UPDATE customers SET deleted_at = ?, updated_at = ? WHERE id = ?",
        now,
        now,
        id,
      );
      if (changed === 0) throw new NotFoundError();
    },

    async existsActive(id) {
      return (
        one(db, "SELECT 1 AS found FROM customers WHERE id = ? AND deleted_at IS NULL", id) !==
        undefined
      );
    },

    async countActive() {
      return Number(
        one(db, "SELECT COUNT(*) AS count FROM customers WHERE deleted_at IS NULL")?.count ?? 0,
      );
    },

    async countCreatedBetween(from, to) {
      return Number(
        one(
          db,
          `SELECT COUNT(*) AS count FROM customers
           WHERE deleted_at IS NULL AND created_at >= ? AND created_at <= ?`,
          from.toISOString(),
          to.toISOString(),
        )?.count ?? 0,
      );
    },

    async searchForGlobal(keyword, limit) {
      return rows(
        db,
        `SELECT c.id, c.name, c.phone,
                (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id) AS vehicle_count
         FROM customers c
         WHERE c.deleted_at IS NULL
           AND (
             LOWER(c.name) LIKE LOWER('%' || ? || '%')
             OR c.phone LIKE '%' || ? || '%'
             OR LOWER(c.wechat) LIKE LOWER('%' || ? || '%')
           )
         ORDER BY c.updated_at DESC
         LIMIT ?`,
        keyword,
        keyword,
        keyword,
        limit,
      ).map((row): SearchCustomerRow => ({
        id: String(row.id),
        name: String(row.name),
        phone: String(row.phone),
        vehicleCount: Number(row.vehicle_count),
      }));
    },

    async suggest(keyword, limit) {
      return rows(
        db,
        `SELECT id, name, phone FROM customers
         WHERE deleted_at IS NULL
           AND (
             LOWER(name) LIKE LOWER('%' || ? || '%')
             OR phone LIKE '%' || ? || '%'
           )
         LIMIT ?`,
        keyword,
        keyword,
        limit,
      ).map((row): CustomerSuggestionRow => ({
        id: String(row.id),
        name: String(row.name),
        phone: String(row.phone),
      }));
    },
  };
}
