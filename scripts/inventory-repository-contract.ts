import assert from "node:assert/strict";
import type { SQLInputValue } from "node:sqlite";

import type { Repositories } from "@/domain/repositories";
import { D } from "@/lib/money";
import { prisma } from "@/server/db";
import { createRepositories } from "@/server/repos/prisma";
import { createMemoryDb } from "@/server/repos/sqlite/client";
import { createSqliteRepositories } from "@/server/repos/sqlite/factory";
import { runInTransaction } from "@/server/repos/sqlite/transaction";
import { newId } from "@/server/repos/sqlite/id";
import { applyStockChange } from "@/server/services/inventory-core.service";

interface Harness {
  name: "PostgreSQL" | "SQLite";
  repos: Repositories;
  transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
  createPart(code: string, safe: string, cost: string): Promise<string>;
  createOrder(orderNo: string): Promise<string>;
  cleanup(): Promise<void>;
}

interface Snapshot {
  quantity: string;
  avgCost: string;
  transactionTypes: string[];
  filteredCount: number;
  detached: boolean;
  valuation: { quantity: string; avgCost: string };
  concurrent: { succeeded: number; failed: number; finalQuantity: string };
  rollback: { quantity: string; transactionCount: number };
}

let passed = 0;
function check(label: string, condition: unknown): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function runContract(harness: Harness, prefix: string): Promise<Snapshot> {
  const { repos } = harness;
  const partId = await harness.createPart(`${prefix}-INV-A`, "2.00", "10.50");
  const orderId = await harness.createOrder(`${prefix}-ORDER`);

  const initial = await harness.transaction((tx) =>
    applyStockChange(tx, {
      partId,
      type: "PURCHASE_IN",
      deltaQuantity: "2.00",
      unitCost: "10.50",
      remark: "初始入库",
    }),
  );
  check(
    `${harness.name} 入库原子写库存+流水`,
    initial.qtyBefore === "0.00" && initial.qtyAfter === "2.00" && initial.avgCost === "10.50",
  );

  const second = await harness.transaction((tx) =>
    applyStockChange(tx, {
      partId,
      type: "PURCHASE_IN",
      deltaQuantity: "1.00",
      unitCost: "20.00",
    }),
  );
  check(
    `${harness.name} 移动加权平均成本`,
    second.qtyAfter === "3.00" && second.avgCost === "13.67",
  );

  const out = await harness.transaction((tx) =>
    applyStockChange(tx, {
      partId,
      type: "WORKORDER_OUT",
      deltaQuantity: "-0.50",
      workOrderId: orderId,
    }),
  );
  check(`${harness.name} 小数出库/Date/Decimal`, out.qtyAfter === "2.50");

  const listed = await repos.inventory.listTransactions({ partId }, { skip: 0, take: 2 });
  check(
    `${harness.name} 流水分页/倒序/nullable 关系`,
    listed.total === 3 &&
      listed.rows.length === 2 &&
      listed.rows[0]?.createdAt instanceof Date &&
      listed.rows[0]?.operator === null,
  );
  check(
    `${harness.name} 流水类型过滤`,
    (await repos.inventory.listTransactions({ partId, type: "PURCHASE_IN" }, { skip: 0, take: 10 }))
      .total === 2,
  );

  const insufficientBefore = await harness.transaction((tx) => tx.inventory.lockOrCreate(partId));
  await assert.rejects(
    harness.transaction((tx) =>
      applyStockChange(tx, { partId, type: "WORKORDER_OUT", deltaQuantity: "-99.99" }),
    ),
    /库存不足|不足|negative|BusinessRule/i,
  );
  const insufficientAfter = await harness.transaction((tx) => tx.inventory.lockOrCreate(partId));
  check(
    `${harness.name} 库存不足不改变库存/流水`,
    insufficientBefore.quantity.eq(insufficientAfter.quantity) &&
      (await repos.inventory.listTransactions({ partId }, { skip: 0, take: 20 })).total === 3,
  );

  const beforeRollback = await harness.transaction((tx) => tx.inventory.lockOrCreate(partId));
  const beforeCount = (await repos.inventory.listTransactions({ partId }, { skip: 0, take: 50 }))
    .total;
  await assert.rejects(
    harness.transaction((tx) =>
      applyStockChange(tx, {
        partId,
        type: "WORKORDER_OUT",
        deltaQuantity: "-1.00",
        workOrderId: "missing-work-order",
      }),
    ),
  );
  const afterRollback = await harness.transaction((tx) => tx.inventory.lockOrCreate(partId));
  check(
    `${harness.name} 流水写入失败整体 rollback`,
    beforeRollback.quantity.eq(afterRollback.quantity) &&
      (await repos.inventory.listTransactions({ partId }, { skip: 0, take: 50 })).total ===
        beforeCount,
  );

  const beforeReverseCount = (
    await repos.inventory.listTransactions({ partId }, { skip: 0, take: 50 })
  ).total;
  await assert.rejects(
    harness.transaction(async (tx) => {
      await tx.inventory.appendTransaction({
        partId,
        type: "ADJUST",
        quantity: D("1"),
        qtyBefore: D("2.5"),
        qtyAfter: D("3.5"),
      });
      await tx.inventory.applyChange("missing-inventory", { quantity: D("1"), avgCost: D("1") });
    }),
  );
  check(
    `${harness.name} 库存写入失败 rollback 已写流水`,
    (await repos.inventory.listTransactions({ partId }, { skip: 0, take: 50 })).total ===
      beforeReverseCount,
  );

  const concurrentPartId = await harness.createPart(`${prefix}-INV-CONCURRENT`, "0", "1.00");
  await harness.transaction((tx) =>
    applyStockChange(tx, {
      partId: concurrentPartId,
      type: "PURCHASE_IN",
      deltaQuantity: "1.00",
      unitCost: "1.00",
    }).then(() => undefined),
  );
  const attempts = await Promise.allSettled([
    harness.transaction((tx) =>
      applyStockChange(tx, {
        partId: concurrentPartId,
        type: "WORKORDER_OUT",
        deltaQuantity: "-1.00",
      }),
    ),
    harness.transaction((tx) =>
      applyStockChange(tx, {
        partId: concurrentPartId,
        type: "WORKORDER_OUT",
        deltaQuantity: "-1.00",
      }),
    ),
  ]);
  const succeeded = attempts.filter((result) => result.status === "fulfilled").length;
  const failed = attempts.filter((result) => result.status === "rejected").length;
  const concurrentFinal = await harness.transaction((tx) =>
    tx.inventory.lockOrCreate(concurrentPartId),
  );
  check(
    `${harness.name} BEGIN IMMEDIATE/并发扣减不会超卖`,
    succeeded === 1 && failed === 1 && concurrentFinal.quantity.isZero(),
  );

  await harness.transaction((tx) =>
    applyStockChange(tx, { partId, type: "ADJUST", deltaQuantity: "-0.25" }).then(() => undefined),
  );
  const changed = await harness.transaction((tx) => tx.inventory.lockOrCreate(partId));
  check(
    `${harness.name} 调整数量与流水一致`,
    changed.quantity.toFixed(2) === "2.25" &&
      (await repos.inventory.listTransactions({ partId, type: "ADJUST" }, { skip: 0, take: 10 }))
        .total === 1,
  );

  const txBeforeDetach = await repos.inventory.listTransactions({ partId }, { skip: 0, take: 20 });
  check(
    `${harness.name} 工单关联可读`,
    txBeforeDetach.rows.some(
      (row) => row.workOrderId === orderId && row.workOrder?.orderNo === `${prefix}-ORDER`,
    ),
  );
  await repos.inventory.detachWorkOrder(orderId);
  const txAfterDetach = await repos.inventory.listTransactions({ partId }, { skip: 0, take: 20 });
  check(
    `${harness.name} detachWorkOrder 保留流水并解除引用`,
    txAfterDetach.rows.some((row) => row.workOrderId === null),
  );

  const valuation = await repos.inventory.listValuationLines();
  const partLine = valuation.find((row) => row.quantity.eq(D("2.25")));
  check(
    `${harness.name} valuation Decimal 原始值`,
    partLine?.avgCost.eq(D("13.67")) && partLine.partCostPrice.eq(D("10.50")),
  );

  const finalRows = await repos.inventory.listTransactions({ partId }, { skip: 0, take: 50 });
  return {
    quantity: changed.quantity.toFixed(2),
    avgCost: changed.avgCost.toFixed(2),
    transactionTypes: finalRows.rows.map((row) => row.type),
    filteredCount: listed.total,
    detached: txAfterDetach.rows.some((row) => row.workOrderId === null),
    valuation: {
      quantity: partLine?.quantity.toFixed(2) ?? "",
      avgCost: partLine?.avgCost.toFixed(2) ?? "",
    },
    concurrent: { succeeded, failed, finalQuantity: concurrentFinal.quantity.toFixed(2) },
    rollback: { quantity: afterRollback.quantity.toFixed(2), transactionCount: beforeCount },
  };
}

function createSqliteHarness(): Harness {
  const db = createMemoryDb();
  const repos = createSqliteRepositories(db);
  const execute = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);
  return {
    name: "SQLite",
    repos,
    transaction: (fn) => runInTransaction(db, () => fn(repos)),
    async createPart(code, safe, cost) {
      const row = await repos.part.createWithInventory(
        {
          code,
          name: code,
          spec: null,
          brand: null,
          unit: "件",
          categoryId: null,
          supplierId: null,
          costPrice: D(cost),
          salePrice: D(cost),
          remark: null,
        },
        { safeQuantity: D(safe), location: null },
      );
      return row.id;
    },
    async createOrder(orderNo) {
      const customerId = newId();
      const vehicleId = newId();
      const orderId = newId();
      const now = new Date().toISOString();
      execute(
        "INSERT INTO customers (id,name,phone,created_at,updated_at) VALUES (?,?,?,?,?)",
        customerId,
        orderNo,
        orderNo,
        now,
        now,
      );
      execute(
        "INSERT INTO vehicles (id,customer_id,plate_number,created_at,updated_at) VALUES (?,?,?,?,?)",
        vehicleId,
        customerId,
        `${orderNo}-PLATE`,
        now,
        now,
      );
      execute(
        "INSERT INTO work_orders (id,order_no,status,customer_id,vehicle_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        orderId,
        orderNo,
        "PENDING_INTAKE",
        customerId,
        vehicleId,
        now,
        now,
      );
      return orderId;
    },
    async cleanup() {
      db.close();
    },
  };
}

function createPostgresHarness(_prefix: string): Harness {
  const repos = createRepositories(prisma);
  const partIds: string[] = [];
  const orderIds: string[] = [];
  const customerIds: string[] = [];
  return {
    name: "PostgreSQL",
    repos,
    transaction: (fn) => prisma.$transaction((tx) => fn(createRepositories(tx))),
    async createPart(code, safe, cost) {
      const row = await repos.part.createWithInventory(
        {
          code,
          name: code,
          spec: null,
          brand: null,
          unit: "件",
          categoryId: null,
          supplierId: null,
          costPrice: D(cost),
          salePrice: D(cost),
          remark: null,
        },
        { safeQuantity: D(safe), location: null },
      );
      partIds.push(row.id);
      return row.id;
    },
    async createOrder(orderNo) {
      const customer = await prisma.customer.create({ data: { name: orderNo, phone: orderNo } });
      customerIds.push(customer.id);
      const vehicle = await prisma.vehicle.create({
        data: { customerId: customer.id, plateNumber: `${orderNo}-PLATE` },
      });
      const order = await prisma.workOrder.create({
        data: { orderNo, customerId: customer.id, vehicleId: vehicle.id },
      });
      orderIds.push(order.id);
      return order.id;
    },
    async cleanup() {
      if (partIds.length)
        await prisma.inventoryTransaction.deleteMany({ where: { partId: { in: partIds } } });
      if (partIds.length) await prisma.part.deleteMany({ where: { id: { in: partIds } } });
      if (orderIds.length) await prisma.workOrder.deleteMany({ where: { id: { in: orderIds } } });
      if (customerIds.length) {
        const vehicles = await prisma.vehicle.findMany({
          where: { customerId: { in: customerIds } },
          select: { id: true },
        });
        if (vehicles.length)
          await prisma.vehicle.deleteMany({ where: { id: { in: vehicles.map((row) => row.id) } } });
        await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      }
    },
  };
}

async function main(): Promise<void> {
  const prefix = `INV${Date.now()}`;
  const target = process.env.CONTRACT_BACKEND;
  let sqlite: Snapshot | undefined;
  let postgres: Snapshot | undefined;
  if (target !== "postgres") {
    const harness = createSqliteHarness();
    try {
      sqlite = await runContract(harness, prefix);
    } finally {
      await harness.cleanup();
    }
  }
  if (target !== "sqlite") {
    const harness = createPostgresHarness(prefix);
    try {
      postgres = await runContract(harness, prefix);
    } finally {
      await harness.cleanup();
    }
  }
  if (sqlite && postgres) {
    console.log("\nPostgreSQL Inventory snapshot:", JSON.stringify(postgres, null, 2));
    console.log("SQLite Inventory snapshot:", JSON.stringify(sqlite, null, 2));
    assert.deepEqual(postgres, sqlite, "PostgreSQL 与 SQLite Inventory contract 结果不一致");
    passed += 1;
    console.log("  ✓ PostgreSQL / SQLite Inventory 语义快照完全一致");
  }
  console.log(`\ninventory Repository contract：通过 ${passed} 项，失败 0 项`);
}

main()
  .catch((error) => {
    console.error("\ninventory Repository contract 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
