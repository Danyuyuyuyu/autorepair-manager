import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { UserRepository } from "@/domain/repositories";
import type { EmployeeListRow, UserListRow } from "@/domain/rows";
import { NotFoundError } from "@/server/errors";
import { newId } from "./id";

type SqlRow = Record<string, unknown>;

const text = (value: unknown): string | null => (value == null ? null : String(value));
const date = (value: unknown): Date | null => (value == null ? null : new Date(String(value)));
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

function ensureChanged(changes: number): void {
  if (changes === 0) throw new NotFoundError();
}

function mapUser(row: SqlRow): UserListRow {
  return {
    id: String(row.id),
    username: String(row.username),
    name: String(row.name),
    phone: text(row.phone),
    role: row.role === "ADMIN" ? "ADMIN" : "STAFF",
    isActive: Number(row.is_active) === 1,
    lastLoginAt: date(row.last_login_at),
    createdAt: requiredDate(row.created_at),
    workOrderCount: Number(row.work_order_count),
    paymentCount: Number(row.payment_count),
  };
}

function mapEmployee(row: SqlRow): EmployeeListRow {
  return {
    id: String(row.id),
    name: String(row.name),
    phone: text(row.phone),
    position: text(row.position),
    isTechnician: Number(row.is_technician) === 1,
    isActive: Number(row.is_active) === 1,
    userId: text(row.user_id),
    remark: text(row.remark),
    workOrderCount: Number(row.work_order_count),
  };
}

export function createSqliteUserRepository(db: DatabaseSync): UserRepository {
  return {
    async list() {
      return rows(
        db,
        `SELECT u.id, u.username, u.name, u.phone, u.role, u.is_active,
                u.last_login_at, u.created_at,
                (SELECT COUNT(*) FROM work_orders w WHERE w.created_by = u.id) AS work_order_count,
                (SELECT COUNT(*) FROM payments p WHERE p.operator_id = u.id) AS payment_count
         FROM users u
         WHERE u.deleted_at IS NULL
         ORDER BY u.role ASC, u.created_at ASC`,
      ).map(mapUser);
    },

    async findByUsernameAny(username) {
      const row = one(db, "SELECT id, deleted_at FROM users WHERE username = ? LIMIT 1", username);
      return row ? { id: String(row.id), deletedAt: date(row.deleted_at) } : null;
    },

    async findForLogin(username) {
      const row = one(
        db,
        `SELECT id, name, password_hash, role, is_active
         FROM users
         WHERE username = ? AND deleted_at IS NULL
         LIMIT 1`,
        username,
      );
      return row
        ? {
            id: String(row.id),
            name: String(row.name),
            passwordHash: String(row.password_hash),
            role: row.role === "ADMIN" ? "ADMIN" : "STAFF",
            isActive: Number(row.is_active) === 1,
          }
        : null;
    },

    async create(data) {
      const id = newId();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO users
         (id, username, name, phone, password_hash, role, is_active,
          last_login_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, NULL)`,
      ).run(id, data.username, data.name, data.phone, data.passwordHash, data.role, now, now);
      return { id, name: data.name, username: data.username };
    },

    async findForEdit(id) {
      const row = one(
        db,
        `SELECT id, name, role, is_active
         FROM users
         WHERE id = ? AND deleted_at IS NULL`,
        id,
      );
      return row
        ? {
            id: String(row.id),
            name: String(row.name),
            role: row.role === "ADMIN" ? "ADMIN" : "STAFF",
            isActive: Number(row.is_active) === 1,
          }
        : null;
    },

    async update(id, patch) {
      ensureChanged(
        execute(
          db,
          `UPDATE users
           SET name = ?, phone = ?, role = ?, is_active = ?, updated_at = ?
           WHERE id = ?`,
          patch.name,
          patch.phone,
          patch.role,
          patch.isActive ? 1 : 0,
          new Date().toISOString(),
          id,
        ),
      );
    },

    async countActiveAdmins() {
      return Number(
        one(
          db,
          "SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND is_active = 1 AND deleted_at IS NULL",
        )?.count ?? 0,
      );
    },

    async findBrief(id) {
      const row = one(db, "SELECT id, name FROM users WHERE id = ? AND deleted_at IS NULL", id);
      return row ? { id: String(row.id), name: String(row.name) } : null;
    },

    async findWithPassword(id) {
      const row = one(
        db,
        `SELECT id, name, password_hash
         FROM users
         WHERE id = ? AND deleted_at IS NULL`,
        id,
      );
      return row
        ? { id: String(row.id), name: String(row.name), passwordHash: String(row.password_hash) }
        : null;
    },

    async findOwnProfile(id) {
      const row = one(
        db,
        "SELECT id, name, phone FROM users WHERE id = ? AND deleted_at IS NULL",
        id,
      );
      return row ? { id: String(row.id), name: String(row.name), phone: text(row.phone) } : null;
    },

    async updatePassword(id, passwordHash) {
      ensureChanged(
        execute(
          db,
          "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
          passwordHash,
          new Date().toISOString(),
          id,
        ),
      );
    },

    async recordLogin(id) {
      ensureChanged(
        execute(
          db,
          "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
          new Date().toISOString(),
          new Date().toISOString(),
          id,
        ),
      );
    },

    async updateProfile(id, patch) {
      ensureChanged(
        execute(
          db,
          "UPDATE users SET name = ?, phone = ?, updated_at = ? WHERE id = ?",
          patch.name,
          patch.phone,
          new Date().toISOString(),
          id,
        ),
      );
    },

    async softDelete(id) {
      const now = new Date().toISOString();
      ensureChanged(
        execute(
          db,
          "UPDATE users SET is_active = 0, deleted_at = ?, updated_at = ? WHERE id = ?",
          now,
          now,
          id,
        ),
      );
    },

    async listEmployees(onlyActive) {
      const where = ["e.deleted_at IS NULL"];
      const params: SQLInputValue[] = [];
      if (onlyActive) where.push("e.is_active = 1");
      return rows(
        db,
        `SELECT e.id, e.name, e.phone, e.position, e.is_technician,
                e.is_active, e.user_id, e.remark,
                (SELECT COUNT(*) FROM work_orders w WHERE w.technician_id = e.id) AS work_order_count
         FROM employees e
         WHERE ${where.join(" AND ")}
         ORDER BY e.is_active DESC, e.name ASC`,
        ...params,
      ).map(mapEmployee);
    },

    async saveEmployee(data) {
      const now = new Date().toISOString();
      if (data.id) {
        ensureChanged(
          execute(
            db,
            `UPDATE employees
             SET name = ?, phone = ?, position = ?, is_technician = ?, user_id = ?,
                 remark = ?, updated_at = ?
             WHERE id = ?`,
            data.name,
            data.phone,
            data.position,
            data.isTechnician ? 1 : 0,
            data.userId,
            data.remark,
            now,
            data.id,
          ),
        );
        return { id: data.id, name: data.name };
      }

      const id = newId();
      db.prepare(
        `INSERT INTO employees
         (id, name, phone, position, is_technician, user_id, is_active, remark,
          created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)`,
      ).run(
        id,
        data.name,
        data.phone,
        data.position,
        data.isTechnician ? 1 : 0,
        data.userId,
        data.remark,
        now,
        now,
      );
      return { id, name: data.name };
    },
  };
}
