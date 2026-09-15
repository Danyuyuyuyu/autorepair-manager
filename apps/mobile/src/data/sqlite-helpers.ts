import type { SQLiteDBConnection } from "@capacitor-community/sqlite";

export type MobileSqlValue = string | number | null;
export type MobileSqlRow = Record<string, unknown>;

export async function queryRows<T extends MobileSqlRow>(
  db: SQLiteDBConnection,
  statement: string,
  values: MobileSqlValue[] = [],
): Promise<T[]> {
  const result = await db.query(statement, values);
  return (result.values ?? []) as T[];
}

export async function queryOne<T extends MobileSqlRow>(
  db: SQLiteDBConnection,
  statement: string,
  values: MobileSqlValue[] = [],
): Promise<T | undefined> {
  return (await queryRows<T>(db, statement, values))[0];
}

export async function executeChanges(
  db: SQLiteDBConnection,
  statement: string,
  values: MobileSqlValue[] = [],
): Promise<number> {
  const result = await db.run(statement, values, false);
  return Number(result.changes?.changes ?? 0);
}

export const nullableText = (value: unknown): string | null =>
  value == null ? null : String(value);

export const requiredDate = (value: unknown): Date => new Date(String(value));
