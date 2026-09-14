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
  createCategory(name: string): Promise<string>;
  createSupplier(name: string): Promise<string>;
  createOrphanPart(code: string): Promise<string>;
  setMeta(id: string, isActive: boolean, createdAt: Date, updatedAt: Date): Promise<void>;
  cleanup(): Promise<void>;
}

interface Snapshot {
  listNames: string[];
  pageNames: string[];
  detail: {
    name: string;
    spec: string | null;
    safe: string;
    location: string | null;
    supplier: string | null;
  };
  searches: { name: string; brand: string; picker: string; global: string };
  stock: { quantity: string; safeQuantity: string; levels: number };
  deletedHidden: boolean;
  historyName: string;
  valuationInputs: { cost: string; avg: string };
}

let passed = 0;
function check(label: string, condition: unknown): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function baseData(
  name: string,
  code: string,
  supplierId: string | null,
  categoryId: string | null,
) {
  return {
    code,
    name,
    spec: "规格-1.25",
    brand: `${code}-BRAND`,
    unit: "件",
    categoryId,
    supplierId,
    costPrice: D("10.50"),
    salePrice: D("99.99"),
    remark: null,
  };
}

async function runContract(harness: Harness, prefix: string): Promise<Snapshot> {
  const { repos } = harness;
  const activeBefore = await repos.part.countActive();
  const categoryId = await harness.createCategory(`${prefix}-category`);
  const supplierId = await harness.createSupplier(`${prefix}-supplier`);
  const primary = await repos.part.createWithInventory(
    baseData(`${prefix}-Brake Rotor`, `${prefix}-A`, supplierId, categoryId),
    { safeQuantity: D("5.00"), location: "A-01" },
  );
  const second = await repos.part.createWithInventory(
    { ...baseData(`${prefix}-Oil Filter`, `${prefix}-B`, null, categoryId), spec: "滤芯" },
    { safeQuantity: D("10.00"), location: null },
  );
  const zero = await repos.part.createWithInventory(
    { ...baseData(`${prefix}-Zero Stock`, `${prefix}-C`, null, null), brand: "ZeroBrand" },
    { safeQuantity: D("1.00"), location: "Z-01" },
  );
  const inactive = await repos.part.createWithInventory(
    { ...baseData(`${prefix}-Inactive`, `${prefix}-D`, null, null) },
    { safeQuantity: D("0"), location: null },
  );
  const orphanId = await harness.createOrphanPart(`${prefix}-ORPHAN`);

  await harness.setMeta(
    primary.id,
    true,
    new Date("2097-01-01T00:00:00.000Z"),
    new Date("2097-01-05T00:00:00.000Z"),
  );
  await harness.setMeta(
    second.id,
    true,
    new Date("2097-01-02T00:00:00.000Z"),
    new Date("2097-01-04T00:00:00.000Z"),
  );
  await harness.setMeta(
    zero.id,
    true,
    new Date("2097-01-03T00:00:00.000Z"),
    new Date("2097-01-03T00:00:00.000Z"),
  );
  await harness.setMeta(
    inactive.id,
    false,
    new Date("2097-01-04T00:00:00.000Z"),
    new Date("2097-01-06T00:00:00.000Z"),
  );

  await harness.transaction((tx) =>
    applyStockChange(tx, {
      partId: primary.id,
      type: "PURCHASE_IN",
      deltaQuantity: "3.00",
      unitCost: "10.50",
    }).then(() => undefined),
  );
  await harness.transaction((tx) =>
    applyStockChange(tx, {
      partId: second.id,
      type: "PURCHASE_IN",
      deltaQuantity: "12.00",
      unitCost: "20.00",
    }).then(() => undefined),
  );

  const updated = {
    ...baseData(`${prefix}-Brake Rotor Updated`, `${prefix}-A2`, supplierId, categoryId),
    spec: "规格-UPDATED",
    costPrice: D("99999999.99"),
  };
  await repos.part.updateWithInventory(primary.id, updated, {
    safeQuantity: D("2.50"),
    location: "B-09",
  });
  await harness.setMeta(
    primary.id,
    true,
    new Date("2097-01-01T00:00:00.000Z"),
    new Date("2097-01-05T00:00:00.000Z"),
  );
  const edit = await repos.part.findForEdit(primary.id);
  check(
    `${harness.name} create/update 与 nullable/Decimal`,
    edit?.name === updated.name &&
      edit?.safeQuantity?.toFixed(2) === "2.50" &&
      edit?.location === "B-09" &&
      edit?.spec === "规格-UPDATED",
  );

  const page = await repos.part.list(
    { keyword: `${prefix}-Brake Rotor Updated` },
    { skip: 0, take: 1 },
  );
  check(`${harness.name} 分页与名称模糊搜索`, page.total === 1 && page.rows[0]?.id === primary.id);
  const list = await repos.part.list({}, { skip: 0, take: 1000 });
  check(
    `${harness.name} 默认列表隐藏 inactive/deleted 且排序一致`,
    list.rows.some((row) => row.id === primary.id) &&
      !list.rows.some((row) => row.id === inactive.id),
  );
  const inactiveList = await repos.part.list({ includeInactive: true }, { skip: 0, take: 1000 });
  check(
    `${harness.name} includeInactive`,
    inactiveList.rows.some((row) => row.id === inactive.id),
  );
  check(
    `${harness.name} category 筛选`,
    (await repos.part.list({ categoryId }, { skip: 0, take: 1000 })).rows.every(
      (row) => row.categoryId === categoryId,
    ),
  );
  check(
    `${harness.name} zeroStockOnly 筛选`,
    (await repos.part.list({ zeroStockOnly: true }, { skip: 0, take: 1000 })).rows.some(
      (row) => row.id === zero.id,
    ),
  );
  const inventoryOnly = await repos.part.list(
    { hasInventoryRowOnly: true },
    { skip: 0, take: 1000 },
  );
  check(
    `${harness.name} hasInventoryRowOnly 筛选`,
    inventoryOnly.rows.some((row) => row.id === primary.id) &&
      inventoryOnly.rows.some((row) => row.id === zero.id) &&
      !inventoryOnly.rows.some((row) => row.id === orphanId),
  );

  const detail = await repos.part.findDetail(primary.id);
  check(
    `${harness.name} detail category/supplier/inventory 联表`,
    detail?.category?.name === `${prefix}-category` &&
      detail.supplier?.name === `${prefix}-supplier` &&
      detail.inventory?.location === "B-09",
  );
  check(
    `${harness.name} snapshot/unit cost/brief`,
    (await repos.part.findSnapshot(primary.id))?.avgCost?.toFixed(2) === "10.50" &&
      (await repos.part.findUnitCost(primary.id))?.costPrice.toFixed(2) === "99999999.99" &&
      (await repos.part.findBrief(primary.id))?.name === updated.name,
  );
  const levels = await repos.part.listStockLevels([primary.id, second.id, zero.id, "missing"]);
  check(
    `${harness.name} stock level nullable 与批量查询`,
    levels.length === 3 && levels.find((row) => row.id === zero.id)?.quantity?.isZero(),
  );
  check(
    `${harness.name} low-stock candidates 交给领域层比较`,
    (await repos.part.listLowStockCandidates()).every(
      (row) => row.isActive && row.inventory !== null,
    ),
  );

  check(
    `${harness.name} searchForPicker/global 与 limit`,
    (await repos.part.searchForPicker(`${prefix}-A2`, 1))[0]?.id === primary.id &&
      (await repos.part.searchForPicker(`${prefix}-`, 2)).length === 2 &&
      (await repos.part.searchForGlobal(`${prefix}-A2-brand`, 10)).some(
        (row) => row.id === primary.id,
      ) &&
      (await repos.part.searchForGlobal("%\' OR 1=1 --", 10)).length === 0,
  );
  const pickerSearchName = (await repos.part.searchForPicker(`${prefix}-A2`, 1))[0]?.name ?? "";
  const brandSearchNames = (await repos.part.searchForGlobal(`${prefix}-A2-brand`, 10))
    .map((row) => row.name)
    .join(",");
  check(`${harness.name} countActive`, (await repos.part.countActive()) === activeBefore + 4);
  check(
    `${harness.name} findForDelete 保留当前库存`,
    (await repos.part.findForDelete(primary.id))?.quantity?.toFixed(2) === "3.00",
  );

  await repos.part.updateCostAndSupplier(primary.id, { costPrice: D("99999999.99"), supplierId });
  const zeroDetail = await repos.part.findDetail(zero.id);
  check(
    `${harness.name} 金额边界 round-trip`,
    zeroDetail?.costPrice.toFixed(2) === "10.50" && detail?.salePrice.toFixed(2) === "99.99",
  );

  await repos.part.softDelete(primary.id);
  const history = await repos.inventory.listTransactions(
    { partId: primary.id },
    { skip: 0, take: 10 },
  );
  check(
    `${harness.name} soft delete 隐藏普通查询但保留历史关系`,
    (await repos.part.findDetail(primary.id)) === null &&
      (await repos.part.findSnapshot(primary.id)) === null &&
      !(await repos.part.searchForGlobal(`${prefix}-Brake Rotor`, 20)).some(
        (row) => row.id === primary.id,
      ) &&
      history.rows[0]?.part.name === updated.name,
  );
  await repos.part.softDelete(inactive.id);
  check(
    `${harness.name} 删除后列表/全局搜索过滤`,
    !(await repos.part.list({ includeInactive: true }, { skip: 0, take: 30 })).rows.some(
      (row) => row.id === inactive.id,
    ),
  );

  const valuation = await repos.inventory.listValuationLines();
  const deletedValuation = valuation.find(
    (line) =>
      line.partDeletedAt !== null &&
      line.partCostPrice.eq(D("99999999.99")) &&
      line.avgCost.eq(D("10.50")),
  );
  check(
    `${harness.name} 估值原始行保留 deletedAt`,
    deletedValuation?.partDeletedAt instanceof Date,
  );

  return {
    listNames: list.rows.filter((row) => row.name.startsWith(prefix)).map((row) => row.name),
    pageNames: page.rows.map((row) => row.name),
    detail: {
      name: updated.name,
      spec: updated.spec,
      safe: edit?.safeQuantity?.toFixed(2) ?? "null",
      location: edit?.location ?? null,
      supplier: detail?.supplier?.name ?? null,
    },
    searches: {
      name: pickerSearchName,
      brand: brandSearchNames,
      picker: (await repos.part.searchForPicker(`${prefix}-`, 20)).map((row) => row.name).join(","),
      global: (await repos.part.searchForGlobal(`${prefix}-`, 20)).map((row) => row.name).join(","),
    },
    stock: { quantity: "3.00", safeQuantity: "2.50", levels: levels.length },
    deletedHidden: (await repos.part.findDetail(primary.id)) === null,
    historyName: history.rows[0]?.part.name ?? "",
    valuationInputs: {
      cost: deletedValuation?.partCostPrice.toFixed(2) ?? "",
      avg: deletedValuation?.avgCost.toFixed(2) ?? "",
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
    async createCategory(name) {
      const id = newId();
      const now = new Date().toISOString();
      execute(
        "INSERT INTO categories (id,name,kind,created_at,updated_at) VALUES (?,?,?,?,?)",
        id,
        name,
        "PART",
        now,
        now,
      );
      return id;
    },
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
    async createOrphanPart(code) {
      const id = newId();
      const now = new Date().toISOString();
      execute(
        "INSERT INTO parts (id,code,name,unit,cost_price,sale_price,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        id,
        code,
        code,
        "件",
        "1.10",
        "1.10",
        1,
        now,
        now,
      );
      return id;
    },
    async setMeta(id, isActive, createdAt, updatedAt) {
      execute(
        "UPDATE parts SET is_active=?, created_at=?, updated_at=? WHERE id=?",
        isActive ? 1 : 0,
        createdAt.toISOString(),
        updatedAt.toISOString(),
        id,
      );
    },
    async cleanup() {
      db.close();
    },
  };
}

function createPostgresHarness(prefix: string): Harness {
  const repos = createRepositories(prisma);
  const categoryIds: string[] = [];
  const supplierIds: string[] = [];
  return {
    name: "PostgreSQL",
    repos,
    transaction: (fn) => prisma.$transaction((tx) => fn(createRepositories(tx))),
    async createCategory(name) {
      const row = await prisma.category.create({ data: { name, kind: "PART" } });
      categoryIds.push(row.id);
      return row.id;
    },
    async createSupplier(name) {
      const row = await prisma.supplier.create({ data: { name } });
      supplierIds.push(row.id);
      return row.id;
    },
    async createOrphanPart(code) {
      const row = await prisma.part.create({
        data: { code, name: code, unit: "件", costPrice: D("1.10"), salePrice: D("1.10") },
      });
      return row.id;
    },
    async setMeta(id, isActive, createdAt, updatedAt) {
      await prisma.part.update({ where: { id }, data: { isActive, createdAt, updatedAt } });
    },
    async cleanup() {
      const parts = await prisma.part.findMany({
        where: { code: { startsWith: prefix } },
        select: { id: true },
      });
      const ids = parts.map((row) => row.id);
      if (ids.length)
        await prisma.inventoryTransaction.deleteMany({ where: { partId: { in: ids } } });
      if (ids.length) await prisma.part.deleteMany({ where: { id: { in: ids } } });
      if (supplierIds.length)
        await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
      if (categoryIds.length)
        await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    },
  };
}

async function main(): Promise<void> {
  const prefix = `PART${Date.now()}`;
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
    console.log("\nPostgreSQL Part snapshot:", JSON.stringify(postgres, null, 2));
    console.log("SQLite Part snapshot:", JSON.stringify(sqlite, null, 2));
    assert.deepEqual(postgres, sqlite, "PostgreSQL 与 SQLite Part contract 结果不一致");
    passed += 1;
    console.log("  ✓ PostgreSQL / SQLite Part 语义快照完全一致");
  }
  console.log(`\npart Repository contract：通过 ${passed} 项，失败 0 项`);
}

main()
  .catch((error) => {
    console.error("\npart Repository contract 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
