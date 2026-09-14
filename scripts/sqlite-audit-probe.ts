import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeSqliteDb } from "@/server/repos/sqlite/client";

async function main(): Promise<void> {
  assert.equal(process.env.APP_STORAGE, "sqlite", "探针必须在 APP_STORAGE=sqlite 下运行");
  process.env.DATABASE_URL = "postgresql://127.0.0.1:1/unavailable";
  const tempDir = mkdtempSync(join(tmpdir(), "autorepair-audit-"));
  process.env.AUTOREPAIR_DB_PATH = join(tempDir, "autorepair.db");
  process.env.BOOTSTRAP_ADMIN_USERNAME = "bootstrap-root";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "Bootstrap123456";
  process.env.BOOTSTRAP_ADMIN_NAME = "初始化管理员";

  try {
    const [{ repos, storage }, { writeAuditLog }] = await Promise.all([
      import("@/server/context"),
      import("@/server/auth/audit"),
    ]);
    assert.equal(storage.kind, "sqlite");
    const user = await repos.user.create({
      username: "sqlite-audit-admin",
      name: "SQLite 审计管理员",
      phone: null,
      passwordHash: "hash",
      role: "ADMIN",
    });

    await writeAuditLog({
      user,
      action: "USER_CREATE",
      entity: "user",
      entityId: user.id,
      summary: "SQLite 审计探针",
      before: null,
      after: { username: user.username, role: "ADMIN" },
    });

    const result = await repos.audit.list({ entityId: user.id }, { skip: 0, take: 10 });
    assert.equal(result.total, 1);
    assert.equal(result.rows[0]?.action, "USER_CREATE");
    assert.deepEqual(result.rows[0]?.after, { username: user.username, role: "ADMIN" });
    console.log("SQLite Audit probe：通过");
    console.log(
      "APP_STORAGE=sqlite 且 PostgreSQL 不可连接时，业务 Audit 写入与查询均未访问 PostgreSQL",
    );
  } finally {
    closeSqliteDb();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      console.warn(`（临时目录稍后可手动删除：${tempDir}）`);
    }
  }
}

main().catch((error) => {
  console.error("SQLite Audit probe 失败：", error);
  process.exitCode = 1;
});
