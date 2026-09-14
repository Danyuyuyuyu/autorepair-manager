/**
 * 存储装配探针 —— 由 scripts/storage-verify.ts 以不同 APP_STORAGE 环境派生。
 * 单一职责：在子进程里真实 import 装配点，把结果以单行 JSON 输出。
 * （context 是模块级单例，四种场景必须各自独立进程才能互不污染。）
 */

import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

const scenario = process.env.SCENARIO ?? "unset";

async function main() {
  // 故障场景：import 阶段就应抛错，走不到下面的输出
  const context = await import("@/server/context");
  const { storageBrandOf } = await import("@/server/repos/create-repositories");
  const brand = storageBrandOf(context.repos);

  const result: Record<string, unknown> = {
    scenario,
    kind: context.storage.kind,
    engine: context.storage.engine,
    brand,
    dbPath: context.storage.database,
    workOrderReady: typeof context.repos.workOrder.findLatestOrderNo === "function",
    workOrderItemReady: typeof context.repos.workOrderItem.countByOrder === "function",
    customerReady: typeof context.repos.customer.countActive === "function",
    vehicleReady: typeof context.repos.vehicle.findIdByPlate === "function",
    partReady: typeof context.repos.part.findDetail === "function",
    inventoryReady: typeof context.repos.inventory.lockOrCreate === "function",
    financeReady: typeof context.repos.finance.listPayments === "function",
    catalogReady: typeof context.repos.catalog.listServiceItems === "function",
    userReady: typeof context.repos.user.findForLogin === "function",
    auditReady:
      typeof context.repos.audit.append === "function" &&
      typeof context.repos.audit.list === "function" &&
      typeof context.repos.audit.findById === "function",
    sessionStoreReady: typeof context.sessionStore.findValid === "function",
  };

  if (context.storage.kind === "sqlite") {
    const db: DatabaseSync = (await import("@/server/repos/sqlite/client")).getSqliteDb();
    result.dbFileExists = result.dbPath ? existsSync(result.dbPath as string) : false;
    result.tables = (
      db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as {
        n: number;
      }
    ).n;
    result.schemaVersion = (
      db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }
    ).v;
    result.wal = (db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode;
    result.foreignKeys = (
      db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }
    ).foreign_keys;
    result.busyTimeout = (db.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout;
    result.latestOrderNo = await context.repos.workOrder.findLatestOrderNo("STORAGE-PROBE-");
    result.placeholderCount = (await import("@/server/repos/sqlite/factory")).placeholderCount();

    // 本阶段所有业务仓储均已接入 SQLite；保留空集合断言，防止未来静默新增 fallback。
    const placeholderErrors: Record<string, string> = {};
    for (const key of [] as const) {
      try {
        void (context.repos[key] as unknown as Record<string, unknown>).__storageProbe__;
        placeholderErrors[key] = "NO_ERROR_THROWN";
      } catch (error) {
        placeholderErrors[key] = (error as Error).message;
      }
    }
    result.placeholderErrors = placeholderErrors;

    // 事务装配路径：Audit 写入应绑定同一 SQLite transaction。
    try {
      await context.transaction(async (repos) => {
        await repos.audit.append({
          userId: null,
          userName: "storage-probe",
          action: "STORAGE_PROBE",
          entity: "storage",
          entityId: "STORAGE-PROBE-AUDIT",
          summary: "transaction probe",
        });
      });
      result.txError = "NO_ERROR_THROWN";
    } catch (error) {
      result.txError = (error as Error).message;
    }
  }

  console.log(`PROBE_JSON:${JSON.stringify(result)}`);
}

main().catch((error) => {
  console.error(`PROBE_FATAL:${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
