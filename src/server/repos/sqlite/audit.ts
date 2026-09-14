import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type {
  AuditLogFilter,
  AuditLogInput,
  AuditLogListResult,
  AuditRepository,
} from "@/domain/repositories";
import type { AuditLog } from "@/domain/entities";
import { newId } from "./id";

type SqlRow = Record<string, unknown>;

function text(value: unknown): string | null {
  return value == null ? null : String(value);
}

function date(value: unknown): Date {
  return new Date(String(value));
}

function json(value: unknown): unknown {
  if (value == null) return null;
  return JSON.parse(String(value)) as unknown;
}

function toJsonText(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function one<T extends SqlRow>(
  db: DatabaseSync,
  sql: string,
  ...params: SQLInputValue[]
): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

function rows<T extends SqlRow>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

function mapAudit(row: SqlRow): AuditLog {
  return {
    id: String(row.id),
    userId: text(row.user_id),
    userName: text(row.user_name),
    action: String(row.action),
    entity: String(row.entity),
    entityId: String(row.entity_id),
    summary: text(row.summary),
    before: json(row.before),
    after: json(row.after),
    ip: text(row.ip),
    userAgent: text(row.user_agent),
    createdAt: date(row.created_at),
  };
}

function buildWhere(filter: AuditLogFilter): { sql: string; params: SQLInputValue[] } {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  if (filter.userId !== undefined) {
    clauses.push("user_id = ?");
    params.push(filter.userId);
  }
  if (filter.action !== undefined) {
    clauses.push("action = ?");
    params.push(filter.action);
  }
  if (filter.entity !== undefined) {
    clauses.push("entity = ?");
    params.push(filter.entity);
  }
  if (filter.entityId !== undefined) {
    clauses.push("entity_id = ?");
    params.push(filter.entityId);
  }
  if (filter.from !== undefined) {
    clauses.push("created_at >= ?");
    params.push(filter.from.toISOString());
  }
  if (filter.to !== undefined) {
    clauses.push("created_at <= ?");
    params.push(filter.to.toISOString());
  }
  return { sql: clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`, params };
}

export function createSqliteAuditRepository(db: DatabaseSync): AuditRepository {
  return {
    async append(data: AuditLogInput) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO audit_logs
         (id, user_id, user_name, action, entity, entity_id, summary, before, after, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId(),
        data.userId,
        data.userName,
        data.action,
        data.entity,
        data.entityId,
        data.summary ?? null,
        toJsonText(data.before),
        toJsonText(data.after),
        data.ip ?? null,
        data.userAgent ?? null,
        now,
      );
    },

    async list(filter, paging): Promise<AuditLogListResult> {
      const where = buildWhere(filter);
      const countRow = one<{ total: number }>(
        db,
        `SELECT COUNT(*) AS total FROM audit_logs ${where.sql}`,
        ...where.params,
      );
      const auditRows = rows(
        db,
        `SELECT id, user_id, user_name, action, entity, entity_id, summary,
                before, after, ip, user_agent, created_at
         FROM audit_logs
         ${where.sql}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        ...where.params,
        paging.take,
        paging.skip,
      );
      return { rows: auditRows.map(mapAudit), total: Number(countRow?.total ?? 0) };
    },

    async findById(id) {
      const row = one<SqlRow>(
        db,
        `SELECT id, user_id, user_name, action, entity, entity_id, summary,
                before, after, ip, user_agent, created_at
         FROM audit_logs WHERE id = ? LIMIT 1`,
        id,
      );
      return row ? mapAudit(row) : null;
    },
  };
}
