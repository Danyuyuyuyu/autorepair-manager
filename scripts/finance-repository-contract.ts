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

interface Harness {
  name: "PostgreSQL" | "SQLite";
  repos: Repositories;
  transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
  createSupplier(name: string): Promise<string>;
  createOrder(orderNo: string, customerName: string): Promise<{ id: string; customerId: string }>;
  cleanup(year: number): Promise<void>;
}

interface FinanceSnapshot {
  paymentRows: Array<{
    amount: string;
    method: string;
    category: string;
    source: string;
    occurredAt: string;
    remark: string | null;
    orderNo: string | null;
  }>;
  expenseRows: Array<{
    amount: string;
    category: string;
    method: string;
    occurredAt: string;
    remark: string | null;
    supplier: string | null;
  }>;
  sums: { orderOne: string; orderTwo: string; income: string; expense: string };
  paymentGroups: {
    category: Array<{ key: string; amount: string; count: number }>;
    method: Array<{ key: string; amount: string; count: number }>;
  };
  expenseGroups: Array<{ key: string; amount: string; count: number }>;
  rangeCounts: {
    january: number;
    february: number;
    activePayments: number;
    activeExpenses: number;
  };
  entries: { payments: number; expenses: number; firstPayment: string; firstExpense: string };
}

let passed = 0;
function check(label: string, condition: unknown): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function sortedGroups(
  groups: Array<{ category: string; amount: ReturnType<typeof D> | null; count: number }>,
): Array<{ key: string; amount: string; count: number }> {
  return groups
    .map((group) => ({
      key: group.category,
      amount: (group.amount ?? D(0)).toFixed(2),
      count: group.count,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function sortedMethods(
  groups: Array<{ method: string; amount: ReturnType<typeof D> | null; count: number }>,
): Array<{ key: string; amount: string; count: number }> {
  return groups
    .map((group) => ({
      key: group.method,
      amount: (group.amount ?? D(0)).toFixed(2),
      count: group.count,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

async function runContract(
  harness: Harness,
  prefix: string,
  year: number,
): Promise<FinanceSnapshot> {
  const { repos } = harness;
  const supplierId = await harness.createSupplier(`${prefix}-supplier`);
  const orderOne = await harness.createOrder(`${prefix}-ORDER-1`, `${prefix}-customer-one`);
  const orderTwo = await harness.createOrder(`${prefix}-ORDER-2`, `${prefix}-customer-two`);
  const januaryStart = new Date(`${year}-01-01T00:00:00.000Z`);
  const januaryEnd = new Date(`${year}-01-31T23:59:59.999Z`);
  const februaryStart = new Date(`${year}-02-01T00:00:00.000Z`);
  const februaryEnd = new Date(`${year}-02-28T23:59:59.999Z`);
  const allFrom = januaryStart;
  const allTo = februaryEnd;

  await repos.finance.createPayment({
    workOrderId: orderOne.id,
    customerId: orderOne.customerId,
    source: "WORK_ORDER",
    category: "OTHER",
    amount: D("0"),
    method: "CASH",
    occurredAt: januaryStart,
    operatorId: null,
    remark: null,
  });
  await repos.finance.createPayment({
    workOrderId: orderOne.id,
    customerId: orderOne.customerId,
    source: "WORK_ORDER",
    category: "REPAIR_SERVICE",
    amount: D("0.01"),
    method: "WECHAT",
    occurredAt: januaryStart,
    operatorId: null,
    remark: "首笔收款",
  });
  const paymentJanuaryEnd = await repos.finance.createPayment({
    workOrderId: orderOne.id,
    customerId: orderOne.customerId,
    source: "WORK_ORDER",
    category: "REPAIR_SERVICE",
    amount: D("1.10"),
    method: "WECHAT",
    occurredAt: januaryEnd,
    operatorId: null,
    remark: "一月末收款",
  });
  await repos.finance.createPayment({
    workOrderId: orderTwo.id,
    customerId: orderTwo.customerId,
    source: "WORK_ORDER",
    category: "LABOR",
    amount: D("10.50"),
    method: "ALIPAY",
    occurredAt: februaryStart,
    operatorId: null,
    remark: "二月初收款",
  });
  await repos.finance.createPayment({
    customerId: orderTwo.customerId,
    source: "MANUAL",
    category: "PART_SALE",
    amount: D("99999999.99"),
    method: "BANK_CARD",
    occurredAt: februaryEnd,
    operatorId: null,
    remark: "手工收入",
  });

  const expenseSmall = await repos.finance.createExpense({
    category: "PART_PURCHASE",
    amount: D("0.01"),
    method: "CASH",
    occurredAt: januaryStart,
    supplierId,
    workOrderId: null,
    operatorId: null,
    remark: "采购备注保留",
  });
  const expenseUpdate = await repos.finance.createExpense({
    category: "RENT",
    amount: D("1.10"),
    method: "CASH",
    occurredAt: januaryEnd,
    supplierId: null,
    workOrderId: orderOne.id,
    operatorId: null,
    remark: "待修改支出",
  });
  const expenseDelete = await repos.finance.createExpense({
    category: "UTILITY",
    amount: D("10.50"),
    method: "ALIPAY",
    occurredAt: februaryStart,
    supplierId,
    workOrderId: null,
    operatorId: null,
    remark: "待删除支出",
  });
  await repos.finance.createExpense({
    category: "OTHER",
    amount: D("99999999.99"),
    method: "BANK_CARD",
    occurredAt: februaryEnd,
    supplierId: null,
    workOrderId: null,
    operatorId: null,
    remark: "大额支出",
  });

  const januaryPayments = await repos.finance.listPayments(
    { from: januaryStart, to: januaryEnd },
    { skip: 0, take: 20 },
  );
  const februaryPayments = await repos.finance.listPayments(
    { from: februaryStart, to: februaryEnd },
    { skip: 0, take: 20 },
  );
  check(
    `${harness.name} Payment 日期边界/月初月末`,
    januaryPayments.total === 3 &&
      februaryPayments.total === 2 &&
      januaryPayments.rows[0]?.occurredAt.toISOString() === januaryEnd.toISOString(),
  );
  check(
    `${harness.name} Payment 分页/排序/nullable`,
    (await repos.finance.listPayments({ from: allFrom, to: allTo }, { skip: 0, take: 2 })).rows
      .length === 2 &&
      (await repos.finance.listPayments({ from: allFrom, to: allTo }, { skip: 0, take: 2 }))
        .total === 5 &&
      januaryPayments.rows.some((row) => row.operator === null && row.remark === null),
  );
  check(
    `${harness.name} Payment 关键字绑定与关联工单`,
    (
      await repos.finance.listPayments(
        { from: allFrom, to: allTo, keyword: `${prefix}-ORDER-1` },
        { skip: 0, take: 20 },
      )
    ).total === 3 &&
      (
        await repos.finance.listPayments(
          { from: allFrom, to: allTo, keyword: `${prefix}-customer-two` },
          { skip: 0, take: 20 },
        )
      ).total === 2 &&
      (
        await repos.finance.listPayments(
          { from: allFrom, to: allTo, keyword: "采购%' OR 1=1 --" },
          { skip: 0, take: 20 },
        )
      ).total === 0,
  );
  check(
    `${harness.name} Payment 关联 row shape`,
    januaryPayments.rows.some(
      (row) => row.workOrderId === orderOne.id && row.workOrder?.orderNo === `${prefix}-ORDER-1`,
    ),
  );

  check(
    `${harness.name} Payment 聚合 Decimal/分类/支付方式`,
    (await repos.finance.sumPaymentsByWorkOrder(orderOne.id)).toFixed(2) === "1.11" &&
      (await repos.finance.sumPaymentsByWorkOrder(orderTwo.id)).toFixed(2) === "10.50" &&
      sortedGroups(await repos.finance.groupPaymentsByCategory(allFrom, allTo)).some(
        (row) => row.key === "REPAIR_SERVICE" && row.amount === "1.11" && row.count === 2,
      ) &&
      sortedMethods(await repos.finance.groupPaymentsByMethod(allFrom, allTo)).some(
        (row) => row.key === "WECHAT" && row.amount === "1.11" && row.count === 2,
      ),
  );

  check(
    `${harness.name} Expense 创建/采购备注/供应商关键字`,
    (await repos.finance.findExpenseForEdit(expenseSmall.id))?.remark === "采购备注保留" &&
      (
        await repos.finance.listExpenses(
          { from: allFrom, to: allTo, keyword: `${prefix}-supplier` },
          { skip: 0, take: 20 },
        )
      ).total === 2,
  );
  await repos.finance.updateExpense(expenseUpdate.id, {
    category: "UTILITY",
    amount: D("10.50"),
    method: "WECHAT",
    occurredAt: januaryEnd,
    supplierId,
    workOrderId: orderOne.id,
    remark: "修改后的支出备注",
  });
  const updatedExpense = await repos.finance.findExpenseForEdit(expenseUpdate.id);
  check(
    `${harness.name} Expense update 与 nullable/Date/Decimal`,
    updatedExpense?.amount.toFixed(2) === "10.50" &&
      updatedExpense.method === "WECHAT" &&
      updatedExpense.remark === "修改后的支出备注" &&
      updatedExpense.occurredAt.toISOString() === januaryEnd.toISOString(),
  );
  check(
    `${harness.name} Expense 列表分页/排序/关联`,
    (await repos.finance.listExpenses({ from: allFrom, to: allTo }, { skip: 0, take: 2 })).total ===
      4 &&
      (await repos.finance.listExpenses({ from: allFrom, to: allTo }, { skip: 0, take: 2 })).rows
        .length === 2 &&
      (
        await repos.finance.listExpenses({ from: allFrom, to: allTo }, { skip: 0, take: 20 })
      ).rows.some(
        (row) => row.supplier?.name === `${prefix}-supplier` && row.remark === "采购备注保留",
      ),
  );
  check(
    `${harness.name} Expense group before delete`,
    sortedGroups(await repos.finance.groupExpensesByCategory(allFrom, allTo)).some(
      (row) => row.key === "UTILITY" && row.amount === "21.00" && row.count === 2,
    ),
  );

  check(
    `${harness.name} Payment/Expense 区间合计与明细 Date`,
    (await repos.finance.sumPaymentsInRange(allFrom, allTo)).toFixed(2) === "100000011.60" &&
      (await repos.finance.sumExpensesInRange(allFrom, allTo)).toFixed(2) === "100000021.00" &&
      (await repos.finance.listPaymentEntries(allFrom, allTo)).every(
        (row) => row.occurredAt instanceof Date,
      ) &&
      (await repos.finance.listExpenseEntries(allFrom, allTo)).every(
        (row) => row.occurredAt instanceof Date,
      ),
  );

  const paymentForVoid = await repos.finance.findPaymentForVoid(paymentJanuaryEnd.id);
  check(
    `${harness.name} findPaymentForVoid`,
    paymentForVoid?.amount.toFixed(2) === "1.10" && paymentForVoid.workOrderId === orderOne.id,
  );
  await repos.finance.voidPayment(paymentJanuaryEnd.id, "管理员作废");
  check(
    `${harness.name} Payment 软删除后已付金额重算`,
    (await repos.finance.findPaymentForVoid(paymentJanuaryEnd.id)) === null &&
      (await repos.finance.sumPaymentsByWorkOrder(orderOne.id)).toFixed(2) === "0.01",
  );
  check(
    `${harness.name} 工单取消批量作废收款`,
    (await repos.finance.voidPaymentsByWorkOrder(orderTwo.id, "工单取消")) === 1 &&
      (await repos.finance.sumPaymentsByWorkOrder(orderTwo.id)).isZero(),
  );

  const deleteView = await repos.finance.findExpenseForDelete(expenseDelete.id);
  check(
    `${harness.name} findExpenseForDelete`,
    deleteView?.amount.toFixed(2) === "10.50" && deleteView.remark === "待删除支出",
  );
  await repos.finance.softDeleteExpense(expenseDelete.id);
  check(
    `${harness.name} Expense 软删除保留历史且排除统计`,
    (await repos.finance.findExpenseForDelete(expenseDelete.id)) === null &&
      (await repos.finance.listExpenses({ from: allFrom, to: allTo }, { skip: 0, take: 20 }))
        .total === 3,
  );

  const paymentGroups = sortedGroups(await repos.finance.groupPaymentsByCategory(allFrom, allTo));
  const methodGroups = sortedMethods(await repos.finance.groupPaymentsByMethod(allFrom, allTo));
  const expenseGroups = sortedGroups(await repos.finance.groupExpensesByCategory(allFrom, allTo));
  const paymentRows = (
    await repos.finance.listPayments({ from: allFrom, to: allTo }, { skip: 0, take: 20 })
  ).rows;
  const expenseRows = (
    await repos.finance.listExpenses({ from: allFrom, to: allTo }, { skip: 0, take: 20 })
  ).rows;
  return {
    paymentRows: paymentRows.map((row) => ({
      amount: row.amount.toFixed(2),
      method: row.method,
      category: row.category,
      source: row.source,
      occurredAt: row.occurredAt.toISOString(),
      remark: row.remark,
      orderNo: row.workOrder?.orderNo ?? null,
    })),
    expenseRows: expenseRows.map((row) => ({
      amount: row.amount.toFixed(2),
      category: row.category,
      method: row.method,
      occurredAt: row.occurredAt.toISOString(),
      remark: row.remark,
      supplier: row.supplier?.name ?? null,
    })),
    sums: {
      orderOne: (await repos.finance.sumPaymentsByWorkOrder(orderOne.id)).toFixed(2),
      orderTwo: (await repos.finance.sumPaymentsByWorkOrder(orderTwo.id)).toFixed(2),
      income: (await repos.finance.sumPaymentsInRange(allFrom, allTo)).toFixed(2),
      expense: (await repos.finance.sumExpensesInRange(allFrom, allTo)).toFixed(2),
    },
    paymentGroups: { category: paymentGroups, method: methodGroups },
    expenseGroups,
    rangeCounts: {
      january: januaryPayments.total,
      february: februaryPayments.total,
      activePayments: paymentRows.length,
      activeExpenses: expenseRows.length,
    },
    entries: {
      payments: (await repos.finance.listPaymentEntries(allFrom, allTo)).length,
      expenses: (await repos.finance.listExpenseEntries(allFrom, allTo)).length,
      firstPayment: paymentRows[0]?.occurredAt.toISOString() ?? "",
      firstExpense: expenseRows[0]?.occurredAt.toISOString() ?? "",
    },
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
    async createSupplier(name) {
      const id = newId();
      const now = new Date().toISOString();
      execute(
        "INSERT INTO suppliers (id,name,created_at,updated_at) VALUES (?,?,?,?)",
        id,
        name,
        now,
        now,
      );
      return id;
    },
    async createOrder(orderNo, customerName) {
      const customerId = newId();
      const vehicleId = newId();
      const orderId = newId();
      const now = new Date().toISOString();
      execute(
        "INSERT INTO customers (id,name,phone,created_at,updated_at) VALUES (?,?,?,?,?)",
        customerId,
        customerName,
        `${orderNo}-phone`,
        now,
        now,
      );
      execute(
        "INSERT INTO vehicles (id,customer_id,plate_number,created_at,updated_at) VALUES (?,?,?,?,?)",
        vehicleId,
        customerId,
        `${orderNo}-plate`,
        now,
        now,
      );
      execute(
        "INSERT INTO work_orders (id,order_no,status,customer_id,vehicle_id,total_amount,paid_amount,parts_cost,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        orderId,
        orderNo,
        "PENDING_INTAKE",
        customerId,
        vehicleId,
        "100.00",
        "0.00",
        "10.00",
        now,
        now,
      );
      return { id: orderId, customerId };
    },
    async cleanup() {
      db.close();
    },
  };
}

function createPostgresHarness(_prefix: string): Harness {
  const repos = createRepositories(prisma);
  const supplierIds: string[] = [];
  const customerIds: string[] = [];
  const orderIds: string[] = [];
  return {
    name: "PostgreSQL",
    repos,
    transaction: (fn) => prisma.$transaction((tx) => fn(createRepositories(tx))),
    async createSupplier(name) {
      const row = await prisma.supplier.create({ data: { name } });
      supplierIds.push(row.id);
      return row.id;
    },
    async createOrder(orderNo, customerName) {
      const customer = await prisma.customer.create({
        data: { name: customerName, phone: `${orderNo}-phone` },
      });
      customerIds.push(customer.id);
      const vehicle = await prisma.vehicle.create({
        data: { customerId: customer.id, plateNumber: `${orderNo}-plate` },
      });
      const order = await prisma.workOrder.create({
        data: {
          orderNo,
          status: "PENDING_INTAKE",
          customerId: customer.id,
          vehicleId: vehicle.id,
          totalAmount: D("100.00"),
          paidAmount: D("0.00"),
          partsCost: D("10.00"),
        },
      });
      orderIds.push(order.id);
      return { id: order.id, customerId: customer.id };
    },
    async cleanup(year) {
      // 本契约写入的是「该年份 1–2 月」的收款/支出，其中 workOrderId 为 null 的手工
      // 流水不在 orderIds 里 —— 只按工单 id 删会永久残留。残留年份一旦与新 run 的随机
      // 年份撞车，计数断言就会假红（Step 5 验收时实际发生过）。因此按年份窗口整体清理。
      const from = new Date(`${year}-01-01T00:00:00.000Z`);
      const to = new Date(`${year}-02-28T23:59:59.999Z`);
      await prisma.payment.deleteMany({ where: { occurredAt: { gte: from, lte: to } } });
      await prisma.expense.deleteMany({ where: { occurredAt: { gte: from, lte: to } } });
      if (orderIds.length)
        await prisma.payment.deleteMany({ where: { workOrderId: { in: orderIds } } });
      if (orderIds.length)
        await prisma.expense.deleteMany({ where: { workOrderId: { in: orderIds } } });
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
      if (supplierIds.length)
        await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    },
  };
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const prefix = `FIN${stamp}`;
  const year = 2200 + (stamp % 500);
  const target = process.env.CONTRACT_BACKEND;
  let sqlite: FinanceSnapshot | undefined;
  let postgres: FinanceSnapshot | undefined;
  if (target !== "postgres") {
    const harness = createSqliteHarness();
    try {
      sqlite = await runContract(harness, prefix, year);
    } finally {
      await harness.cleanup(year);
    }
  }
  if (target !== "sqlite") {
    const harness = createPostgresHarness(prefix);
    try {
      postgres = await runContract(harness, prefix, year);
    } finally {
      await harness.cleanup(year);
    }
  }
  if (sqlite && postgres) {
    console.log("\nPostgreSQL Finance snapshot:", JSON.stringify(postgres, null, 2));
    console.log("SQLite Finance snapshot:", JSON.stringify(sqlite, null, 2));
    assert.deepEqual(postgres, sqlite, "PostgreSQL 与 SQLite Finance contract 结果不一致");
    passed += 1;
    console.log("  ✓ PostgreSQL / SQLite Finance 语义快照完全一致");
  }
  console.log(`\nfinance Repository contract：通过 ${passed} 项，失败 0 项`);
}

main()
  .catch((error) => {
    console.error("\nfinance Repository contract 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
