/**
 * 以指定存储模式运行冒烟测试（Windows 兼容，不依赖 Unix 环境变量语法）。
 *
 *   node scripts/run-with-storage.mjs postgres  → APP_STORAGE=postgres pnpm smoke
 *   node scripts/run-with-storage.mjs sqlite    → APP_STORAGE=sqlite  pnpm smoke
 *
 * 阶段 2 · Step 5：SQLite 的 10 个业务 Repository、Audit、SessionStore 全部完成，
 * 共享 smoke 已经与存储解耦（数据库专属的直接检查收敛在 scripts/smoke-inspector.ts），
 * 因此这里不再拒绝 sqlite —— 同一套 135 条断言在两种存储上各跑一遍。
 *
 * SQLite 模式的前置条件：目标库已有基线数据（本项目的做法是先用
 * pnpm migrate:postgres-to-sqlite 迁移一份，或已存在可用的 SQLite 库）。
 *
 * 用法（package.json）：
 *   "smoke:postgres": "node scripts/run-with-storage.mjs postgres"
 *   "smoke:sqlite":   "node scripts/run-with-storage.mjs sqlite"
 */
import { spawnSync } from "node:child_process";

const kind = process.argv[2];

if (kind !== "postgres" && kind !== "sqlite") {
  console.error(
    `用法：node scripts/run-with-storage.mjs <postgres|sqlite>（收到：${kind ?? "无参数"}）`,
  );
  process.exit(2);
}

if (kind === "sqlite") {
  console.info(
    "[smoke:sqlite] 使用共享冒烟套件在 SQLite 上运行（存储专属检查见 scripts/smoke-inspector.ts）",
  );
}

const result = spawnSync(
  process.execPath,
  ["--conditions=react-server", "--import", "tsx", "scripts/smoke-test.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, APP_STORAGE: kind },
  },
);

process.exit(result.status ?? 1);
