import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { BOOTSTRAP_MARKER_KEY } from "@/server/bootstrap/first-run";
import { closeSqliteDb, getSqliteDb } from "@/server/repos/sqlite/client";
import { SQLITE_BUSINESS_TABLES } from "@/server/repos/sqlite/schema-tables";

async function main(): Promise<void> {
  assert.equal(process.env.APP_STORAGE, "sqlite", "probe 只允许 APP_STORAGE=sqlite");
  assert.ok(process.env.AUTOREPAIR_DB_PATH, "probe 必须显式指定 AUTOREPAIR_DB_PATH");

  const context = await import("@/server/context");
  const { verifyPassword } = await import("@/server/auth/password");
  const db = getSqliteDb();
  const expectedUsername = process.env.VERIFY_ADMIN_USERNAME;
  const expectedPassword = process.env.VERIFY_ADMIN_PASSWORD;
  assert.ok(expectedUsername && expectedPassword, "probe 缺少仅用于断言的管理员凭据");

  const login = await context.repos.user.findForLogin(expectedUsername);
  const passwordValid = Boolean(
    login && (await verifyPassword(expectedPassword, login.passwordHash)),
  );

  let sessionValid: boolean | null = null;
  if (process.env.VERIFY_CREATE_SESSION === "1") {
    assert.ok(login && passwordValid, "凭据验证成功后才能建立会话");
    const id = randomUUID();
    const now = new Date();
    await context.sessionStore.create({
      id,
      userId: login.id,
      expiresAt: new Date(now.getTime() + 60_000),
      userAgent: "fresh-install-verify",
      ip: null,
    });
    sessionValid = (await context.sessionStore.findValid(id, now))?.user.id === login.id;
  }

  const counts = Object.fromEntries(
    SQLITE_BUSINESS_TABLES.map((table) => {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as {
        count: number;
      };
      return [table, Number(row.count)];
    }),
  );
  const marker = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(BOOTSTRAP_MARKER_KEY) as { value: string } | undefined;
  const schemaVersion = db.prepare("SELECT MAX(version) AS version FROM schema_version").get() as {
    version: number;
  };
  const activeAdministrators = db
    .prepare(
      `SELECT COUNT(*) AS count FROM users
       WHERE role = 'ADMIN' AND is_active = 1 AND deleted_at IS NULL`,
    )
    .get() as { count: number };

  console.log(
    `FRESH_PROBE_JSON:${JSON.stringify({
      counts,
      marker: marker?.value ?? null,
      schemaVersion: Number(schemaVersion.version),
      activeAdministrators: Number(activeAdministrators.count),
      passwordValid,
      sessionValid,
      integrity: (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string })
        .integrity_check,
      foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
    })}`,
  );
  closeSqliteDb();
}

main().catch((error) => {
  closeSqliteDb();
  console.error(`FRESH_PROBE_FATAL:${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
