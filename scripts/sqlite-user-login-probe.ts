import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashPassword, verifyPassword } from "@/server/auth/password";
import { closeSqliteDb } from "@/server/repos/sqlite/client";

async function main(): Promise<void> {
  assert.equal(process.env.APP_STORAGE, "sqlite", "探针必须在 APP_STORAGE=sqlite 下运行");
  const tempDir = mkdtempSync(join(tmpdir(), "autorepair-user-login-"));
  process.env.AUTOREPAIR_DB_PATH = join(tempDir, "autorepair.db");
  process.env.BOOTSTRAP_ADMIN_USERNAME = "bootstrap-root";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "Bootstrap123456";
  process.env.BOOTSTRAP_ADMIN_NAME = "初始化管理员";

  try {
    const { repos, storage } = await import("@/server/context");
    assert.equal(storage.kind, "sqlite");

    const created = await repos.user.create({
      username: "sqlite-admin",
      name: "SQLite 管理员",
      phone: null,
      passwordHash: await hashPassword("Admin123456"),
      role: "ADMIN",
    });
    const candidate = await repos.user.findForLogin(created.username);
    assert.ok(candidate);
    assert.equal(candidate.isActive, true);
    assert.equal(await verifyPassword("Admin123456", candidate.passwordHash), true);
    assert.equal(await verifyPassword("WrongPassword123", candidate.passwordHash), false);
    await repos.user.recordLogin(candidate.id);
    assert.equal(
      (await repos.user.list()).find((row) => row.id === candidate.id)?.lastLoginAt !== null,
      true,
    );

    console.log("SQLite credential probe：通过");
    console.log("APP_STORAGE=sqlite 下用户身份读取与 bcrypt 密码验证未访问 PostgreSQL");
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
  console.error("SQLite credential probe 失败：", error);
  process.exitCode = 1;
});
