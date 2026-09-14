import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { Role } from "@/domain/enums";
import type { SessionStore, StoredSession } from "@/server/auth/session-store";

type SqlRow = Record<string, unknown>;

function one<T extends SqlRow>(
  db: DatabaseSync,
  sql: string,
  ...params: SQLInputValue[]
): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

function mapSession(row: SqlRow): StoredSession {
  return {
    expiresAt: new Date(String(row.expires_at)),
    user: {
      id: String(row.user_id),
      username: String(row.username),
      name: String(row.name),
      role: row.role === "ADMIN" ? ("ADMIN" as Role) : ("STAFF" as Role),
      isActive: Number(row.is_active) === 1,
      deletedAt: row.deleted_at == null ? null : new Date(String(row.deleted_at)),
    },
  };
}

export function createSqliteSessionStore(db: DatabaseSync): SessionStore {
  return {
    async create(input) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.userId, input.expiresAt.toISOString(), input.userAgent, input.ip, now);
    },

    async findValid(id, now) {
      const row = one(
        db,
        `SELECT s.expires_at, u.id AS user_id, u.username, u.name, u.role,
                u.is_active, u.deleted_at
         FROM sessions s
         INNER JOIN users u ON u.id = s.user_id
         WHERE s.id = ?
         LIMIT 1`,
        id,
      );
      if (!row) return null;
      const session = mapSession(row);
      if (session.expiresAt.getTime() < now.getTime()) {
        db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
        return null;
      }
      return session;
    },

    async revoke(id) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    },

    async revokeAll(userId) {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    },

    async pruneExpired(now) {
      return Number(
        db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now.toISOString()).changes,
      );
    },
  };
}
