import assert from "node:assert/strict";
import type { SQLInputValue } from "node:sqlite";

import type { UserRepository } from "@/domain/repositories";
import { D } from "@/lib/money";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { prisma } from "@/server/db";
import { createRepositories } from "@/server/repos/prisma";
import { createMemoryDb } from "@/server/repos/sqlite/client";
import { createSqliteRepositories } from "@/server/repos/sqlite/factory";
import { newId } from "@/server/repos/sqlite/id";

interface UserHarness {
  name: "PostgreSQL" | "SQLite";
  user: UserRepository;
  setUserMeta(id: string, meta: { createdAt: Date; lastLoginAt?: Date | null }): Promise<void>;
  setEmployeeMeta(id: string, meta: { isActive: boolean; deletedAt?: Date | null }): Promise<void>;
  createRelationFixture(userId: string, employeeId: string, prefix: string): Promise<void>;
  historyStillReferences(prefix: string, userId: string, employeeId: string): Promise<boolean>;
  cleanup(): Promise<void>;
}

interface UserSnapshot {
  list: Array<{
    username: string;
    role: string;
    isActive: boolean;
    lastLoginAt: "present" | null;
    workOrderCount: number;
    paymentCount: number;
  }>;
  login: { role: string; isActive: boolean; passwordValid: boolean };
  deletedLookup: { found: boolean; deletedAt: boolean };
  employeeRows: Array<{
    name: string;
    phone: string | null;
    position: string | null;
    isTechnician: boolean;
    isActive: boolean;
    userId: string | null;
    workOrderCount: number;
  }>;
  activeEmployeeNames: string[];
  adminCount: number;
  historyVisibleAfterUserSoftDelete: boolean;
}

let passed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  assert.ok(condition, `${label}${detail ? `：${detail}` : ""}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function expectError(
  label: string,
  operation: () => Promise<unknown>,
  constructorName = "UniqueConstraintError",
): Promise<void> {
  try {
    await operation();
    check(label, false, `应抛出 ${constructorName}`);
  } catch (error) {
    check(label, (error as object).constructor.name === constructorName);
  }
}

async function runContract(harness: UserHarness, prefix: string): Promise<UserSnapshot> {
  console.log(`\n【${harness.name} user contract】`);
  const baselineAdminCount = await harness.user.countActiveAdmins();
  const passwordHash = await hashPassword("Admin123456");
  const admin = await harness.user.create({
    username: `${prefix}-admin`,
    name: "管理员",
    phone: null,
    passwordHash,
    role: "ADMIN",
  });
  const staff = await harness.user.create({
    username: `${prefix}-staff`,
    name: "普通员工",
    phone: "13800000001",
    passwordHash: await hashPassword("Staff123456"),
    role: "STAFF",
  });
  const inactive = await harness.user.create({
    username: `${prefix}-inactive`,
    name: "停用员工",
    phone: null,
    passwordHash,
    role: "STAFF",
  });
  const deleted = await harness.user.create({
    username: `${prefix}-deleted`,
    name: "已删员工",
    phone: null,
    passwordHash,
    role: "STAFF",
  });

  await harness.setUserMeta(admin.id, {
    createdAt: new Date("2099-03-01T00:00:00.000Z"),
    lastLoginAt: new Date("2099-03-02T03:04:05.000Z"),
  });
  await harness.setUserMeta(staff.id, { createdAt: new Date("2099-03-01T00:00:01.000Z") });
  await harness.setUserMeta(inactive.id, { createdAt: new Date("2099-03-01T00:00:02.000Z") });
  await harness.setUserMeta(deleted.id, { createdAt: new Date("2099-03-01T00:00:03.000Z") });
  await harness.user.update(inactive.id, {
    name: "停用员工",
    phone: null,
    role: "STAFF",
    isActive: false,
  });

  const technician = await harness.user.saveEmployee({
    name: `${prefix}-technician`,
    phone: null,
    position: "机修",
    isTechnician: true,
    userId: staff.id,
    remark: null,
  });
  const unbound = await harness.user.saveEmployee({
    name: `${prefix}-unbound`,
    phone: "13900000001",
    position: null,
    isTechnician: false,
    userId: null,
    remark: "nullable employee fields",
  });
  await harness.user.saveEmployee({
    id: unbound.id,
    name: `${prefix}-unbound-updated`,
    phone: null,
    position: "前台",
    isTechnician: false,
    userId: null,
    remark: null,
  });
  const hiddenEmployee = await harness.user.saveEmployee({
    name: `${prefix}-hidden-employee`,
    phone: null,
    position: "历史技师",
    isTechnician: true,
    userId: null,
    remark: null,
  });
  await harness.setEmployeeMeta(hiddenEmployee.id, {
    isActive: false,
    deletedAt: new Date("2099-03-03T00:00:00.000Z"),
  });

  await harness.createRelationFixture(staff.id, technician.id, prefix);
  await harness.user.recordLogin(admin.id);

  const login = await harness.user.findForLogin(admin.username);
  check(
    `${harness.name} 登录凭据读取不依赖 PostgreSQL 专属类型`,
    login?.id === admin.id && login.role === "ADMIN",
  );
  check(
    `${harness.name} 同一 bcrypt 密码校验路径成功`,
    login !== null && (await verifyPassword("Admin123456", login.passwordHash)),
  );
  check(
    `${harness.name} 错误密码失败`,
    login !== null && !(await verifyPassword("WrongPassword123", login.passwordHash)),
  );
  check(
    `${harness.name} inactive 用户仍可读取并保留停用状态`,
    (await harness.user.findForLogin(inactive.username))?.isActive === false,
  );
  check(
    `${harness.name} 用户名精确查询与 deletedAt 区分`,
    (await harness.user.findByUsernameAny(staff.username))?.deletedAt === null &&
      (await harness.user.findForLogin("missing-user")) === null,
  );
  await expectError(`${harness.name} duplicate username 由仓储翻译`, () =>
    harness.user.create({
      username: admin.username,
      name: "重复账号",
      phone: null,
      passwordHash,
      role: "STAFF",
    }),
  );

  await harness.user.softDelete(deleted.id);
  const deletedLookup = await harness.user.findByUsernameAny(deleted.username);
  check(
    `${harness.name} soft delete 保留用户名占用与删除日期`,
    deletedLookup?.id === deleted.id &&
      deletedLookup.deletedAt instanceof Date &&
      (await harness.user.findForEdit(deleted.id)) === null &&
      (await harness.user.findForLogin(deleted.username)) === null,
  );
  check(
    `${harness.name} list 排序/软删除/角色/Date/nullable`,
    (await harness.user.list())
      .filter((row) => row.username.startsWith(prefix))
      .map((row) => row.username)
      .join("|") === `${prefix}-admin|${prefix}-staff|${prefix}-inactive` &&
      (await harness.user.list()).find((row) => row.id === admin.id)?.createdAt.toISOString() ===
        "2099-03-01T00:00:00.000Z" &&
      (await harness.user.list()).find((row) => row.id === admin.id)?.lastLoginAt !== null,
  );
  check(`${harness.name} countActiveAdmins`, (await harness.user.countActiveAdmins()) >= 1);
  check(
    `${harness.name} findBrief/findWithPassword/findOwnProfile`,
    (await harness.user.findBrief(staff.id))?.name === "普通员工" &&
      ((await harness.user.findWithPassword(staff.id))?.passwordHash.length ?? 0) > 20 &&
      (await harness.user.findOwnProfile(staff.id))?.phone === "13800000001",
  );
  await harness.user.updatePassword(staff.id, await hashPassword("Changed123456"));
  check(
    `${harness.name} updatePassword 生效`,
    await verifyPassword(
      "Changed123456",
      (await harness.user.findWithPassword(staff.id))!.passwordHash,
    ),
  );
  await harness.user.updateProfile(staff.id, { name: "普通员工更新", phone: null });
  check(
    `${harness.name} updateProfile nullable round-trip`,
    (await harness.user.findOwnProfile(staff.id))?.name === "普通员工更新" &&
      (await harness.user.findOwnProfile(staff.id))?.phone === null,
  );

  const employees = await harness.user.listEmployees(false);
  const activeEmployees = await harness.user.listEmployees(true);
  check(
    `${harness.name} employee list active/deleted filter`,
    employees.some((row) => row.id === technician.id) &&
      employees.some((row) => row.id === unbound.id) &&
      !employees.some((row) => row.id === hiddenEmployee.id) &&
      activeEmployees.every((row) => row.isActive),
  );
  check(
    `${harness.name} employee relation/nullable/boolean/count`,
    employees.find((row) => row.id === technician.id)?.userId === staff.id &&
      employees.find((row) => row.id === technician.id)?.workOrderCount === 1 &&
      employees.find((row) => row.id === unbound.id)?.phone === null &&
      employees.find((row) => row.id === unbound.id)?.position === "前台" &&
      employees.find((row) => row.id === unbound.id)?.isTechnician === false,
  );

  const historyVisible = await harness.historyStillReferences(prefix, staff.id, technician.id);
  await harness.user.softDelete(staff.id);
  check(
    `${harness.name} 用户软删除不破坏历史工单/技师关系`,
    historyVisible && (await harness.historyStillReferences(prefix, staff.id, technician.id)),
  );

  const snapshot: UserSnapshot = {
    list: (await harness.user.list())
      .filter((row) => row.username.startsWith(prefix))
      .map((row) => ({
        username: row.username,
        role: row.role,
        isActive: row.isActive,
        lastLoginAt: row.lastLoginAt ? "present" : null,
        workOrderCount: row.workOrderCount,
        paymentCount: row.paymentCount,
      })),
    login: {
      role: login!.role,
      isActive: login!.isActive,
      passwordValid: await verifyPassword("Admin123456", login!.passwordHash),
    },
    deletedLookup: {
      found: deletedLookup !== null,
      deletedAt: deletedLookup?.deletedAt instanceof Date,
    },
    employeeRows: employees
      .filter((row) => row.id === technician.id || row.id === unbound.id)
      .map((row) => ({
        name: row.name,
        phone: row.phone,
        position: row.position,
        isTechnician: row.isTechnician,
        isActive: row.isActive,
        userId: row.userId ? "bound" : null,
        workOrderCount: row.workOrderCount,
      })),
    activeEmployeeNames: activeEmployees
      .filter((row) => row.id === technician.id || row.id === unbound.id)
      .map((row) => row.name),
    adminCount: (await harness.user.countActiveAdmins()) - baselineAdminCount,
    historyVisibleAfterUserSoftDelete: await harness.historyStillReferences(
      prefix,
      staff.id,
      technician.id,
    ),
  };

  await harness.cleanup();
  return snapshot;
}

function createSqliteHarness(): UserHarness {
  const db = createMemoryDb();
  const repos = createSqliteRepositories(db);
  const execute = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);
  return {
    name: "SQLite",
    user: repos.user,
    async setUserMeta(id, meta) {
      execute(
        "UPDATE users SET created_at=?, last_login_at=? WHERE id=?",
        meta.createdAt.toISOString(),
        meta.lastLoginAt?.toISOString() ?? null,
        id,
      );
    },
    async setEmployeeMeta(id, meta) {
      execute(
        "UPDATE employees SET is_active=?, deleted_at=? WHERE id=?",
        meta.isActive ? 1 : 0,
        meta.deletedAt?.toISOString() ?? null,
        id,
      );
    },
    async createRelationFixture(userId, employeeId, prefix) {
      const customerId = newId();
      const vehicleId = newId();
      const orderId = newId();
      const now = new Date("2099-03-04T00:00:00.000Z").toISOString();
      execute(
        "INSERT INTO customers (id,name,phone,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        customerId,
        `${prefix}-customer`,
        `${prefix}-phone`,
        userId,
        now,
        now,
      );
      execute(
        "INSERT INTO vehicles (id,customer_id,plate_number,created_at,updated_at) VALUES (?,?,?,?,?)",
        vehicleId,
        customerId,
        `${prefix}-plate`,
        now,
        now,
      );
      execute(
        "INSERT INTO work_orders (id,order_no,status,customer_id,vehicle_id,technician_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        orderId,
        `${prefix}-order`,
        "COMPLETED",
        customerId,
        vehicleId,
        employeeId,
        userId,
        now,
        now,
      );
      execute(
        "INSERT INTO payments (id,work_order_id,customer_id,amount,occurred_at,operator_id,created_at) VALUES (?,?,?,?,?,?,?)",
        newId(),
        orderId,
        customerId,
        "10.50",
        now,
        userId,
        now,
      );
    },
    async historyStillReferences(prefix, userId, employeeId) {
      const row = db
        .prepare("SELECT created_by, technician_id FROM work_orders WHERE order_no=?")
        .get(`${prefix}-order`) as
        { created_by: string | null; technician_id: string | null } | undefined;
      return row?.created_by === userId && row.technician_id === employeeId;
    },
    async cleanup() {
      db.close();
    },
  };
}

function createPostgresHarness(prefix: string): UserHarness {
  const repos = createRepositories(prisma);
  return {
    name: "PostgreSQL",
    user: repos.user,
    async setUserMeta(id, meta) {
      await prisma.user.update({
        where: { id },
        data: { createdAt: meta.createdAt, lastLoginAt: meta.lastLoginAt ?? null },
      });
    },
    async setEmployeeMeta(id, meta) {
      await prisma.employee.update({
        where: { id },
        data: { isActive: meta.isActive, deletedAt: meta.deletedAt ?? null },
      });
    },
    async createRelationFixture(userId, employeeId, prefix) {
      const customer = await prisma.customer.create({
        data: { name: `${prefix}-customer`, phone: `${prefix}-phone`, createdBy: userId },
      });
      const vehicle = await prisma.vehicle.create({
        data: { customerId: customer.id, plateNumber: `${prefix}-plate` },
      });
      const order = await prisma.workOrder.create({
        data: {
          orderNo: `${prefix}-order`,
          status: "COMPLETED",
          customerId: customer.id,
          vehicleId: vehicle.id,
          technicianId: employeeId,
          createdBy: userId,
        },
      });
      await prisma.payment.create({
        data: {
          workOrderId: order.id,
          customerId: customer.id,
          amount: D("10.50"),
          operatorId: userId,
          occurredAt: new Date("2099-03-04T00:00:00.000Z"),
        },
      });
    },
    async historyStillReferences(prefix, userId, employeeId) {
      const row = await prisma.workOrder.findUnique({
        where: { orderNo: `${prefix}-order` },
        select: { createdBy: true, technicianId: true },
      });
      return row?.createdBy === userId && row.technicianId === employeeId;
    },
    async cleanup() {
      await prisma.payment.deleteMany({
        where: { workOrder: { orderNo: { startsWith: prefix } } },
      });
      await prisma.workOrder.deleteMany({ where: { orderNo: { startsWith: prefix } } });
      await prisma.vehicle.deleteMany({ where: { plateNumber: { startsWith: prefix } } });
      await prisma.customer.deleteMany({ where: { phone: { startsWith: prefix } } });
      await prisma.employee.deleteMany({ where: { name: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
    },
  };
}

function checkFactoryFailFast(): void {
  const db = createMemoryDb();
  try {
    const repos = createSqliteRepositories(db);
    check("SQLite Factory 装配真实 User", typeof repos.user.findForLogin === "function");
    check(
      "SQLite Factory 装配真实 audit",
      typeof repos.audit.append === "function" && typeof repos.audit.list === "function",
    );
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const prefix = `USR${Date.now()}`;
  const target = process.env.CONTRACT_BACKEND;
  let sqlite: UserSnapshot | undefined;
  let postgres: UserSnapshot | undefined;
  if (target !== "postgres") {
    sqlite = await runContract(createSqliteHarness(), prefix);
    checkFactoryFailFast();
  }
  if (target !== "sqlite") {
    postgres = await runContract(createPostgresHarness(prefix), prefix);
  }
  if (sqlite && postgres) {
    console.log("PostgreSQL User snapshot:", JSON.stringify(postgres, null, 2));
    console.log("SQLite User snapshot:", JSON.stringify(sqlite, null, 2));
    assert.deepEqual(postgres, sqlite, "PostgreSQL 与 SQLite User 语义快照不一致");
    passed += 1;
    console.log("\n  ✓ PostgreSQL / SQLite User 语义快照完全一致");
  }
  console.log(`\nUser Repository contract：通过 ${passed} 项，失败 0 项`);
}

main()
  .catch((error) => {
    console.error("\nUser Repository contract 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
