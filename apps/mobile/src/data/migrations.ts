import initialSchemaSql from "../../../../src/server/repos/sqlite/migrations/001_init.sql?raw";

export const MOBILE_SCHEMA_VERSION = 1;

export interface MobileMigration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Mobile migration runner 与 PC 实现完全独立；这里只复用唯一的 SQLite DDL 契约，
 * 防止两份 schema 静默漂移。Vite 将 SQL 当作字符串打包，不会加载 server TypeScript。
 */
export const MOBILE_MIGRATIONS: readonly MobileMigration[] = [
  { version: 1, name: "001_init.sql", sql: initialSchemaSql },
];
