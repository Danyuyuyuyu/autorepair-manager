import type { SQLiteDBConnection } from "@capacitor-community/sqlite";

import { queryOne, queryRows } from "./sqlite-helpers";

export interface MobileSchemaDiagnostics {
  tableCount: number;
  indexCount: number;
  foreignKeysEnabled: boolean;
  foreignKeyViolations: number;
  customerColumns: string[];
}

export async function inspectMobileSchema(
  db: SQLiteDBConnection,
): Promise<MobileSchemaDiagnostics> {
  const tables = await queryRows<{ name: string }>(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  );
  const indexes = await queryRows<{ name: string }>(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'
     ORDER BY name`,
  );
  const foreignKeys = await queryOne<{ foreign_keys: number }>(db, "PRAGMA foreign_keys");
  const violations = await queryRows(db, "PRAGMA foreign_key_check");
  const customerColumns = await queryRows<{ name: string }>(db, "PRAGMA table_info(customers)");

  return {
    tableCount: tables.length,
    indexCount: indexes.length,
    foreignKeysEnabled: Number(foreignKeys?.foreign_keys ?? 0) === 1,
    foreignKeyViolations: violations.length,
    customerColumns: customerColumns.map((column) => column.name),
  };
}
