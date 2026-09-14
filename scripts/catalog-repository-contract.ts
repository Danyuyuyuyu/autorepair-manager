import assert from "node:assert/strict";
import type { SQLInputValue } from "node:sqlite";

import type { CatalogRepository } from "@/domain/repositories";
import { D } from "@/lib/money";
import { prisma } from "@/server/db";
import { createRepositories } from "@/server/repos/prisma";
import { createMemoryDb } from "@/server/repos/sqlite/client";
import { createSqliteRepositories } from "@/server/repos/sqlite/factory";
import { newId } from "@/server/repos/sqlite/id";

interface CatalogHarness {
  name: "PostgreSQL" | "SQLite";
  catalog: CatalogRepository;
  setServiceItemMeta(id: string, isActive: boolean, deletedAt?: Date | null): Promise<void>;
  readServiceItemCreatedAt(id: string): Promise<string>;
  setCategoryActive(id: string, isActive: boolean): Promise<void>;
  setSupplierMeta(id: string, isActive: boolean, deletedAt?: Date | null): Promise<void>;
  createHistoricalReference(serviceItemId: string, prefix: string): Promise<string>;
  readHistoricalReference(itemId: string): Promise<{ itemRefId: string | null; name: string }>;
  cleanup(): Promise<void>;
}

interface CatalogSnapshot {
  serviceItems: Array<{
    name: string;
    kind: string;
    code: string | null;
    unit: string;
    defaultPrice: string;
    costPrice: string;
    categoryName: string | null;
  }>;
  laborItems: string[];
  limitedCount: number;
  emptyCount: number;
  categoryNames: string[];
  disabledCategoryVisible: boolean;
  supplierRows: Array<{ name: string; contact: string | null; phone: string | null }>;
  deletedSupplierVisible: boolean;
  activeCost: string;
  deletedCost: string | null;
  history: { itemRefPresent: boolean; name: string };
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
  expectedConstructor = "UniqueConstraintError",
): Promise<void> {
  try {
    await operation();
    check(label, false, `应抛出 ${expectedConstructor}`);
  } catch (error) {
    check(label, (error as object).constructor.name === expectedConstructor);
  }
}

function money(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(2);
}

async function runContract(harness: CatalogHarness, prefix: string): Promise<CatalogSnapshot> {
  console.log(`\n【${harness.name} catalog contract】`);
  const category = await harness.catalog.createCategory({
    name: `${prefix}-category`,
    kind: "SERVICE",
    sortOrder: 2,
  });
  const disabledCategory = await harness.catalog.createCategory({
    name: `${prefix}-disabled-category`,
    kind: "SERVICE",
    sortOrder: 3,
  });
  await harness.setCategoryActive(disabledCategory.id, false);

  const labor = await harness.catalog.createServiceItem({
    code: `${prefix}-L`,
    name: `${prefix}-a-labor`,
    kind: "LABOR",
    categoryId: category.id,
    unit: "小时",
    defaultPrice: D("99999999.99"),
    defaultHours: null,
    costPrice: D("10.50"),
    sortOrder: 1,
    remark: null,
  });
  const service = await harness.catalog.createServiceItem({
    code: null,
    name: `${prefix}-b-service`,
    kind: "SERVICE",
    categoryId: category.id,
    unit: "项",
    defaultPrice: D("0.01"),
    defaultHours: D("1.10"),
    costPrice: D("99.99"),
    sortOrder: 2,
    remark: "nullable code/category values are part of the contract",
  });
  const disabled = await harness.catalog.createServiceItem({
    code: `${prefix}-D`,
    name: `${prefix}-disabled`,
    kind: "SERVICE",
    categoryId: category.id,
    unit: "项",
    defaultPrice: D("10.50"),
    defaultHours: D("0.00"),
    costPrice: D("1.10"),
    sortOrder: 3,
    remark: null,
  });
  const deleted = await harness.catalog.createServiceItem({
    code: `${prefix}-X`,
    name: `${prefix}-deleted`,
    kind: "SERVICE",
    categoryId: category.id,
    unit: "项",
    defaultPrice: D("1.10"),
    defaultHours: D("0.00"),
    costPrice: D("0.00"),
    sortOrder: 4,
    remark: null,
  });
  await harness.setServiceItemMeta(disabled.id, false);
  await harness.setServiceItemMeta(deleted.id, true, new Date("2098-01-05T00:00:00.000Z"));

  const supplier = await harness.catalog.createSupplier({
    name: `${prefix}-supplier`,
    contact: "采购联系人",
    phone: null,
    address: null,
    remark: "supplier remark",
  });
  const deletedSupplier = await harness.catalog.createSupplier({
    name: `${prefix}-deleted-supplier`,
    contact: null,
    phone: "13800000000",
    address: "地址",
    remark: null,
  });
  await harness.setSupplierMeta(deletedSupplier.id, false, new Date("2098-01-05T00:00:00.000Z"));

  const activeItems = await harness.catalog.listServiceItems({ keyword: prefix, limit: 20 });
  check(
    `${harness.name} active service-item list hides disabled/deleted`,
    activeItems.length === 2 &&
      activeItems.every((row) => row.name !== disabled.name && row.name !== deleted.name),
  );
  check(
    `${harness.name} ServiceItem sortOrder/name`,
    activeItems.map((row) => row.name).join("|") === `${labor.name}|${service.name}`,
  );
  check(
    `${harness.name} kind filter`,
    (await harness.catalog.listServiceItems({ keyword: prefix, kind: "LABOR", limit: 20 }))
      .map((row) => row.name)
      .join("|") === labor.name,
  );
  check(
    `${harness.name} Decimal and nullable round-trip`,
    money(activeItems[0]!.defaultPrice) === "99999999.99" &&
      money(activeItems[0]!.costPrice) === "10.50" &&
      activeItems[1]!.code === null &&
      money(activeItems[1]!.defaultPrice) === "0.01" &&
      money(activeItems[1]!.costPrice) === "99.99" &&
      activeItems[1]!.categoryName === category.name,
  );
  check(
    `${harness.name} parameterized search and empty result`,
    (await harness.catalog.listServiceItems({ keyword: `${prefix}-b-`, limit: 20 })).length === 1 &&
      (await harness.catalog.listServiceItems({ keyword: "%\' OR 1=1 --", limit: 20 })).length ===
        0 &&
      (await harness.catalog.listServiceItems({ keyword: `${prefix}-missing`, limit: 20 }))
        .length === 0,
  );
  check(
    `${harness.name} limit`,
    (await harness.catalog.listServiceItems({ keyword: prefix, limit: 1 })).length === 1,
  );
  check(
    `${harness.name} findServiceItemCost excludes deleted`,
    money((await harness.catalog.findServiceItemCost(service.id))!) === "99.99" &&
      (await harness.catalog.findServiceItemCost(deleted.id)) === null,
  );

  const serviceCategories = await harness.catalog.listCategories("SERVICE");
  check(
    `${harness.name} category active filter and ordering`,
    serviceCategories
      .filter((row) => row.name.startsWith(prefix))
      .map((row) => row.name)
      .join("|") === category.name,
  );
  check(
    `${harness.name} findCategoryByName retains exact lookup semantics`,
    (await harness.catalog.findCategoryByName("SERVICE", disabledCategory.name))?.id ===
      disabledCategory.id,
  );
  await expectError(`${harness.name} category unique violation is translated`, () =>
    harness.catalog.createCategory({ name: category.name, kind: "SERVICE", sortOrder: 99 }),
  );

  const suppliers = (await harness.catalog.listSuppliers()).filter((row) =>
    row.name.startsWith(prefix),
  );
  check(
    `${harness.name} supplier nullable fields and active filter`,
    suppliers.length === 1 &&
      suppliers[0]!.name === supplier.name &&
      suppliers[0]!.contact === "采购联系人" &&
      suppliers[0]!.phone === null,
  );
  const createdAt = await harness.readServiceItemCreatedAt(service.id);
  check(
    `${harness.name} DateTime ISO persistence round-trip`,
    new Date(createdAt).toISOString() === createdAt,
  );

  const historyItemId = await harness.createHistoricalReference(service.id, prefix);
  const history = await harness.readHistoricalReference(historyItemId);
  check(
    `${harness.name} historical work-order item keeps catalog snapshot reference`,
    history.itemRefId === service.id && history.name === `${prefix}-historical snapshot`,
  );

  const snapshot: CatalogSnapshot = {
    serviceItems: activeItems.map((row) => ({
      name: row.name,
      kind: row.kind,
      code: row.code,
      unit: row.unit,
      defaultPrice: money(row.defaultPrice),
      costPrice: money(row.costPrice),
      categoryName: row.categoryName,
    })),
    laborItems: (
      await harness.catalog.listServiceItems({ keyword: prefix, kind: "LABOR", limit: 20 })
    ).map((row) => row.name),
    limitedCount: (await harness.catalog.listServiceItems({ keyword: prefix, limit: 1 })).length,
    emptyCount: (
      await harness.catalog.listServiceItems({ keyword: `${prefix}-missing`, limit: 20 })
    ).length,
    categoryNames: serviceCategories
      .filter((row) => row.name.startsWith(prefix))
      .map((row) => row.name),
    disabledCategoryVisible: serviceCategories.some((row) => row.id === disabledCategory.id),
    supplierRows: suppliers.map((row) => ({
      name: row.name,
      contact: row.contact,
      phone: row.phone,
    })),
    deletedSupplierVisible: suppliers.some((row) => row.name === deletedSupplier.name),
    activeCost: money((await harness.catalog.findServiceItemCost(service.id))!),
    deletedCost: (await harness.catalog.findServiceItemCost(deleted.id))?.toFixed(2) ?? null,
    history: { itemRefPresent: history.itemRefId === service.id, name: history.name },
  };

  await harness.cleanup();
  return snapshot;
}

function createSqliteHarness(): CatalogHarness {
  const db = createMemoryDb();
  const repos = createSqliteRepositories(db);
  const execute = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);
  return {
    name: "SQLite",
    catalog: repos.catalog,
    async setServiceItemMeta(id, isActive, deletedAt = null) {
      execute(
        "UPDATE service_items SET is_active=?, deleted_at=? WHERE id=?",
        isActive ? 1 : 0,
        deletedAt?.toISOString() ?? null,
        id,
      );
    },
    async readServiceItemCreatedAt(id) {
      const row = db.prepare("SELECT created_at FROM service_items WHERE id=?").get(id) as {
        created_at: string;
      };
      return row.created_at;
    },
    async setCategoryActive(id, isActive) {
      execute("UPDATE categories SET is_active=? WHERE id=?", isActive ? 1 : 0, id);
    },
    async setSupplierMeta(id, isActive, deletedAt = null) {
      execute(
        "UPDATE suppliers SET is_active=?, deleted_at=? WHERE id=?",
        isActive ? 1 : 0,
        deletedAt?.toISOString() ?? null,
        id,
      );
    },
    async createHistoricalReference(serviceItemId, prefix) {
      const customerId = newId();
      const vehicleId = newId();
      const orderId = newId();
      const itemId = newId();
      const now = new Date("2098-01-06T00:00:00.000Z").toISOString();
      execute(
        "INSERT INTO customers (id,name,phone,created_at,updated_at) VALUES (?,?,?,?,?)",
        customerId,
        `${prefix}-history customer`,
        `${prefix}-phone`,
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
        "INSERT INTO work_orders (id,order_no,status,customer_id,vehicle_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        orderId,
        `${prefix}-history-order`,
        "COMPLETED",
        customerId,
        vehicleId,
        now,
        now,
      );
      execute(
        "INSERT INTO work_order_items (id,work_order_id,type,item_ref_id,name,unit,quantity,unit_price,cost_price,amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        itemId,
        orderId,
        "SERVICE",
        serviceItemId,
        `${prefix}-historical snapshot`,
        "项",
        "1.00",
        "0.01",
        "0.00",
        "0.01",
        now,
        now,
      );
      return itemId;
    },
    async readHistoricalReference(itemId) {
      const row = db
        .prepare("SELECT item_ref_id, name FROM work_order_items WHERE id=?")
        .get(itemId) as { item_ref_id: string | null; name: string };
      return { itemRefId: row.item_ref_id, name: row.name };
    },
    async cleanup() {
      db.close();
    },
  };
}

function createPostgresHarness(prefix: string): CatalogHarness {
  const repos = createRepositories(prisma);
  const historyOrderNos: string[] = [];
  const customerIds: string[] = [];
  const vehicleIds: string[] = [];
  return {
    name: "PostgreSQL",
    catalog: repos.catalog,
    async setServiceItemMeta(id, isActive, deletedAt = null) {
      await prisma.serviceItem.update({ where: { id }, data: { isActive, deletedAt } });
    },
    async readServiceItemCreatedAt(id) {
      const row = await prisma.serviceItem.findUniqueOrThrow({
        where: { id },
        select: { createdAt: true },
      });
      return row.createdAt.toISOString();
    },
    async setCategoryActive(id, isActive) {
      await prisma.category.update({ where: { id }, data: { isActive } });
    },
    async setSupplierMeta(id, isActive, deletedAt = null) {
      await prisma.supplier.update({ where: { id }, data: { isActive, deletedAt } });
    },
    async createHistoricalReference(serviceItemId, prefix) {
      const customer = await prisma.customer.create({
        data: { name: `${prefix}-history customer`, phone: `${prefix}-phone` },
      });
      customerIds.push(customer.id);
      const vehicle = await prisma.vehicle.create({
        data: { customerId: customer.id, plateNumber: `${prefix}-plate` },
      });
      vehicleIds.push(vehicle.id);
      const order = await prisma.workOrder.create({
        data: {
          orderNo: `${prefix}-history-order`,
          status: "COMPLETED",
          customerId: customer.id,
          vehicleId: vehicle.id,
        },
      });
      historyOrderNos.push(order.orderNo);
      const item = await prisma.workOrderItem.create({
        data: {
          workOrderId: order.id,
          type: "SERVICE",
          itemRefId: serviceItemId,
          name: `${prefix}-historical snapshot`,
          unit: "项",
          quantity: "1.00",
          unitPrice: "0.01",
          costPrice: "0.00",
          amount: "0.01",
        },
      });
      return item.id;
    },
    async readHistoricalReference(itemId) {
      const row = await prisma.workOrderItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { itemRefId: true, name: true },
      });
      return { itemRefId: row.itemRefId, name: row.name };
    },
    async cleanup() {
      if (historyOrderNos.length > 0)
        await prisma.workOrder.deleteMany({ where: { orderNo: { in: historyOrderNos } } });
      if (vehicleIds.length > 0)
        await prisma.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
      if (customerIds.length > 0)
        await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      await prisma.serviceItem.deleteMany({ where: { name: { startsWith: prefix } } });
      await prisma.category.deleteMany({ where: { name: { startsWith: prefix } } });
      await prisma.supplier.deleteMany({ where: { name: { startsWith: prefix } } });
    },
  };
}

function checkFactoryFailFast(): void {
  const db = createMemoryDb();
  try {
    const repos = createSqliteRepositories(db);
    check("SQLite Factory 装配真实 Catalog", typeof repos.catalog.listServiceItems === "function");
    check(
      "SQLite Factory 装配真实 audit",
      typeof repos.audit.append === "function" && typeof repos.audit.list === "function",
    );
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const prefix = `CAT${Date.now()}`;
  const target = process.env.CONTRACT_BACKEND;
  let sqlite: CatalogSnapshot | undefined;
  let postgres: CatalogSnapshot | undefined;
  if (target !== "postgres") {
    sqlite = await runContract(createSqliteHarness(), prefix);
    checkFactoryFailFast();
  }
  if (target !== "sqlite") {
    postgres = await runContract(createPostgresHarness(prefix), prefix);
  }
  if (sqlite && postgres) {
    console.log("PostgreSQL Catalog snapshot:", JSON.stringify(postgres, null, 2));
    console.log("SQLite Catalog snapshot:", JSON.stringify(sqlite, null, 2));
    assert.deepEqual(postgres, sqlite, "PostgreSQL 与 SQLite Catalog 语义快照不一致");
    passed += 1;
    console.log("\n  ✓ PostgreSQL / SQLite Catalog 语义快照完全一致");
  }
  console.log(`\nCatalog Repository contract：通过 ${passed} 项，失败 0 项`);
}

main()
  .catch((error) => {
    console.error("\nCatalog Repository contract 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
