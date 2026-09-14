import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { money } from "@/lib/money";
import { closeSqliteDb } from "@/server/repos/sqlite/client";

async function main(): Promise<void> {
  assert.equal(process.env.APP_STORAGE, "sqlite", "探针必须在 APP_STORAGE=sqlite 下运行");
  process.env.DATABASE_URL = "postgresql://127.0.0.1:1/unavailable";
  process.env.BOOTSTRAP_ADMIN_USERNAME ??= "admin";
  process.env.BOOTSTRAP_ADMIN_PASSWORD ??= "admin123456";
  process.env.BOOTSTRAP_ADMIN_NAME ??= "店长";
  const probeUsername = process.env.SQLITE_AUTH_PROBE_USERNAME ?? "admin";
  const probePassword = process.env.SQLITE_AUTH_PROBE_PASSWORD ?? "admin123456";
  const tempDir = process.env.AUTOREPAIR_DB_PATH
    ? null
    : mkdtempSync(join(tmpdir(), "autorepair-sqlite-auth-"));
  const dbPath = process.env.AUTOREPAIR_DB_PATH ?? join(tempDir!, "autorepair.db");
  process.env.AUTOREPAIR_DB_PATH = dbPath;

  try {
    const [context, password, customer, vehicle, workOrder, finance, dashboard, audit] =
      await Promise.all([
        import("@/server/context"),
        import("@/server/auth/password"),
        import("@/server/services/customer.service"),
        import("@/server/services/vehicle.service"),
        import("@/server/services/work-order.service"),
        import("@/server/services/finance.service"),
        import("@/server/services/dashboard.service"),
        import("@/server/auth/audit"),
      ]);

    assert.equal(context.storage.kind, "sqlite");
    let login = await context.repos.user.findForLogin(probeUsername);
    if (!login) {
      const created = await context.repos.user.create({
        username: probeUsername,
        name: "店长",
        phone: null,
        passwordHash: await password.hashPassword(probePassword),
        role: "ADMIN",
      });
      login = await context.repos.user.findForLogin(created.username);
    }
    assert.ok(login);
    assert.equal(await password.verifyPassword(probePassword, login.passwordHash), true);

    const admin = {
      id: login.id,
      username: probeUsername,
      name: login.name,
      role: login.role,
      isAdmin: login.role === "ADMIN",
    } as const;
    const prefix = process.env.SQLITE_AUTH_PROBE_PREFIX ?? `SQLITE-${Date.now()}`;
    const service = await context.repos.catalog.createServiceItem({
      code: `${prefix}-SERVICE`,
      name: `${prefix} 更换机油`,
      kind: "SERVICE",
      categoryId: null,
      unit: "项",
      defaultPrice: money("80.00"),
      defaultHours: null,
      costPrice: money("20.00"),
      sortOrder: 1,
      remark: null,
    });
    const part = await context.repos.part.createWithInventory(
      {
        code: `${prefix}-PART`,
        name: `${prefix} 机油滤清器`,
        spec: "通用",
        brand: "Probe",
        unit: "个",
        categoryId: null,
        supplierId: null,
        costPrice: money("10.00"),
        salePrice: money("25.00"),
        remark: null,
      },
      { safeQuantity: money("2.00"), location: null },
    );
    await context.repos.inventory.applyChange(part.id, {
      quantity: money("5.00"),
      avgCost: money("10.00"),
    });

    const createdCustomer = await customer.createCustomer(
      { name: `${prefix} 客户`, phone: `${Date.now()}`.slice(-11) },
      admin,
    );
    const createdVehicle = await vehicle.createVehicle(
      {
        customerId: createdCustomer.id,
        plateNumber: `粤P${String(Date.now()).slice(-5)}`,
        brand: "Probe",
        model: "SQLite",
        currentMileage: 100,
      },
      admin,
    );
    const createdOrder = await workOrder.createWorkOrder(
      {
        customerId: createdCustomer.id,
        vehicleId: createdVehicle.id,
        discountAmount: "0",
        items: [
          {
            type: "SERVICE",
            itemRefId: service.id,
            name: service.name,
            quantity: "1",
            unitPrice: "80.00",
            costPrice: "20.00",
          },
          {
            type: "PART",
            itemRefId: part.id,
            name: part.name,
            spec: "通用",
            unit: "个",
            quantity: "1",
            unitPrice: "25.00",
            costPrice: "10.00",
          },
        ],
      },
      admin,
    );
    const detail = await context.repos.workOrder.findDetailById(createdOrder.id);
    assert.ok(detail);
    await finance.addPayment(
      {
        workOrderId: createdOrder.id,
        amount: detail.totalAmount.toFixed(2),
        method: "CASH",
        category: "REPAIR_SERVICE",
        occurredAt: new Date(),
      },
      admin,
    );
    for (const status of ["IN_PROGRESS", "PENDING_QC", "PENDING_PAYMENT", "COMPLETED"] as const) {
      await workOrder.changeWorkOrderStatus(
        {
          id: createdOrder.id,
          status,
          mileage: 120,
          ...(status === "COMPLETED"
            ? { createServiceRecord: true, serviceDescription: "SQLite 探针保养" }
            : {}),
        },
        admin,
      );
    }

    const stock = await context.repos.inventory.lockOrCreate(part.id);
    const balance = await finance.getWorkOrderBalance(createdOrder.id);
    const summary = await finance.getFinanceSummary(
      new Date("2000-01-01T00:00:00.000Z"),
      new Date("2100-01-01T00:00:00.000Z"),
    );
    const logs = await audit.listAuditLogs({ entityId: createdOrder.id, take: 100 });
    const stats = await dashboard.getDashboardStats(admin);
    assert.equal(stock?.quantity.toFixed(2), "4.00");
    assert.equal(balance.paid, detail.totalAmount.toFixed(2));
    assert.equal(
      logs.some((row) => row.entityId === createdOrder.id),
      true,
    );

    console.log("SQLite auth/business probe：通过");
    console.log(
      JSON.stringify(
        {
          dbPath,
          username: probeUsername,
          customer: createdCustomer.name,
          vehicle: createdVehicle.plateNumber,
          orderNo: createdOrder.orderNo,
          totalAmount: detail.totalAmount.toFixed(2),
          stockAfterOut: stock?.quantity.toFixed(2),
          paid: balance.paid,
          financeIncome: summary.income,
          dashboardCustomerCount: stats.customerCount,
          auditRows: logs.length,
        },
        null,
        2,
      ),
    );
  } finally {
    if (tempDir) {
      try {
        closeSqliteDb();
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        console.warn(`（临时目录稍后可手动删除：${tempDir}）`);
      }
    }
  }
}

main().catch((error) => {
  console.error("SQLite auth/business probe 失败：", error);
  process.exitCode = 1;
});
