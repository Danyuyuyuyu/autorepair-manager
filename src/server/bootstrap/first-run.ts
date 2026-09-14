import { hashSync } from "bcryptjs";
import type { DatabaseSync } from "node:sqlite";

import { createUserSchema } from "@/lib/validation/auth";
import { validatePasswordStrength } from "@/server/auth/password";
import { newId } from "@/server/repos/sqlite/id";
import { SQLITE_BUSINESS_TABLES } from "@/server/repos/sqlite/schema-tables";

export const BOOTSTRAP_MARKER_KEY = "system.bootstrap.completed";
export const BOOTSTRAP_MARKER_VALUE = "1";

const IDENTITY_AND_METADATA_TABLES = new Set(["app_settings", "sessions", "users"]);
const REQUIRED_TABLES = [...SQLITE_BUSINESS_TABLES, "schema_version"] as const;

export type BootstrapOutcome = "CREATED" | "ADOPTED" | "READY";

export interface BootstrapResult {
  outcome: BootstrapOutcome;
  activeAdministrators: number;
}

export class FirstRunBootstrapError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_CONFIGURATION"
      | "INCOMPLETE_SCHEMA"
      | "AMBIGUOUS_EXISTING_DATA"
      | "INVALID_MARKER"
      | "BOOTSTRAP_FAILED",
  ) {
    super(message);
    this.name = "FirstRunBootstrapError";
  }
}

function presentTables(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
    name: string;
  }>;
  return new Set(rows.map((row) => row.name));
}

function assertCompleteSchema(db: DatabaseSync): void {
  const present = presentTables(db);
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new FirstRunBootstrapError(
      `首次初始化失败：数据库结构迁移未完成（缺少 ${missing.join(", ")}）。`,
      "INCOMPLETE_SCHEMA",
    );
  }
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number };
  return Number(row.count);
}

function countActiveAdministrators(db: DatabaseSync): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM users
       WHERE role = 'ADMIN' AND is_active = 1 AND deleted_at IS NULL`,
    )
    .get() as { count: number };
  return Number(row.count);
}

function markerValue(db: DatabaseSync): string | null {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(BOOTSTRAP_MARKER_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

function readyResultIfMarked(db: DatabaseSync): BootstrapResult | null {
  const marker = markerValue(db);
  if (marker === null) return null;
  if (marker !== BOOTSTRAP_MARKER_VALUE) {
    throw new FirstRunBootstrapError(
      "数据库状态异常：首次初始化标记无法识别。已停止自动初始化以保护数据。",
      "INVALID_MARKER",
    );
  }

  const activeAdministrators = countActiveAdministrators(db);
  if (activeAdministrators < 1) {
    throw new FirstRunBootstrapError(
      "数据库状态异常：初始化标记存在，但没有启用的管理员。已停止自动初始化以保护数据。",
      "AMBIGUOUS_EXISTING_DATA",
    );
  }
  return { outcome: "READY", activeAdministrators };
}

function containsProtectedData(db: DatabaseSync): boolean {
  return SQLITE_BUSINESS_TABLES.some(
    (table) => !IDENTITY_AND_METADATA_TABLES.has(table) && count(db, table) > 0,
  );
}

function writeMarker(db: DatabaseSync, now: string): void {
  db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
    BOOTSTRAP_MARKER_KEY,
    BOOTSTRAP_MARKER_VALUE,
    now,
  );
}

function inImmediateTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // SQLite may already have rolled the transaction back.
    }
    throw error;
  }
}

function readAdminConfiguration(): {
  username: string;
  name: string;
  password: string;
} {
  const parsed = createUserSchema.safeParse({
    username: process.env.BOOTSTRAP_ADMIN_USERNAME,
    name: process.env.BOOTSTRAP_ADMIN_NAME ?? "店长",
    phone: undefined,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    role: "ADMIN",
  });
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => {
        const field = issue.path[0];
        if (field === "username") return `BOOTSTRAP_ADMIN_USERNAME：${issue.message}`;
        if (field === "password") return `BOOTSTRAP_ADMIN_PASSWORD：${issue.message}`;
        if (field === "name") return `BOOTSTRAP_ADMIN_NAME：${issue.message}`;
        return issue.message;
      })
      .join("；");
    throw new FirstRunBootstrapError(
      `首次初始化失败：管理员配置无效。${detail}`,
      "INVALID_CONFIGURATION",
    );
  }

  const strength = validatePasswordStrength(parsed.data.password);
  if (strength) {
    throw new FirstRunBootstrapError(
      `首次初始化失败：BOOTSTRAP_ADMIN_PASSWORD ${strength}。`,
      "INVALID_CONFIGURATION",
    );
  }

  return {
    username: parsed.data.username,
    name: parsed.data.name,
    password: parsed.data.password,
  };
}

function shouldInjectFailureAfterAdmin(): boolean {
  return (
    process.env.NODE_ENV === "test" && process.env.BOOTSTRAP_TEST_FAILURE_POINT === "after-admin"
  );
}

/**
 * Migration 后唯一的 First Run seam。
 *
 * - READY marker + active admin: zero writes.
 * - Legacy/restored DB with an active admin: add only the marker.
 * - Truly empty schema: create exactly one administrator and the marker atomically.
 * - Any existing/ambiguous data without an active admin: fail closed.
 */
export function ensureFirstRunBootstrap(db: DatabaseSync): BootstrapResult {
  assertCompleteSchema(db);

  const ready = readyResultIfMarked(db);
  if (ready) return ready;

  const activeAdministrators = countActiveAdministrators(db);

  if (activeAdministrators > 0) {
    const adopted = inImmediateTransaction(db, () => {
      const nowReady = readyResultIfMarked(db);
      if (nowReady) return nowReady;

      const lockedAdministrators = countActiveAdministrators(db);
      if (lockedAdministrators < 1) {
        throw new FirstRunBootstrapError(
          "数据库状态异常：管理员状态在初始化期间发生变化。已停止自动初始化以保护数据。",
          "AMBIGUOUS_EXISTING_DATA",
        );
      }
      writeMarker(db, new Date().toISOString());
      return { outcome: "ADOPTED", activeAdministrators: lockedAdministrators } as const;
    });
    if (adopted.outcome === "ADOPTED") {
      console.info("[bootstrap] 已识别既有数据库并补记初始化状态；未修改任何账号或业务数据");
    }
    return adopted;
  }

  if (count(db, "users") > 0 || containsProtectedData(db)) {
    throw new FirstRunBootstrapError(
      "数据库状态异常：检测到已有数据，但没有启用的管理员。自动初始化已被阻止，以避免覆盖用户数据。",
      "AMBIGUOUS_EXISTING_DATA",
    );
  }

  const admin = readAdminConfiguration();
  const passwordHash = hashSync(admin.password, 10);
  const now = new Date().toISOString();

  try {
    const initialized = inImmediateTransaction(db, () => {
      // 取得写锁后重新判定：并发启动中若另一进程已完成，这里直接接受 READY。
      const nowReady = readyResultIfMarked(db);
      if (nowReady) return nowReady;

      const lockedAdministrators = countActiveAdministrators(db);
      if (lockedAdministrators > 0) {
        writeMarker(db, now);
        return { outcome: "ADOPTED", activeAdministrators: lockedAdministrators } as const;
      }
      if (count(db, "users") > 0 || containsProtectedData(db)) {
        throw new FirstRunBootstrapError(
          "数据库状态异常：检测到已有数据，但没有启用的管理员。自动初始化已被阻止，以避免覆盖用户数据。",
          "AMBIGUOUS_EXISTING_DATA",
        );
      }

      db.prepare(
        `INSERT INTO users
         (id, username, name, phone, password_hash, role, is_active,
          last_login_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, NULL, ?, 'ADMIN', 1, NULL, ?, ?, NULL)`,
      ).run(newId(), admin.username, admin.name, passwordHash, now, now);

      if (shouldInjectFailureAfterAdmin()) {
        throw new Error("测试注入：管理员创建后、marker 写入前失败");
      }

      writeMarker(db, now);
      return { outcome: "CREATED", activeAdministrators: 1 } as const;
    });
    if (initialized.outcome === "CREATED") {
      console.info("[bootstrap] 首次运行初始化完成：管理员初始化成功");
    } else if (initialized.outcome === "ADOPTED") {
      console.info("[bootstrap] 已识别并发完成的数据库初始化；未修改既有管理员");
    }
    return initialized;
  } catch (error) {
    if (error instanceof FirstRunBootstrapError) throw error;
    throw new FirstRunBootstrapError(
      `首次初始化失败：管理员与初始化标记已回滚。${error instanceof Error ? error.message : String(error)}`,
      "BOOTSTRAP_FAILED",
    );
  }
}
