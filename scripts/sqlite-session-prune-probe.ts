/**
 * SQLite 过期会话清理探针
 * ---------------------------------------------------------------------------
 * `pnpm session:prune-contract` 注入自建 SessionStore，证明的是调度器语义；
 * 本探针证明**应用级入口**在 APP_STORAGE=sqlite 下真的接通：
 *   - `maybePruneExpiredSessions()`：登录成功时的自动清理（节流）
 *   - `pruneExpiredSessions()`：`pnpm session:prune` 运维脚本走的入口
 * 运行期间 DATABASE_URL 指向不可达地址，确保整条路径没有回落到 PostgreSQL。
 *
 * 运行：$env:APP_STORAGE="sqlite"; pnpm sqlite:session-prune
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashPassword } from "@/server/auth/password";
import { closeSqliteDb } from "@/server/repos/sqlite/client";

async function main(): Promise<void> {
  assert.equal(process.env.APP_STORAGE, "sqlite", "探针必须在 APP_STORAGE=sqlite 下运行");
  process.env.DATABASE_URL = "postgresql://127.0.0.1:1/unavailable";
  const tempDir = mkdtempSync(join(tmpdir(), "autorepair-sqlite-prune-"));
  process.env.AUTOREPAIR_DB_PATH = join(tempDir, "autorepair.db");
  process.env.BOOTSTRAP_ADMIN_USERNAME = "bootstrap-root";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "Bootstrap123456";
  process.env.BOOTSTRAP_ADMIN_NAME = "初始化管理员";

  try {
    const [{ storage, repos, sessionStore }, prune] = await Promise.all([
      import("@/server/context"),
      import("@/server/auth/session-prune"),
    ]);
    assert.equal(storage.kind, "sqlite");

    const user = await repos.user.create({
      username: "prune-probe",
      name: "清理探针",
      phone: null,
      passwordHash: await hashPassword("Probe123456"),
      role: "STAFF",
    });

    const now = Date.now();
    const seed = (id: string, expiresAt: number) =>
      sessionStore.create({
        id,
        userId: user.id,
        expiresAt: new Date(expiresAt),
        userAgent: "sqlite-session-prune-probe",
        ip: null,
      });

    await seed("probe-expired", now - 60_000);
    await seed("probe-alive", now + 60 * 60 * 1000);

    // 1. 登录路径入口：首次到期 → 真的清理
    const firstAuto = await prune.maybePruneExpiredSessions();
    assert.equal(firstAuto, 1, "自动清理应恰好删除 1 条过期会话");
    assert.ok(
      (await sessionStore.findValid("probe-alive", new Date())) !== null,
      "有效会话必须保留",
    );

    // 2. 节流：同一进程 1 小时内不再写库（返回 null）
    assert.equal(await prune.maybePruneExpiredSessions(), null, "1 小时内应被节流");

    // 3. 运维入口：无视节流，立即清理
    await seed("probe-late", now - 1000);
    assert.equal(await prune.maybePruneExpiredSessions(), null, "节流窗口内仍不自动清理");
    assert.equal(await prune.pruneExpiredSessions(), 1, "运维入口应清掉新过期会话");
    assert.equal(await prune.pruneExpiredSessions(), 0, "再次执行应幂等（没有可清理的行）");

    console.log("SQLite session prune probe：通过");
    console.log(
      JSON.stringify(
        {
          dbPath: process.env.AUTOREPAIR_DB_PATH,
          storage: storage.engine,
          autoPruned: firstAuto,
          throttledSecondCall: true,
          opsPruned: 1,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      // 先断开 SQLite 连接，否则 Windows 上文件被占用、临时目录删不掉
      closeSqliteDb();
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      console.warn(`（临时目录稍后可手动删除：${tempDir}）`);
    }
  }
}

main().catch((error) => {
  console.error("SQLite session prune probe 失败：", error);
  process.exitCode = 1;
});
