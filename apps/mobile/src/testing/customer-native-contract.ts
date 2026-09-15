import type { SQLiteDBConnection } from "@capacitor-community/sqlite";
import { Capacitor } from "@capacitor/core";

import {
  runCustomerRepositoryContract,
  type CustomerContractHarness,
  type CustomerContractMeta,
} from "@/domain/contracts/customer-repository.contract";

import { newMobileId } from "../data/id";
import { createMobileDatabaseContext, mobileDatabase } from "../data/mobile-database-context";
import { queryOne } from "../data/sqlite-helpers";
import { runNativeSqliteProbeOnce } from "../native/sqlite-probe";

const CONTRACT_DATABASE = "autorepair-mobile-customer-contract";
const PERSISTENCE_PHONE = "MOBILE-CUSTOMER-CONTRACT-PERSIST";

export async function runNativeCustomerContract(): Promise<void> {
  const formalStatus = await mobileDatabase.initialize();
  await runNativeSqliteProbeOnce();
  const context = createMobileDatabaseContext({
    databaseName: CONTRACT_DATABASE,
    bootstrap: false,
    allowDelete: true,
  });
  const status = await context.initialize();
  const priorRunPersisted = await context.withConnectionForContract(async (db) => {
    const prior = await queryOne<{ id: string }>(
      db,
      "SELECT id FROM customers WHERE phone = ? LIMIT 1",
      [PERSISTENCE_PHONE],
    );
    await cleanContractRows(db);
    return Boolean(prior);
  });

  const harness = await createHarness(context);
  const prefix = `MC${Date.now()}`;
  const result = await runCustomerRepositoryContract(harness, prefix);

  const committedPhone = `${prefix}-COMMIT`;
  const rolledBackPhone = `${prefix}-ROLLBACK`;
  await context.transaction(async (repos) => {
    await repos.customer.create({
      name: "Committed Customer",
      phone: committedPhone,
      createdBy: null,
    });
  });
  try {
    await context.transaction(async (repos) => {
      await repos.customer.create({
        name: "Rolled Back Customer",
        phone: rolledBackPhone,
        createdBy: null,
      });
      throw new Error("intentional customer transaction failure");
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("intentional")) throw error;
  }
  const transactionCommit = Boolean(await context.repos.customer.findByPhone(committedPhone));
  const transactionRollback = !(await context.repos.customer.findByPhone(rolledBackPhone));
  if (!transactionCommit || !transactionRollback) {
    throw new Error(
      `Customer transaction 失败：commit=${transactionCommit} rollback=${transactionRollback}`,
    );
  }

  const migrationRollback = await verifyMigrationRollback(context);
  if (!migrationRollback) throw new Error("Migration transaction 未回滚 DDL");

  await context.withConnectionForContract(cleanContractRows);
  await context.repos.customer.create({
    name: "Persistence Marker",
    phone: PERSISTENCE_PHONE,
    createdBy: null,
  });
  await context.close();
  await context.initialize();
  const closeReopenPersisted = Boolean(await context.repos.customer.findByPhone(PERSISTENCE_PHONE));
  if (!closeReopenPersisted) throw new Error("Customer close/reopen persistence 失败");

  await context.close();
  if (priorRunPersisted) await context.deleteDatabaseForContract();

  const encodedSnapshot = encodeURIComponent(JSON.stringify(result.snapshot));
  console.info(
    `[mobile:customer-contract] ${result.passed}/${result.total} ` +
      `platform=${Capacitor.getPlatform()} native=${Capacitor.isNativePlatform()} ` +
      `schemaVersion=${status.schemaVersion} tables=${status.schema.tableCount} ` +
      `indexes=${status.schema.indexCount} formalDb=${formalStatus.databaseFile} ` +
      `bootstrap=${formalStatus.bootstrap?.outcome ?? "missing"} ` +
      `bootstrapCounts=${encodeURIComponent(JSON.stringify(formalStatus.bootstrap?.counts ?? {}))} ` +
      `commit=${transactionCommit} rollback=${transactionRollback} ` +
      `migrationRollback=${migrationRollback} closeReopen=${closeReopenPersisted} ` +
      `priorRunPersisted=${priorRunPersisted} snapshot=${encodedSnapshot}`,
  );
}

async function createHarness(
  context: ReturnType<typeof createMobileDatabaseContext>,
): Promise<CustomerContractHarness> {
  return {
    name: "Android Native SQLite",
    customer: context.repos.customer,
    async setCustomerMeta(id: string, meta: CustomerContractMeta) {
      await context.withConnectionForContract(async (db) => {
        await db.run(
          `UPDATE customers
           SET created_at=?, updated_at=?, deleted_at=?, wechat=?, address=?, remark=?
           WHERE id=?`,
          [
            meta.createdAt.toISOString(),
            meta.updatedAt.toISOString(),
            meta.deletedAt?.toISOString() ?? null,
            meta.wechat ?? null,
            meta.address ?? null,
            meta.remark ?? null,
            id,
          ],
          false,
        );
      });
    },
    async createVehicle(customerId, plateNumber, deletedAt) {
      const id = newMobileId();
      const now = new Date("2097-01-01T00:00:00.000Z").toISOString();
      await context.withConnectionForContract(async (db) => {
        await db.run(
          `INSERT INTO vehicles
             (id, customer_id, plate_number, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, customerId, plateNumber, now, now, deletedAt?.toISOString() ?? null],
          false,
        );
      });
      return id;
    },
    async createOrder(input) {
      const createdAt = input.createdAt.toISOString();
      await context.withConnectionForContract(async (db) => {
        await db.run(
          `INSERT INTO work_orders
             (id, order_no, status, customer_id, vehicle_id, total_amount, paid_amount,
              created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newMobileId(),
            input.orderNo,
            input.status,
            input.customerId,
            input.vehicleId,
            input.totalAmount,
            input.paidAmount,
            createdAt,
            createdAt,
            input.deletedAt?.toISOString() ?? null,
          ],
          false,
        );
      });
    },
    async cleanup() {
      await context.withConnectionForContract(cleanContractRows);
    },
  };
}

async function cleanContractRows(db: SQLiteDBConnection): Promise<void> {
  await db.execute(
    `DELETE FROM work_orders;
     DELETE FROM vehicles;
     DELETE FROM customers;`,
    false,
  );
}

async function verifyMigrationRollback(
  context: ReturnType<typeof createMobileDatabaseContext>,
): Promise<boolean> {
  return context.withConnectionForContract(async (db) => {
    await db.beginTransaction();
    try {
      await db.execute(
        `CREATE TABLE mobile_failed_migration_probe (id TEXT PRIMARY KEY);
         INSERT INTO table_that_does_not_exist (id) VALUES ('failure');`,
        false,
      );
      await db.commitTransaction();
      throw new Error("故障注入 SQL 意外成功");
    } catch {
      await db.rollbackTransaction().catch(() => undefined);
    }
    const row = await queryOne<{ count: number }>(
      db,
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name = 'mobile_failed_migration_probe'`,
    );
    return Number(row?.count ?? 0) === 0;
  });
}
