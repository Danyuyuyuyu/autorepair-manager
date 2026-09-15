import { type SQLiteDBConnection, type SQLiteConnection } from "@capacitor-community/sqlite";
import { Capacitor } from "@capacitor/core";

import { isNativeMobile } from "../mobile/runtime";
import { mobileSqlite } from "../data/native-sqlite";

const PROBE_DATABASE = "autorepair-mobile-probe";
const PROBE_VERSION = 1;
const FIXED_ISO = "2026-09-15T08:09:10.123Z";
const FIXED_UNICODE = "张三｜粤A12345｜更换机油";

export type ProbeStep = { name: string; passed: true; detail: string };
export type ProbeResult = {
  passed: number;
  total: number;
  priorRunPersisted: boolean;
  steps: ProbeStep[];
};

let startupProbe: Promise<ProbeResult> | null = null;

export function runNativeSqliteProbeOnce(): Promise<ProbeResult> {
  startupProbe ??= runNativeSqliteProbe();
  return startupProbe;
}

type ProbeRow = {
  id: string;
  label: string;
  iso_text: string;
  decimal_text: string;
};

export async function runNativeSqliteProbe(): Promise<ProbeResult> {
  if (!isNativeMobile()) {
    throw new Error("Native SQLite unavailable in browser development mode");
  }

  const sqlite = mobileSqlite;
  const steps: ProbeStep[] = [];
  const pass = (name: string, detail: string) => steps.push({ name, detail, passed: true });
  let db: SQLiteDBConnection | null = null;
  let transactionActive = false;

  try {
    assert(Capacitor.getPlatform() === "android", "探针未运行在 Android 平台");
    assert(Capacitor.isNativePlatform(), "探针未通过 Capacitor Native Bridge 运行");
    pass("Capacitor Native Android Bridge", "platform=android; native=true");

    db = await connect(sqlite);
    pass("创建并打开数据库", PROBE_DATABASE);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS probe_records (
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL,
        iso_text TEXT NOT NULL,
        decimal_text TEXT NOT NULL
      );
    `);
    pass("创建数据表", "probe_records");

    const prior = await queryRows(db, "SELECT * FROM probe_records WHERE id = ?", ["persistent"]);
    const priorRunPersisted = prior.length === 1;

    await db.run("DELETE FROM probe_records WHERE id <> ?", ["persistent"]);
    await db.run(
      "INSERT OR REPLACE INTO probe_records (id, label, iso_text, decimal_text) VALUES (?, ?, ?, ?)",
      ["roundtrip", FIXED_UNICODE, FIXED_ISO, "0.01"],
    );
    pass("参数绑定", "4 个 TEXT 参数");
    pass("INSERT", "roundtrip");

    let rows = await queryRows(db, "SELECT * FROM probe_records WHERE id = ?", ["roundtrip"]);
    assert(rows.length === 1, "SELECT 未返回刚写入的数据");
    pass("SELECT", "1 row");
    assert(rows[0]?.label === FIXED_UNICODE, "中文 round-trip 不一致");
    pass("中文 round-trip", rows[0].label);
    assert(rows[0]?.iso_text === FIXED_ISO, "ISO 时间字符串 round-trip 不一致");
    pass("ISO string round-trip", rows[0].iso_text);
    assert(rows[0]?.decimal_text === "0.01", "Decimal 0.01 round-trip 不一致");
    pass("Decimal TEXT 0.01", rows[0].decimal_text);

    await db.run("UPDATE probe_records SET decimal_text = ? WHERE id = ?", ["1.10", "roundtrip"]);
    rows = await queryRows(db, "SELECT * FROM probe_records WHERE id = ?", ["roundtrip"]);
    assert(rows[0]?.decimal_text === "1.10", "UPDATE 或 Decimal 1.10 round-trip 失败");
    pass("UPDATE", "roundtrip.decimal_text");
    pass("Decimal TEXT 1.10", rows[0].decimal_text);

    await db.run(
      "INSERT OR REPLACE INTO probe_records (id, label, iso_text, decimal_text) VALUES (?, ?, ?, ?)",
      ["delete-me", "待删除", FIXED_ISO, "0.01"],
    );
    await db.run("DELETE FROM probe_records WHERE id = ?", ["delete-me"]);
    rows = await queryRows(db, "SELECT * FROM probe_records WHERE id = ?", ["delete-me"]);
    assert(rows.length === 0, "DELETE 后数据仍存在");
    pass("DELETE", "delete-me");

    await db.beginTransaction();
    transactionActive = true;
    await db.run(
      "INSERT OR REPLACE INTO probe_records (id, label, iso_text, decimal_text) VALUES (?, ?, ?, ?)",
      ["committed", "事务已提交", FIXED_ISO, "99999999.99"],
      false,
    );
    await db.commitTransaction();
    transactionActive = false;
    rows = await queryRows(db, "SELECT * FROM probe_records WHERE id = ?", ["committed"]);
    assert(rows.length === 1, "COMMIT 后数据不存在");
    pass("transaction commit", "committed");
    assert(rows[0]?.decimal_text === "99999999.99", "大额 Decimal TEXT round-trip 不一致");
    pass("Decimal TEXT 99999999.99", rows[0].decimal_text);

    await db.beginTransaction();
    transactionActive = true;
    await db.run(
      "INSERT INTO probe_records (id, label, iso_text, decimal_text) VALUES (?, ?, ?, ?)",
      ["rolled-back", "不应保留", FIXED_ISO, "0.01"],
      false,
    );
    await db.rollbackTransaction();
    transactionActive = false;
    rows = await queryRows(db, "SELECT * FROM probe_records WHERE id = ?", ["rolled-back"]);
    assert(rows.length === 0, "ROLLBACK 后数据仍存在");
    pass("transaction rollback", "rolled-back absent");

    await db.run(
      "INSERT OR REPLACE INTO probe_records (id, label, iso_text, decimal_text) VALUES (?, ?, ?, ?)",
      ["persistent", "跨启动保留", new Date().toISOString(), "1.10"],
    );

    await db.close();
    await sqlite.closeConnection(PROBE_DATABASE, false);
    db = null;
    pass("关闭数据库", "connection released");

    db = await connect(sqlite);
    pass("重新打开数据库", "new connection");
    rows = await queryRows(db, "SELECT * FROM probe_records WHERE id IN (?, ?) ORDER BY id", [
      "committed",
      "persistent",
    ]);
    assert(rows.length === 2, "close/reopen 后持久化数据不完整");
    pass("持久化", "commit 与跨启动标记均存在");

    console.info(
      `[mobile:sqlite-probe] ${steps.length}/${steps.length} platform=${Capacitor.getPlatform()} native=${Capacitor.isNativePlatform()} priorRunPersisted=${priorRunPersisted}`,
    );
    return { passed: steps.length, total: steps.length, priorRunPersisted, steps };
  } catch (error) {
    if (transactionActive && db) {
      await db.rollbackTransaction().catch(() => undefined);
    }
    throw error;
  } finally {
    if (db) {
      await db.close().catch(() => undefined);
      await sqlite.closeConnection(PROBE_DATABASE, false).catch(() => undefined);
    }
  }
}

export async function deleteNativeSqliteProbe(): Promise<void> {
  if (!isNativeMobile()) {
    throw new Error("Native SQLite unavailable in browser development mode");
  }
  const sqlite = mobileSqlite;
  const db = await connect(sqlite);
  await db.close();
  await db.delete();
  await sqlite.closeConnection(PROBE_DATABASE, false).catch(() => undefined);
}

async function connect(sqlite: SQLiteConnection): Promise<SQLiteDBConnection> {
  await sqlite.checkConnectionsConsistency();
  const existing = await sqlite.isConnection(PROBE_DATABASE, false);
  const db = existing.result
    ? await sqlite.retrieveConnection(PROBE_DATABASE, false)
    : await sqlite.createConnection(PROBE_DATABASE, false, "no-encryption", PROBE_VERSION, false);
  const open = await db.isDBOpen();
  if (!open.result) await db.open();
  return db;
}

async function queryRows(
  db: SQLiteDBConnection,
  statement: string,
  values: string[],
): Promise<ProbeRow[]> {
  const result = await db.query(statement, values);
  return (result.values ?? []) as ProbeRow[];
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
