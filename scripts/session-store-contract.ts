import assert from "node:assert/strict";

import type { SessionStore } from "@/server/auth/session-store";
import { prisma } from "@/server/db";
import { createRepositories } from "@/server/repos/prisma";
import { withTranslatedErrors } from "@/server/repos/prisma/client";
import { createMemoryDb } from "@/server/repos/sqlite/client";
import { withSqliteErrorTranslation } from "@/server/repos/sqlite/errors";
import { createSqliteRepositories } from "@/server/repos/sqlite/factory";
import { createSqliteSessionStore } from "@/server/auth/session-stores/sqlite";
import { createPrismaSessionStore } from "@/server/auth/session-stores/prisma";

interface SessionHarness {
  name: "PostgreSQL" | "SQLite";
  store: SessionStore;
  createUser(
    username: string,
    options?: { isActive?: boolean; deleted?: boolean },
  ): Promise<string>;
  cleanup(prefix: string): Promise<void>;
}

let passed = 0;

function check(label: string, condition: unknown): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function expectError(label: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
    check(label, false);
  } catch (error) {
    check(label, (error as Error).constructor.name === "UniqueConstraintError");
  }
}

function input(id: string, userId: string, expiresAt: Date) {
  return {
    id,
    userId,
    expiresAt,
    userAgent: "session-contract",
    ip: "127.0.0.1",
  };
}

async function runContract(harness: SessionHarness, prefix: string): Promise<void> {
  console.log(`\n【${harness.name} SessionStore contract】`);
  const now = new Date("2099-01-02T00:00:00.000Z");
  const activeUserId = await harness.createUser(`${prefix}-active`);
  const inactiveUserId = await harness.createUser(`${prefix}-inactive`, { isActive: false });
  const deletedUserId = await harness.createUser(`${prefix}-deleted`, { deleted: true });

  const first = input(`${prefix}-session-1`, activeUserId, new Date("2099-01-03T00:00:00.000Z"));
  await harness.store.create(first);
  const found = await harness.store.findValid(first.id, now);
  check(
    `${harness.name} create / token 查找 / User 关联`,
    found?.user.id === activeUserId && found.user.username === `${prefix}-active`,
  );
  check(
    `${harness.name} expiry Date round-trip`,
    found?.expiresAt.toISOString() === "2099-01-03T00:00:00.000Z",
  );

  const expired = input(`${prefix}-expired`, activeUserId, new Date("2099-01-01T23:59:59.999Z"));
  await harness.store.create(expired);
  check(
    `${harness.name} 过期 Session 不可用并被清理`,
    (await harness.store.findValid(expired.id, now)) === null,
  );
  check(
    `${harness.name} 不存在 token 不可用`,
    (await harness.store.findValid("missing", now)) === null,
  );

  const inactive = input(
    `${prefix}-inactive-session`,
    inactiveUserId,
    new Date("2099-01-03T00:00:00.000Z"),
  );
  const deleted = input(
    `${prefix}-deleted-session`,
    deletedUserId,
    new Date("2099-01-03T00:00:00.000Z"),
  );
  await harness.store.create(inactive);
  await harness.store.create(deleted);
  const inactiveFound = await harness.store.findValid(inactive.id, now);
  const deletedFound = await harness.store.findValid(deleted.id, now);
  check(
    `${harness.name} inactive user 状态传递给 auth 层`,
    inactiveFound?.user.id === inactiveUserId && inactiveFound.user.isActive === false,
  );
  check(
    `${harness.name} deleted user 状态传递给 auth 层`,
    deletedFound?.user.id === deletedUserId && deletedFound.user.deletedAt instanceof Date,
  );

  await expectError(`${harness.name} 重复 token 唯一约束翻译`, () => harness.store.create(first));

  const second = input(`${prefix}-session-2`, activeUserId, new Date("2099-01-03T00:00:00.000Z"));
  await harness.store.create(second);
  check(
    `${harness.name} 多 Session 不串用户`,
    (await harness.store.findValid(second.id, now))?.user.id === activeUserId &&
      (await harness.store.findValid(inactive.id, now))?.user.id === inactiveUserId,
  );
  await harness.store.revoke(first.id);
  check(
    `${harness.name} revoke 单个 Session 不影响其他 Session`,
    (await harness.store.findValid(first.id, now)) === null &&
      (await harness.store.findValid(second.id, now)) !== null,
  );
  await harness.store.revokeAll(activeUserId);
  check(
    `${harness.name} logout / revokeAll`,
    (await harness.store.findValid(second.id, now)) === null,
  );

  const cleanupExpired = input(
    `${prefix}-cleanup-expired`,
    inactiveUserId,
    new Date("2099-01-01T00:00:00.000Z"),
  );
  const cleanupActive = input(
    `${prefix}-cleanup-active`,
    inactiveUserId,
    new Date("2099-01-05T00:00:00.000Z"),
  );
  await harness.store.create(cleanupExpired);
  await harness.store.create(cleanupActive);
  // 注意：pruneExpired(now) 会清掉**全表**所有早于 now 的会话，不只是本契约造的。
  // 断言必须只关心「本契约那条过期会话没了、那条有效会话还在」，不能要求总数恰好为 1
  // —— 否则库里只要存在任何真实会话（例如线上登录会话），这里就会假红。
  const pruned = await harness.store.pruneExpired(now);
  check(
    `${harness.name} prune expired sessions`,
    pruned >= 1 &&
      (await harness.store.findValid(cleanupExpired.id, now)) === null &&
      (await harness.store.findValid(cleanupActive.id, now)) !== null,
  );

  await harness.cleanup(prefix);
}

function createSqliteHarness(): SessionHarness {
  const db = createMemoryDb();
  const repos = createSqliteRepositories(db);
  return {
    name: "SQLite",
    store: withSqliteErrorTranslation(createSqliteSessionStore(db)),
    async createUser(username, options) {
      const user = await repos.user.create({
        username,
        name: username,
        phone: null,
        passwordHash: "hash",
        role: "STAFF",
      });
      if (options?.isActive === false) {
        await repos.user.update(user.id, {
          name: username,
          phone: null,
          role: "STAFF",
          isActive: false,
        });
      }
      if (options?.deleted) await repos.user.softDelete(user.id);
      return user.id;
    },
    async cleanup() {
      db.close();
    },
  };
}

function createPostgresHarness(): SessionHarness {
  const repos = createRepositories(prisma);
  return {
    name: "PostgreSQL",
    store: withTranslatedErrors(createPrismaSessionStore(prisma)),
    async createUser(username, options) {
      const user = await repos.user.create({
        username,
        name: username,
        phone: null,
        passwordHash: "hash",
        role: "STAFF",
      });
      if (options?.isActive === false) {
        await repos.user.update(user.id, {
          name: username,
          phone: null,
          role: "STAFF",
          isActive: false,
        });
      }
      if (options?.deleted) await repos.user.softDelete(user.id);
      return user.id;
    },
    async cleanup(prefix) {
      await prisma.session.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
    },
  };
}

async function main(): Promise<void> {
  const prefix = `SES${Date.now()}`;
  await runContract(createSqliteHarness(), prefix);
  await runContract(createPostgresHarness(), prefix);
  console.log(`\nSessionStore contract：通过 ${passed} 项，失败 0 项`);
}

main()
  .catch((error) => {
    console.error("\nSessionStore contract 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
