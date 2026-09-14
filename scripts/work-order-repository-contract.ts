import assert from "node:assert/strict";
import type { SQLInputValue } from "node:sqlite";

import type { Repositories } from "@/domain/repositories";
import { D } from "@/lib/money";
import { canTransition } from "@/lib/constants";
import { prisma } from "@/server/db";
import { createRepositories } from "@/server/repos/prisma";
import { createMemoryDb } from "@/server/repos/sqlite/client";
import { createSqliteRepositories } from "@/server/repos/sqlite/factory";
import { newId } from "@/server/repos/sqlite/id";

interface FixtureIds {
  customerId: string;
  vehicleId: string;
}

interface ContractHarness {
  name: "PostgreSQL" | "SQLite";
  repos: Repositories;
  createFixture(): Promise<FixtureIds>;
  setOrderMeta(
    id: string,
    createdAt: Date,
    status: "PENDING_INTAKE" | "IN_PROGRESS" | "CANCELLED",
    deletedAt?: Date,
  ): Promise<void>;
  countItems(workOrderId: string): Promise<number>;
  cleanup(): Promise<void>;
}

interface ContractSnapshot {
  createKeys: string[];
  listKeys: string[];
  detailKeys: string[];
  sortedOrders: string[];
  filteredOrders: string[];
  latestSuffix: string;
  detailItemAmount: string;
  detailCustomer: string;
  detailVehicle: string;
  balance: { total: string; paid: string; unpaid: string };
  boundaryBalances: string[];
  itemTypeTotal: string;
  aggregatePartsCost: string;
  completedStatus: string;
  cascadeItemCount: number;
}

let passed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  assert.ok(condition, `${label}${detail ? `：${detail}` : ""}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function money(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(2);
}

function suffix(orderNo: string): string {
  return orderNo.slice(orderNo.lastIndexOf("-") + 1);
}

async function runContract(harness: ContractHarness, prefix: string): Promise<ContractSnapshot> {
  console.log(`\n【${harness.name} work-order contract】`);
  const { repos } = harness;
  const fixture = await harness.createFixture();
  const base = {
    customerId: fixture.customerId,
    vehicleId: fixture.vehicleId,
    createdBy: null,
    discountAmount: D("0"),
  };
  const rangeStart = new Date("2098-01-01T00:00:00.000Z");
  const rangeEnd = new Date("2098-01-03T00:00:00.000Z");

  try {
    const orderA = await repos.workOrder.create({
      ...base,
      orderNo: `${prefix}-A`,
      mileage: null,
      faultDescription: "异响",
      remark: null,
      technicianId: null,
    });
    const orderB = await repos.workOrder.create({ ...base, orderNo: `${prefix}-B` });
    const orderC = await repos.workOrder.create({ ...base, orderNo: `${prefix}-C` });
    const deleted = await repos.workOrder.create({ ...base, orderNo: `${prefix}-DELETED` });

    await harness.setOrderMeta(orderA.id, new Date("2098-01-01T01:00:00.000Z"), "PENDING_INTAKE");
    await harness.setOrderMeta(orderB.id, new Date("2098-01-01T02:00:00.000Z"), "IN_PROGRESS");
    await harness.setOrderMeta(orderC.id, new Date("2098-01-01T03:00:00.000Z"), "CANCELLED");
    await harness.setOrderMeta(
      deleted.id,
      new Date("2098-01-01T04:00:00.000Z"),
      "PENDING_INTAKE",
      new Date("2098-01-01T05:00:00.000Z"),
    );

    const item = await repos.workOrderItem.create({
      workOrderId: orderA.id,
      type: "SERVICE",
      itemRefId: null,
      name: "合同测试项目",
      spec: null,
      unit: "项",
      quantity: D("1.10"),
      unitPrice: D("10.50"),
      costPrice: D("0.01"),
      amount: D("11.55"),
      remark: null,
      sortOrder: 0,
    });
    await repos.workOrder.applyTotals(orderA.id, {
      serviceAmount: D("99.99"),
      partsAmount: D("0"),
      laborAmount: D("0"),
      otherAmount: D("0"),
      discountAmount: D("0"),
      totalAmount: D("99.99"),
      partsCost: D("0.01"),
    });
    await repos.workOrder.setPaidAmount(orderA.id, D("10.50"));

    check(`${harness.name} 创建返回非空 ID`, orderA.id.length > 0 && item.id.length > 0);
    check(`${harness.name} 创建默认状态`, orderA.status === "PENDING_INTAKE");
    check(
      `${harness.name} 创建字段/nullable/Decimal/Date`,
      orderA.customerId === fixture.customerId &&
        orderA.vehicleId === fixture.vehicleId &&
        orderA.mileage === null &&
        orderA.remark === null &&
        money(orderA.discountAmount) === "0.00" &&
        orderA.createdAt instanceof Date,
    );

    const page = await repos.workOrder.list(
      { keyword: prefix, customerId: fixture.customerId },
      { skip: 1, take: 1 },
    );
    check(`${harness.name} 分页与总数`, page.total === 3 && page.rows.length === 1);
    check(`${harness.name} createdAt 倒序`, suffix(page.rows[0]!.orderNo) === "B");
    check(
      `${harness.name} 客户/车辆联表与 item 数量`,
      page.rows[0]!.customer.name === "仓储契约客户" &&
        page.rows[0]!.vehicle.plateNumber === "粤CT2098" &&
        page.rows[0]!._count.items === 0,
    );
    const all = await repos.workOrder.list(
      { keyword: prefix, customerId: fixture.customerId },
      { skip: 0, take: 20 },
    );
    check(`${harness.name} deletedAt 行被排除`, !all.rows.some((row) => row.id === deleted.id));
    const filtered = await repos.workOrder.list(
      { keyword: prefix, status: "IN_PROGRESS" },
      { skip: 0, take: 20 },
    );
    check(
      `${harness.name} 状态筛选`,
      filtered.total === 1 && suffix(filtered.rows[0]!.orderNo) === "B",
    );

    const detail = await repos.workOrder.findDetailById(orderA.id);
    check(`${harness.name} 详情存在`, detail !== null);
    check(
      `${harness.name} 详情四表联查`,
      detail?.customer.name === "仓储契约客户" &&
        detail.vehicle.plateNumber === "粤CT2098" &&
        detail.items.length === 1 &&
        detail.items[0]!.id === item.id,
    );
    check(
      `${harness.name} 详情金额/日期/nullable`,
      money(detail!.totalAmount) === "99.99" &&
        money(detail!.items[0]!.amount) === "11.55" &&
        detail!.completedAt === null &&
        detail!.createdAt instanceof Date,
    );

    const balance = await repos.workOrder.findBalance(orderA.id);
    const unpaid = balance!.totalAmount.minus(balance!.paidAmount);
    check(
      `${harness.name} total/paid/unpaid Decimal`,
      money(balance!.totalAmount) === "99.99" &&
        money(balance!.paidAmount) === "10.50" &&
        money(unpaid) === "89.49",
    );

    const boundaryValues = ["0", "0.01", "1.10", "10.50", "99.99", "99999999.99"];
    const boundaryBalances: string[] = [];
    for (const [index, value] of boundaryValues.entries()) {
      const boundary = await repos.workOrder.create({
        ...base,
        orderNo: `${prefix}-M${index}`,
      });
      await harness.setOrderMeta(
        boundary.id,
        new Date(`2098-01-02T${String(index).padStart(2, "0")}:00:00.000Z`),
        "PENDING_INTAKE",
      );
      await repos.workOrder.applyTotals(boundary.id, {
        serviceAmount: D(value),
        partsAmount: D("0"),
        laborAmount: D("0"),
        otherAmount: D("0"),
        discountAmount: D("0"),
        totalAmount: D(value),
        partsCost: D("0"),
      });
      const paid = value === "0" ? "0" : "0.01";
      await repos.workOrder.setPaidAmount(boundary.id, D(paid));
      const result = await repos.workOrder.findBalance(boundary.id);
      boundaryBalances.push(
        `${money(result!.totalAmount)}/${money(result!.paidAmount)}/${money(result!.totalAmount.minus(result!.paidAmount))}`,
      );
    }
    check(
      `${harness.name} 六组金额边界精确`,
      boundaryBalances.join(",") ===
        "0.00/0.00/0.00,0.01/0.01/0.00,1.10/0.01/1.09,10.50/0.01/10.49,99.99/0.01/99.98,99999999.99/0.01/99999999.98",
    );

    check("ADR-012 待质检 → 已完成仍合法", canTransition("PENDING_QC", "COMPLETED"));
    await repos.workOrder.changeStatus(orderA.id, { status: "PENDING_QC" });
    await repos.workOrder.changeStatus(orderA.id, {
      status: "COMPLETED",
      completedAt: new Date("2098-01-02T12:00:00.000Z"),
    });
    const completed = await repos.workOrder.findForMutation(orderA.id);
    check(`${harness.name} 状态写入不额外收紧`, completed?.status === "COMPLETED");

    const byType = await repos.workOrderItem.sumAmountByType(rangeStart, rangeEnd);
    const serviceTotal = byType.find((row) => row.type === "SERVICE")?.amount;
    check(`${harness.name} 工单项精确聚合`, money(serviceTotal!) === "11.55");
    const aggregate = await repos.workOrder.aggregateCreatedOrders(rangeStart, rangeEnd);
    check(
      `${harness.name} 工单精确聚合`,
      aggregate.orderCount === 8 && money(aggregate.partsCost!) === "0.01",
      `count=${aggregate.orderCount}, partsCost=${aggregate.partsCost?.toString()}`,
    );

    const deleteOrder = await repos.workOrder.create({ ...base, orderNo: `${prefix}-HARDDELETE` });
    await repos.workOrderItem.create({
      workOrderId: deleteOrder.id,
      type: "OTHER",
      name: "待级联删除",
      quantity: D("1"),
      unitPrice: D("1"),
      costPrice: D("0"),
      amount: D("1"),
      sortOrder: 0,
    });
    await repos.workOrder.hardDelete(deleteOrder.id);
    const cascadeItemCount = await harness.countItems(deleteOrder.id);
    check(
      `${harness.name} 管理员误建单硬删除由数据库级联工单项`,
      (await repos.workOrder.findDetailById(deleteOrder.id)) === null && cascadeItemCount === 0,
    );

    const latest = await repos.workOrder.findLatestOrderNo(prefix);
    return {
      createKeys: Object.keys(orderA).sort(),
      listKeys: Object.keys(all.rows[0]!).sort(),
      detailKeys: Object.keys(detail!).sort(),
      sortedOrders: all.rows.map((row) => suffix(row.orderNo)),
      filteredOrders: filtered.rows.map((row) => suffix(row.orderNo)),
      latestSuffix: suffix(latest!),
      detailItemAmount: money(detail!.items[0]!.amount),
      detailCustomer: detail!.customer.name,
      detailVehicle: detail!.vehicle.plateNumber,
      balance: {
        total: money(balance!.totalAmount),
        paid: money(balance!.paidAmount),
        unpaid: money(unpaid),
      },
      boundaryBalances,
      itemTypeTotal: money(serviceTotal!),
      aggregatePartsCost: money(aggregate.partsCost!),
      completedStatus: completed!.status,
      cascadeItemCount,
    };
  } finally {
    await harness.cleanup();
  }
}

function createSqliteHarness(): ContractHarness {
  const db = createMemoryDb();
  const repos = createSqliteRepositories(db);
  let fixture: FixtureIds | null = null;
  const execute = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);
  return {
    name: "SQLite",
    repos,
    async createFixture() {
      const now = new Date().toISOString();
      fixture = { customerId: newId(), vehicleId: newId() };
      execute(
        "INSERT INTO customers (id,name,phone,wechat,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        fixture.customerId,
        "仓储契约客户",
        "13920980000",
        null,
        now,
        now,
      );
      execute(
        "INSERT INTO vehicles (id,customer_id,plate_number,brand,model,year,vin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        fixture.vehicleId,
        fixture.customerId,
        "粤CT2098",
        "测试品牌",
        "测试车型",
        2098,
        null,
        now,
        now,
      );
      return fixture;
    },
    async setOrderMeta(id, createdAt, status, deletedAt) {
      execute(
        "UPDATE work_orders SET created_at=?,updated_at=?,status=?,deleted_at=? WHERE id=?",
        createdAt.toISOString(),
        createdAt.toISOString(),
        status,
        deletedAt?.toISOString() ?? null,
        id,
      );
    },
    async countItems(workOrderId) {
      return Number(
        (
          db
            .prepare("SELECT COUNT(*) count FROM work_order_items WHERE work_order_id=?")
            .get(workOrderId) as { count: number }
        ).count,
      );
    },
    async cleanup() {
      db.close();
    },
  };
}

function createPostgresHarness(prefix: string): ContractHarness {
  const repos = createRepositories(prisma);
  let fixture: FixtureIds | null = null;
  return {
    name: "PostgreSQL",
    repos,
    async createFixture() {
      const customer = await prisma.customer.create({
        data: { name: "仓储契约客户", phone: "13920980000" },
      });
      const vehicle = await prisma.vehicle.create({
        data: {
          customerId: customer.id,
          plateNumber: "粤CT2098",
          brand: "测试品牌",
          model: "测试车型",
          year: 2098,
          vin: null,
        },
      });
      fixture = { customerId: customer.id, vehicleId: vehicle.id };
      return fixture;
    },
    async setOrderMeta(id, createdAt, status, deletedAt) {
      await prisma.workOrder.update({
        where: { id },
        data: { createdAt, updatedAt: createdAt, status, deletedAt: deletedAt ?? null },
      });
    },
    async countItems(workOrderId) {
      return prisma.workOrderItem.count({ where: { workOrderId } });
    },
    async cleanup() {
      await prisma.workOrder.deleteMany({ where: { orderNo: { startsWith: prefix } } });
      if (fixture) {
        await prisma.vehicle.deleteMany({ where: { id: fixture.vehicleId } });
        await prisma.customer.deleteMany({ where: { id: fixture.customerId } });
      }
    },
  };
}

async function main(): Promise<void> {
  const prefix = `CT${Date.now()}`;
  const sqlite = await runContract(createSqliteHarness(), prefix);
  const postgres = await runContract(createPostgresHarness(prefix), prefix);
  assert.deepEqual(postgres, sqlite, "PostgreSQL 与 SQLite work-order contract 结果不一致");
  passed += 1;
  console.log("\n  ✓ PostgreSQL / SQLite 语义快照完全一致");
  console.log(`\nwork-order Repository contract：通过 ${passed} 项，失败 0 项`);
}

main()
  .catch((error) => {
    console.error("\nwork-order Repository contract 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
