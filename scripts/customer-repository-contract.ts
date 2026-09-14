import assert from "node:assert/strict";
import type { SQLInputValue } from "node:sqlite";

import type { CustomerRepository } from "@/domain/repositories";
import { prisma } from "@/server/db";
import { createRepositories } from "@/server/repos/prisma";
import { createMemoryDb } from "@/server/repos/sqlite/client";
import { createSqliteRepositories } from "@/server/repos/sqlite/factory";
import { newId } from "@/server/repos/sqlite/id";

type CustomerMeta = {
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  wechat?: string | null;
  address?: string | null;
  remark?: string | null;
};

interface ContractHarness {
  name: "PostgreSQL" | "SQLite";
  customer: CustomerRepository;
  createVehicle(customerId: string, plateNumber: string, deletedAt?: Date): Promise<string>;
  createOrder(input: {
    customerId: string;
    vehicleId: string;
    orderNo: string;
    status: "PENDING_INTAKE" | "COMPLETED" | "CANCELLED";
    totalAmount: string;
    paidAmount: string;
    createdAt: Date;
    deletedAt?: Date;
  }): Promise<void>;
  setCustomerMeta(id: string, meta: CustomerMeta): Promise<void>;
  cleanup(): Promise<void>;
}

interface ContractSnapshot {
  pageNames: string[];
  listKeys: string[];
  relationCounts: { vehicles: number; workOrders: number };
  options: string[];
  activeVehiclePlates: string[];
  stats: Array<{ name: string; total: string; paid: string; lastOrderAt: string }>;
  globalEmpty: string[];
  suggestEmptyCount: number;
  postDeleteActiveCount: number;
  reusedPhoneName: string;
}

let passed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  assert.ok(condition, `${label}${detail ? `：${detail}` : ""}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function expectError(
  label: string,
  constructorName: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
    check(label, false, `应抛出 ${constructorName}`);
  } catch (error) {
    check(label, (error as object).constructor.name === constructorName);
  }
}

function money(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(2);
}

async function runContract(harness: ContractHarness, prefix: string): Promise<ContractSnapshot> {
  console.log(`\n【${harness.name} customer contract】`);
  const phone = {
    alice: `${prefix}01`,
    bob: `${prefix}02`,
    charlie: `${prefix}03`,
    deleted: `${prefix}04`,
  };
  const dates = {
    first: new Date("2097-01-01T00:00:00.000Z"),
    second: new Date("2097-01-02T00:00:00.000Z"),
    third: new Date("2097-01-03T00:00:00.000Z"),
    fourth: new Date("2097-01-04T00:00:00.000Z"),
    fifth: new Date("2097-01-05T00:00:00.000Z"),
  };
  const baselineActive = await harness.customer.countActive();

  try {
    const alice = await harness.customer.create({
      name: "Alice Garage",
      phone: phone.alice,
      createdBy: null,
    });
    const bob = await harness.customer.create({
      name: "客户乙",
      phone: phone.bob,
      createdBy: null,
    });
    const charlie = await harness.customer.create({
      name: "Case Tester",
      phone: phone.charlie,
      createdBy: null,
    });
    const deleted = await harness.customer.create({
      name: "Deleted Customer",
      phone: phone.deleted,
      createdBy: null,
    });

    await harness.customer.update(alice.id, {
      name: "Alice Updated",
      phone: phone.alice,
      wechat: "WxAlpha",
      address: null,
      remark: "O'Reilly customer",
    });
    await harness.setCustomerMeta(alice.id, {
      createdAt: dates.first,
      updatedAt: dates.fourth,
      wechat: "WxAlpha",
      address: null,
      remark: "O'Reilly customer",
    });
    await harness.setCustomerMeta(bob.id, {
      createdAt: dates.second,
      updatedAt: dates.third,
      wechat: "betaNote",
      address: "二号地址",
      remark: null,
    });
    await harness.setCustomerMeta(charlie.id, {
      createdAt: dates.third,
      updatedAt: dates.second,
      wechat: null,
      address: null,
      remark: null,
    });
    await harness.setCustomerMeta(deleted.id, {
      createdAt: dates.fourth,
      updatedAt: dates.fifth,
      deletedAt: dates.fifth,
      wechat: "deletedWx",
      address: null,
      remark: null,
    });

    const aliceVehicle = await harness.createVehicle(alice.id, "粤A10001");
    await harness.createVehicle(alice.id, "粤DEL999", dates.fifth);
    const bobVehicle = await harness.createVehicle(bob.id, "粤B20002");

    await harness.createOrder({
      customerId: alice.id,
      vehicleId: aliceVehicle,
      orderNo: `${prefix}-ACTIVE`,
      status: "COMPLETED",
      totalAmount: "10.50",
      paidAmount: "1.10",
      createdAt: dates.first,
    });
    await harness.createOrder({
      customerId: alice.id,
      vehicleId: aliceVehicle,
      orderNo: `${prefix}-CANCELLED`,
      status: "CANCELLED",
      totalAmount: "99.99",
      paidAmount: "99.99",
      createdAt: dates.second,
    });
    await harness.createOrder({
      customerId: alice.id,
      vehicleId: aliceVehicle,
      orderNo: `${prefix}-DELETED`,
      status: "PENDING_INTAKE",
      totalAmount: "999.99",
      paidAmount: "0.01",
      createdAt: dates.third,
      deletedAt: dates.fifth,
    });
    await harness.createOrder({
      customerId: bob.id,
      vehicleId: bobVehicle,
      orderNo: `${prefix}-BOB`,
      status: "PENDING_INTAKE",
      totalAmount: "99999999.99",
      paidAmount: "0.01",
      createdAt: dates.fourth,
    });

    check(
      `${harness.name} create 返回 ID/name`,
      alice.id.length > 0 && alice.name === "Alice Garage",
    );
    check(
      `${harness.name} 手机号精确查询`,
      (await harness.customer.findByPhone(phone.alice))?.id === alice.id,
    );
    check(
      `${harness.name} 手机号查询 excludeId`,
      (await harness.customer.findByPhone(phone.alice, alice.id)) === null,
    );
    const edit = await harness.customer.findForEdit(alice.id);
    check(
      `${harness.name} update 与 nullable round-trip`,
      edit?.name === "Alice Updated" &&
        edit.wechat === "WxAlpha" &&
        edit.address === null &&
        edit.remark === "O'Reilly customer",
    );

    const page = await harness.customer.list({ keyword: prefix }, { skip: 1, take: 1 });
    check(`${harness.name} 分页与 active 总数`, page.total === 3 && page.rows.length === 1);
    check(`${harness.name} createdAt 倒序`, page.rows[0]?.name === "客户乙");
    check(
      `${harness.name} Date 与领域行转换`,
      page.rows[0]?.createdAt instanceof Date &&
        page.rows[0].createdAt.toISOString() === dates.second.toISOString(),
    );

    const aliceList = await harness.customer.list({ keyword: "alice" }, { skip: 0, take: 10 });
    check(
      `${harness.name} 姓名模糊匹配不区分大小写`,
      aliceList.total === 1 && aliceList.rows[0]?.id === alice.id,
    );
    check(
      `${harness.name} 手机号模糊匹配`,
      (await harness.customer.list({ keyword: phone.bob.slice(-5) }, { skip: 0, take: 10 })).rows[0]
        ?.id === bob.id,
    );
    check(
      `${harness.name} 微信备注模糊匹配不区分大小写`,
      (await harness.customer.list({ keyword: "wxalpha" }, { skip: 0, take: 10 })).rows[0]?.id ===
        alice.id,
    );
    check(
      `${harness.name} 已删车辆车牌仍参与列表关联搜索`,
      (await harness.customer.list({ keyword: "粤del999" }, { skip: 0, take: 10 })).rows[0]?.id ===
        alice.id,
    );
    check(
      `${harness.name} SQL 输入使用绑定参数`,
      (await harness.customer.list({ keyword: "%' OR 1=1 --" }, { skip: 0, take: 10 })).total === 0,
    );

    const aliceRow = aliceList.rows[0]!;
    check(
      `${harness.name} 关系统计包含软删关联行`,
      aliceRow._count.vehicles === 2 && aliceRow._count.workOrders === 3,
    );
    check(
      `${harness.name} findListView 隐藏已删客户`,
      (await harness.customer.findListView(deleted.id)) === null,
    );

    const options = await harness.customer.listOptions(2);
    check(
      `${harness.name} listOptions updatedAt 排序与 limit`,
      options.map((row) => row.name).join(",") === "Alice Updated,客户乙",
    );
    const withVehicles = await harness.customer.findByPhoneWithVehicles(phone.alice);
    check(
      `${harness.name} 手机查询只返回 active 车辆`,
      withVehicles?.vehicles.length === 1 && withVehicles.vehicles[0]?.plateNumber === "粤A10001",
    );

    check(
      `${harness.name} 空客户集合聚合短路`,
      (await harness.customer.aggregateOrderStats([])).length === 0,
    );
    const stats = await harness.customer.aggregateOrderStats([alice.id, bob.id, charlie.id]);
    const aliceStats = stats.find((row) => row.customerId === alice.id);
    const bobStats = stats.find((row) => row.customerId === bob.id);
    check(
      `${harness.name} 聚合排除取消与软删工单`,
      stats.length === 2 &&
        money(aliceStats!.totalAmount!) === "10.50" &&
        money(aliceStats!.paidAmount!) === "1.10" &&
        aliceStats!.lastOrderAt?.toISOString() === dates.first.toISOString(),
    );
    check(
      `${harness.name} Decimal 大金额聚合精确`,
      money(bobStats!.totalAmount!) === "99999999.99" && money(bobStats!.paidAmount!) === "0.01",
    );

    const deleteView = await harness.customer.findForDelete(alice.id);
    check(
      `${harness.name} 删除前统计包含全部关联行`,
      deleteView?.vehicleCount === 2 && deleteView.workOrderCount === 3,
    );
    check(`${harness.name} existsActive`, await harness.customer.existsActive(alice.id));
    check(
      `${harness.name} countActive`,
      (await harness.customer.countActive()) === baselineActive + 3,
    );
    check(
      `${harness.name} countCreatedBetween 包含两端边界`,
      (await harness.customer.countCreatedBetween(dates.first, dates.second)) === 2,
    );

    check(
      `${harness.name} global 姓名搜索`,
      (await harness.customer.searchForGlobal("ALICE", 10))[0]?.id === alice.id,
    );
    check(
      `${harness.name} global 手机搜索`,
      (await harness.customer.searchForGlobal(phone.bob.slice(-5), 10))[0]?.id === bob.id,
    );
    check(
      `${harness.name} global 微信搜索`,
      (await harness.customer.searchForGlobal("BETANOTE", 10))[0]?.id === bob.id,
    );
    const globalEmpty = await harness.customer.searchForGlobal("", 2);
    check(
      `${harness.name} global 空查询按 updatedAt 排序并限制`,
      globalEmpty.map((row) => row.name).join(",") === "Alice Updated,客户乙",
    );
    check(
      `${harness.name} global vehicleCount 不过滤软删车辆`,
      (await harness.customer.searchForGlobal("ALICE", 10))[0]?.vehicleCount === 2,
    );

    check(
      `${harness.name} suggest 姓名/手机搜索`,
      (await harness.customer.suggest("case", 10))[0]?.id === charlie.id &&
        (await harness.customer.suggest(phone.bob.slice(-5), 10))[0]?.id === bob.id,
    );
    const suggestEmpty = await harness.customer.suggest("", 2);
    check(`${harness.name} suggest 空查询与 limit`, suggestEmpty.length === 2);
    check(
      `${harness.name} 已删客户从搜索与 suggest 隐藏`,
      (await harness.customer.searchForGlobal("Deleted Customer", 10)).length === 0 &&
        (await harness.customer.suggest("Deleted Customer", 10)).length === 0,
    );

    const duplicate = await harness.customer.create({
      name: "Duplicate phone allowed",
      phone: phone.alice,
      createdBy: null,
    });
    check(`${harness.name} phone 无数据库 UNIQUE（重复校验归 service）`, duplicate.id !== alice.id);
    await harness.customer.softDelete(duplicate.id);

    await harness.customer.softDelete(alice.id);
    check(
      `${harness.name} soft delete 后普通读取全部不可见`,
      (await harness.customer.findListView(alice.id)) === null &&
        (await harness.customer.findForEdit(alice.id)) === null &&
        (await harness.customer.findForDelete(alice.id)) === null &&
        !(await harness.customer.existsActive(alice.id)) &&
        (await harness.customer.findByPhone(phone.alice)) === null &&
        (await harness.customer.findByPhoneWithVehicles(phone.alice)) === null,
    );
    check(
      `${harness.name} soft delete 后列表/global/suggest 不可见`,
      (await harness.customer.list({ keyword: "Alice Updated" }, { skip: 0, take: 10 })).total ===
        0 &&
        (await harness.customer.searchForGlobal("Alice Updated", 10)).length === 0 &&
        (await harness.customer.suggest("Alice Updated", 10)).length === 0,
    );
    const activeAfterDelete = await harness.customer.countActive();
    check(`${harness.name} soft delete 后 active count`, activeAfterDelete === baselineActive + 2);

    const replacement = await harness.customer.create({
      name: "Reused Phone",
      phone: phone.alice,
      createdBy: null,
    });
    check(
      `${harness.name} 已删手机号可重新使用`,
      (await harness.customer.findByPhone(phone.alice))?.id === replacement.id,
    );
    await expectError(`${harness.name} update 缺失行翻译 NotFound`, "NotFoundError", () =>
      harness.customer.update("missing-customer", {
        name: "missing",
        phone: "missing",
        wechat: null,
        address: null,
        remark: null,
      }),
    );

    const idToName = new Map([
      [alice.id, "Alice Updated"],
      [bob.id, "客户乙"],
      [charlie.id, "Case Tester"],
    ]);
    return {
      pageNames: page.rows.map((row) => row.name),
      listKeys: Object.keys(aliceRow).sort(),
      relationCounts: aliceRow._count,
      options: options.map((row) => row.name),
      activeVehiclePlates: withVehicles!.vehicles.map((row) => row.plateNumber).sort(),
      stats: stats
        .map((row) => ({
          name: idToName.get(row.customerId)!,
          total: money(row.totalAmount!),
          paid: money(row.paidAmount!),
          lastOrderAt: row.lastOrderAt!.toISOString(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      globalEmpty: globalEmpty.map((row) => row.name),
      suggestEmptyCount: suggestEmpty.length,
      postDeleteActiveCount: activeAfterDelete - baselineActive,
      reusedPhoneName: (await harness.customer.findByPhone(phone.alice))!.name,
    };
  } finally {
    await harness.cleanup();
  }
}

function createSqliteHarness(): ContractHarness {
  const db = createMemoryDb();
  const repos = createSqliteRepositories(db);
  const execute = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);
  return {
    name: "SQLite",
    customer: repos.customer,
    async setCustomerMeta(id, meta) {
      execute(
        `UPDATE customers
         SET created_at=?, updated_at=?, deleted_at=?, wechat=?, address=?, remark=?
         WHERE id=?`,
        meta.createdAt.toISOString(),
        meta.updatedAt.toISOString(),
        meta.deletedAt?.toISOString() ?? null,
        meta.wechat ?? null,
        meta.address ?? null,
        meta.remark ?? null,
        id,
      );
    },
    async createVehicle(customerId, plateNumber, deletedAt) {
      const id = newId();
      const now = new Date("2097-01-01T00:00:00.000Z").toISOString();
      execute(
        `INSERT INTO vehicles
           (id, customer_id, plate_number, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        customerId,
        plateNumber,
        now,
        now,
        deletedAt?.toISOString() ?? null,
      );
      return id;
    },
    async createOrder(input) {
      const createdAt = input.createdAt.toISOString();
      execute(
        `INSERT INTO work_orders
           (id, order_no, status, customer_id, vehicle_id, total_amount, paid_amount,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        input.orderNo,
        input.status,
        input.customerId,
        input.vehicleId,
        input.totalAmount,
        input.paidAmount,
        createdAt,
        createdAt,
        input.deletedAt?.toISOString() ?? null,
      );
    },
    async cleanup() {
      db.close();
    },
  };
}

function createPostgresHarness(prefix: string): ContractHarness {
  const repos = createRepositories(prisma);
  const customerIds: string[] = [];
  const customer: CustomerRepository = {
    ...repos.customer,
    async create(data) {
      const created = await repos.customer.create(data);
      customerIds.push(created.id);
      return created;
    },
  };
  return {
    name: "PostgreSQL",
    customer,
    async setCustomerMeta(id, meta) {
      await prisma.customer.update({
        where: { id },
        data: {
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          deletedAt: meta.deletedAt ?? null,
          wechat: meta.wechat ?? null,
          address: meta.address ?? null,
          remark: meta.remark ?? null,
        },
      });
    },
    async createVehicle(customerId, plateNumber, deletedAt) {
      const vehicle = await prisma.vehicle.create({
        data: { customerId, plateNumber, deletedAt: deletedAt ?? null },
      });
      return vehicle.id;
    },
    async createOrder(input) {
      await prisma.workOrder.create({
        data: {
          orderNo: input.orderNo,
          customerId: input.customerId,
          vehicleId: input.vehicleId,
          status: input.status,
          totalAmount: input.totalAmount,
          paidAmount: input.paidAmount,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          deletedAt: input.deletedAt ?? null,
        },
      });
    },
    async cleanup() {
      await prisma.workOrder.deleteMany({ where: { orderNo: { startsWith: prefix } } });
      if (customerIds.length > 0) {
        await prisma.vehicle.deleteMany({ where: { customerId: { in: customerIds } } });
        await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      }
    },
  };
}

function checkFactoryFailFast(): void {
  const db = createMemoryDb();
  try {
    const repos = createSqliteRepositories(db);
    check(
      "SQLite Factory 装配真实 customer/vehicle",
      typeof repos.customer.countActive === "function" &&
        typeof repos.vehicle.findIdByPlate === "function",
    );
    check(
      "SQLite Factory 保留真实 work-order",
      typeof repos.workOrder.countCreatedBetween === "function",
    );
    check(
      "SQLite Factory 装配真实 audit",
      typeof repos.audit.append === "function" && typeof repos.audit.list === "function",
    );
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const prefix = `CU${Date.now()}`;
  const target = process.env.CONTRACT_BACKEND;
  let sqlite: ContractSnapshot | undefined;
  let postgres: ContractSnapshot | undefined;

  if (target !== "postgres") {
    sqlite = await runContract(createSqliteHarness(), prefix);
    checkFactoryFailFast();
  }
  if (target !== "sqlite") postgres = await runContract(createPostgresHarness(prefix), prefix);
  if (sqlite && postgres) {
    console.log("\nPostgreSQL snapshot:", JSON.stringify(postgres, null, 2));
    console.log("SQLite snapshot:", JSON.stringify(sqlite, null, 2));
    assert.deepEqual(postgres, sqlite, "PostgreSQL 与 SQLite customer contract 结果不一致");
    passed += 1;
    console.log("\n  ✓ PostgreSQL / SQLite Customer 语义快照完全一致");
  }
  console.log(`\ncustomer Repository contract：通过 ${passed} 项，失败 0 项`);
}

main()
  .catch((error) => {
    console.error("\ncustomer Repository contract 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
