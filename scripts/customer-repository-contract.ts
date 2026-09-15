import assert from "node:assert/strict";
import type { SQLInputValue } from "node:sqlite";

import {
  runCustomerRepositoryContract,
  type CustomerContractHarness,
  type CustomerContractMeta,
  type CustomerContractSnapshot,
} from "@/domain/contracts/customer-repository.contract";
import type { CustomerRepository } from "@/domain/repositories";
import { prisma } from "@/server/db";
import { createRepositories } from "@/server/repos/prisma";
import { createMemoryDb } from "@/server/repos/sqlite/client";
import { createSqliteRepositories } from "@/server/repos/sqlite/factory";
import { newId } from "@/server/repos/sqlite/id";

let passed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  assert.ok(condition, `${label}${detail ? `：${detail}` : ""}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function createSqliteHarness(): CustomerContractHarness {
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

function createPostgresHarness(prefix: string): CustomerContractHarness {
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
    async setCustomerMeta(id, meta: CustomerContractMeta) {
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

async function runHarness(
  harness: CustomerContractHarness,
  prefix: string,
): Promise<CustomerContractSnapshot> {
  console.log(`\n【${harness.name} customer contract】`);
  const result = await runCustomerRepositoryContract(harness, prefix, (label) => {
    passed += 1;
    console.log(`  ✓ ${harness.name} ${label}`);
  });
  console.log(
    `[customer-contract-snapshot] backend=${harness.name} snapshot=${JSON.stringify(result.snapshot)}`,
  );
  return result.snapshot;
}

async function main(): Promise<void> {
  const prefix = `CU${Date.now()}`;
  const target = process.env.CONTRACT_BACKEND;
  let sqlite: CustomerContractSnapshot | undefined;
  let postgres: CustomerContractSnapshot | undefined;

  if (target !== "postgres") {
    sqlite = await runHarness(createSqliteHarness(), prefix);
    checkFactoryFailFast();
  }
  if (target !== "sqlite") postgres = await runHarness(createPostgresHarness(prefix), prefix);
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
