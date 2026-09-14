import assert from "node:assert/strict";
import type { SQLInputValue } from "node:sqlite";

import type { AuditRepository, Repositories } from "@/domain/repositories";
import { prisma } from "@/server/db";
import { createRepositories } from "@/server/repos/prisma";
import { createMemoryDb } from "@/server/repos/sqlite/client";
import { createSqliteRepositories } from "@/server/repos/sqlite/factory";
import { runInTransaction } from "@/server/repos/sqlite/transaction";

interface AuditHarness {
  name: "PostgreSQL" | "SQLite";
  repos: Repositories;
  audit: AuditRepository;
  createUser(prefix: string): Promise<{ id: string; name: string }>;
  setCreatedAt(entityId: string, createdAt: Date): Promise<void>;
  transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
  cleanup(prefix: string): Promise<void>;
}

interface AuditSnapshot {
  filtered: Array<{
    userName: string | null;
    action: string;
    entity: string;
    entityId: string;
    summary: string | null;
    before: unknown;
    after: unknown;
    ip: string | null;
    userAgent: string | null;
    createdAt: string;
  }>;
  page: string[];
  pageTotal: number;
  historyAfterUserSoftDelete: { userId: "present" | null; userName: string | null };
}

let passed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  assert.ok(condition, `${label}${detail ? `：${detail}` : ""}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function expectRollback(harness: AuditHarness, prefix: string): Promise<void> {
  try {
    await harness.transaction(async (repos) => {
      await repos.audit.append({
        userId: null,
        userName: "事务用户",
        action: "WORK_ORDER_UPDATE",
        entity: "work_order",
        entityId: `${prefix}-rollback`,
        summary: "应回滚",
      });
      throw new Error("rollback probe");
    });
  } catch (error) {
    assert.equal((error as Error).message, "rollback probe");
  }
  const result = await harness.audit.list(
    { entityId: `${prefix}-rollback` },
    { skip: 0, take: 10 },
  );
  check(`${harness.name} 审计写入随事务回滚`, result.total === 0);
}

async function runContract(harness: AuditHarness, prefix: string): Promise<AuditSnapshot> {
  console.log(`\n【${harness.name} audit contract】`);
  const user = await harness.createUser(prefix);
  const fixed = [
    {
      userId: user.id,
      userName: user.name,
      action: "WORK_ORDER_UPDATE",
      entity: "work_order",
      entityId: `${prefix}-order`,
      summary: "修改金额",
      before: { amount: "10.50", note: null },
      after: { amount: "99.99", items: ["service", 1] },
      ip: "127.0.0.1",
      userAgent: "audit-contract",
      createdAt: new Date("2099-01-02T03:04:05.000Z"),
    },
    {
      userId: null,
      userName: "系统",
      action: "LOGIN",
      entity: "user",
      entityId: `${prefix}-login`,
      summary: "登录",
      before: undefined,
      after: { success: true },
      ip: null,
      userAgent: null,
      createdAt: new Date("2099-01-03T03:04:05.000Z"),
    },
    {
      userId: user.id,
      userName: user.name,
      action: "STOCK_ADJUST",
      entity: "part",
      entityId: `${prefix}-part`,
      summary: null,
      before: { quantity: "1.10" },
      after: { quantity: "0.00" },
      ip: "10.0.0.2",
      userAgent: "stock-contract",
      createdAt: new Date("2099-01-04T03:04:05.000Z"),
    },
  ] as const;

  for (const item of fixed) {
    await harness.audit.append(item);
    await harness.setCreatedAt(item.entityId, item.createdAt);
  }

  const all = await harness.audit.list({ entityId: `${prefix}-order` }, { skip: 0, take: 10 });
  check(
    `${harness.name} append / detail 字段完整`,
    all.total === 1 &&
      all.rows[0]?.userId === user.id &&
      all.rows[0]?.userName === user.name &&
      all.rows[0]?.before !== null &&
      (all.rows[0]?.before as { amount: string }).amount === "10.50" &&
      (all.rows[0]?.after as { amount: string }).amount === "99.99" &&
      all.rows[0]?.createdAt.toISOString() === "2099-01-02T03:04:05.000Z",
  );
  const detail = await harness.audit.findById(all.rows[0]!.id);
  check(
    `${harness.name} findById 与 list 语义一致`,
    detail?.id === all.rows[0]!.id &&
      detail.entityId === `${prefix}-order` &&
      detail.before !== null &&
      (detail.after as { items: unknown[] }).items.length === 2,
  );

  const userRows = await harness.audit.list({ userId: user.id }, { skip: 0, take: 100 });
  const entityRows = await harness.audit.list({ entity: "work_order" }, { skip: 0, take: 100 });
  const entityIdRows = await harness.audit.list(
    { entityId: `${prefix}-login` },
    { skip: 0, take: 10 },
  );
  const actionRows = await harness.audit.list({ action: "STOCK_ADJUST" }, { skip: 0, take: 100 });
  check(
    `${harness.name} userId/entity/entityId/action 过滤`,
    userRows.rows.filter((row) => row.entityId.startsWith(prefix)).length === 2 &&
      entityRows.rows.filter((row) => row.entityId.startsWith(prefix)).length === 1 &&
      entityIdRows.total === 1 &&
      actionRows.rows.filter((row) => row.entityId.startsWith(prefix)).length === 1,
  );
  check(
    `${harness.name} 日期范围含边界`,
    (
      await harness.audit.list(
        { from: new Date("2099-01-02T03:04:05.000Z"), to: new Date("2099-01-03T03:04:05.000Z") },
        { skip: 0, take: 10 },
      )
    ).total === 2,
  );
  check(
    `${harness.name} ordering / pagination / total`,
    (
      await harness.audit.list(
        { from: new Date("2099-01-02T03:04:05.000Z"), to: new Date("2099-01-04T03:04:05.000Z") },
        { skip: 0, take: 2 },
      )
    ).rows
      .map((row) => row.entityId)
      .join("|") === `${prefix}-part|${prefix}-login` &&
      (
        await harness.audit.list(
          { from: new Date("2099-01-02T03:04:05.000Z"), to: new Date("2099-01-04T03:04:05.000Z") },
          { skip: 2, take: 2 },
        )
      ).rows
        .map((row) => row.entityId)
        .join("|") === `${prefix}-order`,
  );

  await harness.repos.user.softDelete(user.id);
  const history = await harness.audit.findById(all.rows[0]!.id);
  check(
    `${harness.name} 用户软删除后历史日志仍可读`,
    history?.userId === user.id && history.userName === user.name,
  );

  for (let index = 0; index < 12; index += 1) {
    const entityId = `${prefix}-page-${String(index).padStart(2, "0")}`;
    await harness.audit.append({
      userId: null,
      userName: null,
      action: "WORK_ORDER_STATUS",
      entity: "work_order",
      entityId,
      summary: null,
    });
    await harness.setCreatedAt(
      entityId,
      new Date(`2099-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
    );
  }
  const pageFilter = {
    entity: "work_order",
    from: new Date("2099-02-01T00:00:00.000Z"),
    to: new Date("2099-02-12T00:00:00.000Z"),
  };
  const page1 = await harness.audit.list(pageFilter, { skip: 0, take: 5 });
  const page2 = await harness.audit.list(pageFilter, { skip: 5, take: 5 });
  check(
    `${harness.name} 大量日志分页稳定`,
    page1.total === 12 &&
      page1.rows.length === 5 &&
      page2.rows.length === 5 &&
      new Set([...page1.rows, ...page2.rows].map((row) => row.id)).size === 10,
  );

  await expectRollback(harness, prefix);

  const snapshot: AuditSnapshot = {
    filtered: (
      await harness.audit.list({ entityId: `${prefix}-order` }, { skip: 0, take: 10 })
    ).rows.map((row) => ({
      userName: row.userName,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      summary: row.summary,
      before: row.before,
      after: row.after,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    })),
    page: page1.rows.map((row) => row.entityId),
    pageTotal: page1.total,
    historyAfterUserSoftDelete: {
      userId: history?.userId ? "present" : null,
      userName: history?.userName ?? null,
    },
  };
  await harness.cleanup(prefix);
  return snapshot;
}

function createSqliteHarness(): AuditHarness {
  const db = createMemoryDb();
  const repos = createSqliteRepositories(db);
  const execute = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);
  return {
    name: "SQLite",
    repos,
    audit: repos.audit,
    async createUser(prefix) {
      return repos.user.create({
        username: `${prefix}-user`,
        name: "审计用户",
        phone: null,
        passwordHash: "hash",
        role: "ADMIN",
      });
    },
    async setCreatedAt(entityId, createdAt) {
      execute(
        "UPDATE audit_logs SET created_at=? WHERE entity_id=?",
        createdAt.toISOString(),
        entityId,
      );
    },
    transaction(fn) {
      return runInTransaction(db, () => fn(repos));
    },
    async cleanup() {
      db.close();
    },
  };
}

function createPostgresHarness(): AuditHarness {
  const repos = createRepositories(prisma);
  return {
    name: "PostgreSQL",
    repos,
    audit: repos.audit,
    async createUser(prefix) {
      return repos.user.create({
        username: `${prefix}-user`,
        name: "审计用户",
        phone: null,
        passwordHash: "hash",
        role: "ADMIN",
      });
    },
    async setCreatedAt(entityId, createdAt) {
      await prisma.auditLog.updateMany({ where: { entityId }, data: { createdAt } });
    },
    transaction(fn) {
      return prisma.$transaction((tx) => fn(createRepositories(tx)));
    },
    async cleanup(prefix) {
      await prisma.auditLog.deleteMany({ where: { entityId: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { username: `${prefix}-user` } });
    },
  };
}

async function main(): Promise<void> {
  const prefix = `AUD${Date.now()}`;
  const target = process.env.CONTRACT_BACKEND;
  let sqlite: AuditSnapshot | undefined;
  let postgres: AuditSnapshot | undefined;
  try {
    if (target !== "postgres") sqlite = await runContract(createSqliteHarness(), prefix);
    if (target !== "sqlite") postgres = await runContract(createPostgresHarness(), prefix);
    if (sqlite && postgres) {
      console.log("PostgreSQL Audit snapshot:", JSON.stringify(postgres, null, 2));
      console.log("SQLite Audit snapshot:", JSON.stringify(sqlite, null, 2));
      assert.deepEqual(postgres, sqlite, "PostgreSQL 与 SQLite Audit 语义快照不一致");
      passed += 1;
      console.log("\n  ✓ PostgreSQL / SQLite Audit 语义快照完全一致");
    }
  } finally {
    if (target !== "sqlite") {
      await prisma.auditLog.deleteMany({ where: { entityId: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { username: `${prefix}-user` } });
    }
  }
  console.log(`\nAudit Repository contract：通过 ${passed} 项，失败 0 项`);
}

main()
  .catch((error) => {
    console.error("\nAudit Repository contract 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
