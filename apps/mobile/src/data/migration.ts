import type { SQLiteDBConnection } from "@capacitor-community/sqlite";

import { MOBILE_MIGRATIONS } from "./migrations";
import { queryRows } from "./sqlite-helpers";

export interface MobileMigrationResult {
  applied: string[];
  currentVersion: number;
}

export async function migrateMobileDatabase(
  db: SQLiteDBConnection,
): Promise<MobileMigrationResult> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_version (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
     );`,
    false,
  );
  const rows = await queryRows<{ version: number }>(db, "SELECT version FROM schema_version");
  const appliedVersions = new Set(rows.map((row) => Number(row.version)));
  const applied: string[] = [];

  for (const migration of MOBILE_MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    await db.beginTransaction();
    try {
      await db.execute(migration.sql, false);
      await db.run(
        "INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.name, new Date().toISOString()],
        false,
      );
      await db.commitTransaction();
      applied.push(migration.name);
    } catch (error) {
      await db.rollbackTransaction().catch(() => undefined);
      throw new Error(
        `Mobile migration ${migration.name} 执行失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { applied, currentVersion: await currentMobileSchemaVersion(db) };
}

export async function currentMobileSchemaVersion(db: SQLiteDBConnection): Promise<number> {
  const row = (
    await queryRows<{ version: number | null }>(
      db,
      "SELECT MAX(version) AS version FROM schema_version",
    )
  )[0];
  return Number(row?.version ?? 0);
}
