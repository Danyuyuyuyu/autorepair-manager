/**
 * 过期会话清理调度契约 —— PostgreSQL / SQLite 共用
 * ---------------------------------------------------------------------------
 * 本切片没有改写任何存储语义：`SessionStore.pruneExpired()` 的语义由
 * `pnpm session:contract` 负责。本契约只证明**新加入的调度层**：
 *
 *   1. 节流：登录路径按间隔调用，间隔内不落库（`maybePrune` 返回 null）。
 *   2. 失败隔离：清理失败不会把登录带崩，只上报 onError。
 *   3. `pruneNow`：无视节流、失败向上抛（运维脚本靠它拿非 0 退出码）。
 *   4. 并发：同一时刻多个请求到期只落库一次。
 *   5. 真实存储：调度器接到两套 SessionStore 上都能删过期、留有效。
 *
 * 运行：`pnpm session:prune-contract`（PostgreSQL 需在线；SQLite 用内存库）
 */
import assert from "node:assert/strict";

import {
  createSessionPruneScheduler,
  SESSION_PRUNE_INTERVAL_MS,
} from "@/server/auth/session-prune";
import type { SessionStore } from "@/server/auth/session-store";
import { createPrismaSessionStore } from "@/server/auth/session-stores/prisma";
import { createSqliteSessionStore } from "@/server/auth/session-stores/sqlite";
import { prisma } from "@/server/db";
import { createRepositories } from "@/server/repos/prisma";
import { withTranslatedErrors } from "@/server/repos/prisma/client";
import { createMemoryDb } from "@/server/repos/sqlite/client";
import { withSqliteErrorTranslation } from "@/server/repos/sqlite/errors";
import { createSqliteRepositories } from "@/server/repos/sqlite/factory";

let passed = 0;

function check(label: string, condition: unknown): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

/** 伪存储：记录每次调用时刻，可注入失败 */
function fakeStore(options?: { result?: number; fail?: boolean }) {
  const calls: Date[] = [];
  return {
    calls,
    async pruneExpired(now: Date): Promise<number> {
      calls.push(now);
      if (options?.fail) throw new Error("store unavailable");
      return options?.result ?? 0;
    },
  };
}

async function runSchedulerContract(): Promise<void> {
  console.log("\n【调度器语义（伪存储，不连数据库）】");
  const HOUR = 60 * 60 * 1000;
  let clock = Date.parse("2099-01-01T00:00:00.000Z");
  const now = () => clock;

  check("默认间隔为 1 小时", SESSION_PRUNE_INTERVAL_MS === HOUR);

  const store = fakeStore({ result: 3 });
  const scheduler = createSessionPruneScheduler({ store, intervalMs: HOUR, now });

  check(
    "首次 maybePrune 执行清理并返回删除条数",
    (await scheduler.maybePrune()) === 3 && store.calls.length === 1,
  );

  clock += 59 * 60 * 1000;
  check(
    "间隔内重复调用不落库（登录热点被节流）",
    (await scheduler.maybePrune()) === null && store.calls.length === 1,
  );

  clock += 60 * 1000;
  check("到达间隔边界后再次清理", (await scheduler.maybePrune()) === 3 && store.calls.length === 2);
  check("传给存储的是调度时刻", store.calls[1]?.toISOString() === new Date(clock).toISOString());

  const before = store.calls.length;
  clock += 1000;
  check(
    "pruneNow 无视节流立即执行",
    (await scheduler.pruneNow()) === 3 && store.calls.length === before + 1,
  );

  const errors: unknown[] = [];
  const failing = fakeStore({ fail: true });
  const failingScheduler = createSessionPruneScheduler({
    store: failing,
    intervalMs: HOUR,
    now,
    onError: (error) => errors.push(error),
  });
  check(
    "存储失败时 maybePrune 返回 null 且上报 onError（登录不受影响）",
    (await failingScheduler.maybePrune()) === null && errors.length === 1,
  );
  check(
    "失败后仍处于节流窗口（不会每次登录都重试打库）",
    (await failingScheduler.maybePrune()) === null && failing.calls.length === 1,
  );

  let thrown: unknown = null;
  try {
    await failingScheduler.pruneNow();
  } catch (error) {
    thrown = error;
  }
  check(
    "pruneNow 失败向上抛（运维脚本需要真实退出码）",
    thrown instanceof Error && thrown.message === "store unavailable",
  );

  const concurrent = fakeStore({ result: 1 });
  const concurrentScheduler = createSessionPruneScheduler({
    store: concurrent,
    intervalMs: HOUR,
    now,
  });
  const results = await Promise.all([
    concurrentScheduler.maybePrune(),
    concurrentScheduler.maybePrune(),
    concurrentScheduler.maybePrune(),
  ]);
  check(
    "并发到期只落库一次",
    concurrent.calls.length === 1 &&
      results.filter((row) => row === 1).length === 1 &&
      results.filter((row) => row === null).length === 2,
  );

  let resolved = 0;
  const lazyScheduler = createSessionPruneScheduler({
    store: async () => {
      resolved += 1;
      return fakeStore({ result: 0 });
    },
    now,
  });
  check(
    "惰性存储入口可用（应用侧避免 import 即装配存储）",
    (await lazyScheduler.pruneNow()) === 0 && resolved === 1,
  );
}

interface PruneHarness {
  name: "PostgreSQL" | "SQLite";
  store: SessionStore;
  createUser(username: string): Promise<string>;
  cleanup(prefix: string): Promise<void>;
}

function sessionInput(id: string, userId: string, expiresAt: Date) {
  return { id, userId, expiresAt, userAgent: "session-prune-contract", ip: "127.0.0.1" };
}

async function runStoreContract(harness: PruneHarness, prefix: string): Promise<void> {
  console.log(`\n【${harness.name} 接入真实 SessionStore】`);
  const userId = await harness.createUser(`${prefix}-user`);
  const validUntil = new Date(Date.now() + 60 * 60 * 1000);

  await harness.store.create(
    sessionInput(`${prefix}-expired`, userId, new Date(Date.now() - 60_000)),
  );
  await harness.store.create(sessionInput(`${prefix}-alive`, userId, validUntil));

  const scheduler = createSessionPruneScheduler({ store: harness.store });
  const firstDeleted = await scheduler.maybePrune();
  check(
    `${harness.name} 自动清理删除过期行，保留有效行`,
    typeof firstDeleted === "number" &&
      firstDeleted >= 1 &&
      (await harness.store.findValid(`${prefix}-alive`, new Date())) !== null,
  );
  check(`${harness.name} 同一调度器第二次自动清理被节流`, (await scheduler.maybePrune()) === null);

  await harness.store.create(sessionInput(`${prefix}-late`, userId, new Date(Date.now() - 1000)));
  check(`${harness.name} pruneNow 无视节流并清掉新过期行`, (await scheduler.pruneNow()) === 1);

  await harness.cleanup(prefix);
}

function createSqliteHarness(): PruneHarness {
  const db = createMemoryDb();
  const repos = createSqliteRepositories(db);
  return {
    name: "SQLite",
    store: withSqliteErrorTranslation(createSqliteSessionStore(db)),
    async createUser(username) {
      const user = await repos.user.create({
        username,
        name: username,
        phone: null,
        passwordHash: "hash",
        role: "STAFF",
      });
      return user.id;
    },
    async cleanup() {
      db.close();
    },
  };
}

function createPostgresHarness(): PruneHarness {
  const repos = createRepositories(prisma);
  return {
    name: "PostgreSQL",
    store: withTranslatedErrors(createPrismaSessionStore(prisma)),
    async createUser(username) {
      const user = await repos.user.create({
        username,
        name: username,
        phone: null,
        passwordHash: "hash",
        role: "STAFF",
      });
      return user.id;
    },
    async cleanup(prefix) {
      await prisma.session.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
    },
  };
}

async function main(): Promise<void> {
  await runSchedulerContract();
  const prefix = `SPR${Date.now()}`;
  await runStoreContract(createSqliteHarness(), prefix);
  await runStoreContract(createPostgresHarness(), prefix);
  console.log(`\nSession prune contract：通过 ${passed} 项，失败 0 项`);
}

main()
  .catch((error) => {
    console.error("\nSession prune contract 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
