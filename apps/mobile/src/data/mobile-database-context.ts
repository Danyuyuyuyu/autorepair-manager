import { type SQLiteDBConnection } from "@capacitor-community/sqlite";
import { Capacitor } from "@capacitor/core";

import type { Repositories } from "@/domain/repositories";

import { bootstrapMobileDatabase, type MobileBootstrapResult } from "./bootstrap";
import { createMobileCustomerRepository } from "./customer-repository";
import { withMobileSqliteErrorTranslation } from "./errors";
import { migrateMobileDatabase, type MobileMigrationResult } from "./migration";
import { MOBILE_SCHEMA_VERSION } from "./migrations";
import { mobileSqlite } from "./native-sqlite";
import { inspectMobileSchema, type MobileSchemaDiagnostics } from "./schema-diagnostics";

export const MOBILE_DATABASE_NAME = "autorepair";

export type MobileRepositories = Pick<Repositories, "customer">;

export interface MobileDatabaseStatus {
  databaseName: string;
  databaseFile: string;
  databaseExists: boolean;
  schemaVersion: number;
  migration: MobileMigrationResult;
  bootstrap: MobileBootstrapResult | null;
  schema: MobileSchemaDiagnostics;
}

interface MobileDatabaseOptions {
  databaseName?: string;
  bootstrap?: boolean;
  allowDelete?: boolean;
}

/**
 * Mobile SQLite 的唯一连接与事务入口。
 * 页面与业务服务只能拿 Repository，不接触 CapacitorSQLite 或 SQL。
 */
export class MobileDatabaseContext {
  readonly databaseName: string;

  private readonly sqlite = mobileSqlite;
  private readonly shouldBootstrap: boolean;
  private readonly allowDelete: boolean;
  private connection: SQLiteDBConnection | null = null;
  private repositories: MobileRepositories | null = null;
  private initializePromise: Promise<MobileDatabaseStatus> | null = null;
  private status: MobileDatabaseStatus | null = null;
  private transactionQueue: Promise<void> = Promise.resolve();

  constructor(options: MobileDatabaseOptions = {}) {
    this.databaseName = options.databaseName ?? MOBILE_DATABASE_NAME;
    this.shouldBootstrap = options.bootstrap ?? true;
    this.allowDelete = options.allowDelete ?? false;
  }

  get repos(): MobileRepositories {
    if (!this.repositories) throw new Error("Mobile database 尚未初始化");
    return this.repositories;
  }

  get currentStatus(): MobileDatabaseStatus | null {
    return this.status;
  }

  async initialize(): Promise<MobileDatabaseStatus> {
    if (this.status && (await this.isOpen())) return this.status;
    this.initializePromise ??= this.initializeInternal().finally(() => {
      this.initializePromise = null;
    });
    return this.initializePromise;
  }

  async ensureOpen(): Promise<MobileDatabaseStatus> {
    return this.initialize();
  }

  async transaction<T>(operation: (repos: MobileRepositories) => Promise<T>): Promise<T> {
    await this.initialize();

    const previous = this.transactionQueue;
    let release!: () => void;
    this.transactionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    let db: SQLiteDBConnection | null = null;
    let transactionActive = false;
    try {
      db = await this.openConnection();
      await db.beginTransaction();
      transactionActive = true;
      const result = await operation(this.repos);
      await db.commitTransaction();
      transactionActive = false;
      return result;
    } catch (error) {
      if (transactionActive && db) {
        await db.rollbackTransaction().catch(() => undefined);
      }
      throw error;
    } finally {
      release();
    }
  }

  async close(): Promise<void> {
    const db = this.connection;
    this.connection = null;
    this.repositories = null;
    this.status = null;
    if (!db) return;
    const open = await db.isDBOpen().catch(() => ({ result: false }));
    if (open.result) await db.close();
    await this.sqlite.closeConnection(this.databaseName, false).catch(() => undefined);
  }

  async deleteDatabaseForContract(): Promise<void> {
    if (!this.allowDelete) throw new Error("正式 Mobile 数据库禁止由运行时代码删除");
    const db = await this.openConnection();
    const open = await db.isDBOpen();
    if (open.result) await db.close();
    await db.delete();
    await this.sqlite.closeConnection(this.databaseName, false).catch(() => undefined);
    this.connection = null;
    this.repositories = null;
    this.status = null;
  }

  async withConnectionForContract<T>(
    operation: (db: SQLiteDBConnection) => Promise<T>,
  ): Promise<T> {
    if (!this.allowDelete) throw new Error("正式 Mobile 数据库不开放原始连接");
    await this.initialize();
    return operation(await this.openConnection());
  }

  private async initializeInternal(): Promise<MobileDatabaseStatus> {
    assertNativeAndroid();
    const db = await this.openConnection();
    await db.query("PRAGMA foreign_keys = ON");
    await db.query("PRAGMA synchronous = NORMAL");
    await db.query("PRAGMA busy_timeout = 5000");
    await db.query("PRAGMA journal_mode = WAL");

    const migration = await migrateMobileDatabase(db);
    if (migration.currentVersion !== MOBILE_SCHEMA_VERSION) {
      throw new Error(
        `Mobile schema version 不一致：${migration.currentVersion}/${MOBILE_SCHEMA_VERSION}`,
      );
    }
    const bootstrap = this.shouldBootstrap ? await bootstrapMobileDatabase(db) : null;
    const schema = await inspectMobileSchema(db);
    const expectedCustomerColumns = [
      "id",
      "name",
      "phone",
      "wechat",
      "address",
      "remark",
      "created_by",
      "created_at",
      "updated_at",
      "deleted_at",
    ];
    if (
      schema.tableCount !== 19 ||
      schema.indexCount !== 48 ||
      !schema.foreignKeysEnabled ||
      schema.foreignKeyViolations !== 0 ||
      schema.customerColumns.join(",") !== expectedCustomerColumns.join(",")
    ) {
      throw new Error(`Mobile schema 等价检查失败：${JSON.stringify(schema)}`);
    }
    const databaseExists = Boolean((await this.sqlite.isDatabase(this.databaseName)).result);
    const status: MobileDatabaseStatus = {
      databaseName: this.databaseName,
      databaseFile: `${this.databaseName}SQLite.db`,
      databaseExists,
      schemaVersion: migration.currentVersion,
      migration,
      bootstrap,
      schema,
    };
    this.status = status;
    return status;
  }

  private async openConnection(): Promise<SQLiteDBConnection> {
    assertNativeAndroid();
    if (this.connection) {
      const open = await this.connection.isDBOpen();
      if (open.result) return this.connection;
    }

    await this.sqlite.checkConnectionsConsistency();
    const existing = await this.sqlite.isConnection(this.databaseName, false);
    const db = existing.result
      ? await this.sqlite.retrieveConnection(this.databaseName, false)
      : await this.sqlite.createConnection(
          this.databaseName,
          false,
          "no-encryption",
          MOBILE_SCHEMA_VERSION,
          false,
        );
    const open = await db.isDBOpen();
    if (!open.result) await db.open();
    this.connection = db;
    this.repositories = {
      customer: withMobileSqliteErrorTranslation(createMobileCustomerRepository(db)),
    };
    return db;
  }

  private async isOpen(): Promise<boolean> {
    if (!this.connection) return false;
    return Boolean((await this.connection.isDBOpen().catch(() => ({ result: false }))).result);
  }
}

function assertNativeAndroid(): void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    throw new Error("MobileDatabaseContext 只能运行在 Android Native Runtime");
  }
}

export function createMobileDatabaseContext(
  options: MobileDatabaseOptions = {},
): MobileDatabaseContext {
  return new MobileDatabaseContext(options);
}

export const mobileDatabase = createMobileDatabaseContext();
