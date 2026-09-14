/**
 * 备份服务（PC 端 SQLite）
 * ---------------------------------------------------------------------------
 * 设计要点：
 * 1. **不使用文件复制**。SQLite 处于 WAL 模式时，`autorepair.db` 单独复制出来是
 *    不完整的（最近的提交还在 `-wal` 里）。本服务使用 SQLite Online Backup API
 *    （`node:sqlite` 的 `backup()`），它跨页读取源库，产出一个**单一、完整、一致**
 *    的文件，且备份过程中源库仍可正常读写（其他连接的写入会让备份自动重跑）。
 * 2. **创建即校验**。备份完成后立刻 `PRAGMA integrity_check` + `PRAGMA foreign_key_check`
 *    + 业务表齐备 + schema_version；任何一项不过 → 删除该文件并抛错，绝不把坏备份
 *    标记为成功。
 * 3. **恢复永不直接覆盖**。恢复前自动生成 `-prerestore` 备份；替换主库时先把当前库
 *    移到一边；恢复后立即校验；任何一步失败都回滚到恢复前状态。
 * 4. **恢复需要独占主库**。调用方通过 `closeDatabase` / `reopenDatabase` 注入
 *    主库连接的关闭与重开（应用里接的是 sqlite client 的单例；CLI 里是同一个函数）。
 *    若服务仍在运行并持有连接，Windows 上文件替换会失败 —— 这是有意暴露的错误，
 *    而不是静默产生一个半恢复的库。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import { backup as backupDatabase, DatabaseSync } from "node:sqlite";

import { SQLITE_BUSINESS_TABLES, SQLITE_VERSION_TABLE } from "@/server/repos/sqlite/schema-tables";

export const DEFAULT_BACKUP_RETENTION = 30;
export const BACKUP_FILE_PREFIX = "autorepair-";

/** autorepair-YYYYMMDD-HHMMSS.db / ...-2.db / ...-HHMMSS-prerestore.db */
const BACKUP_FILE_PATTERN = /^autorepair-(\d{8})-(\d{6})(?:-(\d+))?(-prerestore)?\.db$/;

export type BackupReason = "manual" | "daily" | "pre-migration" | "pre-restore";

export interface BackupInfo {
  path: string;
  fileName: string;
  /** 名称中的时间戳（本地时间，ISO 输出） */
  createdAt: string;
  /** 同一秒内的第几份（0 = 无后缀），用于同秒备份的稳定排序 */
  sequence: number;
  sizeBytes: number;
  isPreRestore: boolean;
}

export interface BackupVerification {
  path: string;
  ok: boolean;
  integrity: string;
  foreignKeyViolations: number;
  schemaVersion: number;
  missingTables: string[];
  error?: string;
}

export interface RestoreResult {
  restored: BackupInfo;
  /** 恢复前的当前库备份（恢复前主库不存在时为 null） */
  preRestore: BackupInfo | null;
  verification: BackupVerification;
}

export interface BackupServiceOptions {
  /** 主数据库文件绝对路径 */
  databasePath: string;
  /** 备份目录（默认 %LOCALAPPDATA%\AutoRepairManager\backups） */
  backupDir: string;
  /** 保留最近 N 份（默认 30） */
  retention?: number;
  now?: () => Date;
  /** 恢复前释放主库连接 */
  closeDatabase?: () => void;
  /** 恢复后重新打开主库（应包含 migration，保证旧备份也能被推进到最新 schema） */
  reopenDatabase?: () => void;
}

export interface BackupService {
  createBackup(reason?: BackupReason): Promise<BackupInfo>;
  listBackups(): Promise<BackupInfo[]>;
  verifyBackup(path: string): Promise<BackupVerification>;
  restoreBackup(path: string): Promise<RestoreResult>;
  pruneOldBackups(): Promise<string[]>;
  /** 当天还没有普通备份时才创建（供启动时/计划任务调用） */
  maybeCreateDailyBackup(): Promise<BackupInfo | null>;
}

// ---------------------------------------------------------------------------
// 配置解析（service 与配置项可用即可，第一版不为此改 UI）
// ---------------------------------------------------------------------------

export function resolveBackupDir(): string {
  const override = process.env.AUTOREPAIR_BACKUP_DIR;
  if (override) return override;
  const localAppData =
    process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? process.cwd(), "AppData", "Local");
  return join(localAppData, "AutoRepairManager", "backups");
}

export function resolveBackupRetention(): number {
  const raw = process.env.AUTOREPAIR_BACKUP_RETENTION;
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BACKUP_RETENTION;
}

// ---------------------------------------------------------------------------
// 文件名与信息
// ---------------------------------------------------------------------------

function stampParts(date: Date): { date: string; time: string } {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return {
    date: `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    time: `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  };
}

function parseBackupName(
  fileName: string,
): { createdAt: Date; sequence: number; isPreRestore: boolean } | null {
  const match = BACKUP_FILE_PATTERN.exec(fileName);
  if (!match) return null;
  const date = match[1] ?? "";
  const time = match[2] ?? "";
  const sequence = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  const createdAt = new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  );
  return { createdAt, sequence, isPreRestore: Boolean(match[4]) };
}

function infoOf(path: string): BackupInfo {
  const fileName = basename(path);
  const parsed = parseBackupName(fileName);
  return {
    path,
    fileName,
    createdAt: (parsed?.createdAt ?? new Date(statSync(path).mtimeMs)).toISOString(),
    sequence: parsed?.sequence ?? 0,
    sizeBytes: statSync(path).size,
    isPreRestore: parsed?.isPreRestore ?? false,
  };
}

// ---------------------------------------------------------------------------
// 校验（同步实现，创建/恢复/CLI 共用）
// ---------------------------------------------------------------------------

function openReadOnly(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

function verifyFile(path: string): BackupVerification {
  const base: BackupVerification = {
    path,
    ok: false,
    integrity: "n/a",
    foreignKeyViolations: -1,
    schemaVersion: 0,
    missingTables: [...SQLITE_BUSINESS_TABLES],
  };
  if (!existsSync(path)) return { ...base, error: "备份文件不存在" };

  let db: DatabaseSync | null = null;
  try {
    db = openReadOnly(path);
    const integrityRow = db.prepare("PRAGMA integrity_check").get() as
      { integrity_check?: string } | undefined;
    const integrity = integrityRow?.integrity_check ?? "unknown";
    const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all().length;
    const present = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    const missingTables = SQLITE_BUSINESS_TABLES.filter((table) => !present.has(table));
    let schemaVersion = 0;
    if (present.has(SQLITE_VERSION_TABLE)) {
      const row = db.prepare(`SELECT MAX(version) AS v FROM ${SQLITE_VERSION_TABLE}`).get() as
        { v: number | null } | undefined;
      schemaVersion = Number(row?.v ?? 0);
    }
    const ok =
      integrity === "ok" &&
      foreignKeyViolations === 0 &&
      missingTables.length === 0 &&
      schemaVersion >= 1;
    return { path, ok, integrity, foreignKeyViolations, schemaVersion, missingTables };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  } finally {
    db?.close();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 清掉校验过程在**备份文件**旁留下的 `-wal` / `-shm`。
 *
 * 只读打开一个 WAL 模式的库时 SQLite 会建 shm 索引（以及空的 wal），于是备份目录
 * 里会多出两个伴生文件 —— 备份本身仍是单一完整文件，但目录会被看脏、手工拷贝时
 * 也容易误判。主库的 WAL 可能含未合并的提交，**绝不在清理范围内**。
 */
function cleanupSidecars(path: string, databasePath: string): void {
  if (path === databasePath) return;
  try {
    const wal = `${path}-wal`;
    const shm = `${path}-shm`;
    if (existsSync(wal) && statSync(wal).size === 0) rmSync(wal, { force: true });
    if (existsSync(shm)) rmSync(shm, { force: true });
  } catch {
    // 尽力而为：清理失败不影响备份结果
  }
}

/** 校验结果 → 人类可读的一行（不过时不抛错） */
function describeVerification(result: BackupVerification): string {
  if (result.ok) {
    return `integrity=ok fk=0 schema=v${result.schemaVersion}`;
  }
  const parts = [
    `integrity=${result.integrity}`,
    `fk=${result.foreignKeyViolations}`,
    `schema=v${result.schemaVersion}`,
  ];
  if (result.missingTables.length > 0) parts.push(`missing=${result.missingTables.join("/")}`);
  if (result.error) parts.push(`error=${result.error}`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export function createBackupService(options: BackupServiceOptions): BackupService {
  const databasePath = options.databasePath;
  const backupDir = options.backupDir;
  const retention = options.retention ?? DEFAULT_BACKUP_RETENTION;
  const now = options.now ?? (() => new Date());

  function nextFileName(preRestore: boolean): string {
    const { date, time } = stampParts(now());
    const suffix = preRestore ? "-prerestore" : "";
    for (let sequence = 0; sequence < 1000; sequence += 1) {
      const name =
        sequence === 0
          ? `${BACKUP_FILE_PREFIX}${date}-${time}${suffix}.db`
          : `${BACKUP_FILE_PREFIX}${date}-${time}-${sequence}${suffix}.db`;
      if (!existsSync(join(backupDir, name))) return name;
    }
    throw new Error("同一秒内备份次数过多，无法生成唯一备份文件名");
  }

  async function listBackups(): Promise<BackupInfo[]> {
    if (!existsSync(backupDir)) return [];
    return readdirSync(backupDir)
      .filter((name) => BACKUP_FILE_PATTERN.test(name))
      .map((name) => join(backupDir, name))
      .filter((path) => existsSync(path))
      .map((path) => infoOf(path))
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? b.sequence - a.sequence
          : b.createdAt.localeCompare(a.createdAt),
      );
  }

  async function pruneOldBackups(): Promise<string[]> {
    const all = await listBackups();
    const excess = all.slice(retention);
    for (const item of excess) rmSync(item.path, { force: true });
    return excess.map((item) => item.fileName);
  }

  async function createBackup(reason: BackupReason = "manual"): Promise<BackupInfo> {
    if (!existsSync(databasePath)) {
      throw new Error(`主数据库不存在，无法备份：${databasePath}`);
    }
    mkdirSync(backupDir, { recursive: true });

    const fileName = nextFileName(reason === "pre-restore");
    const target = join(backupDir, fileName);
    rmSync(target, { force: true });

    // 独立只读连接：不依赖应用缓存的连接，WAL 中已提交的内容会一并进入快照
    const source = new DatabaseSync(databasePath, { readOnly: true });
    try {
      source.exec("PRAGMA busy_timeout = 5000;");
      await backupDatabase(source, target);
    } finally {
      source.close();
    }

    const verification = verifyFile(target);
    cleanupSidecars(target, databasePath);
    if (!verification.ok) {
      rmSync(target, { force: true });
      throw new Error(`备份未通过完整性校验，已丢弃：${describeVerification(verification)}`);
    }

    const info = infoOf(target);
    const removed = await pruneOldBackups();
    console.info(
      `[backup] 已创建 ${info.fileName}（${reason}，${info.sizeBytes} 字节）${removed.length > 0 ? `，按保留策略删除 ${removed.length} 份旧备份` : ""}`,
    );
    return info;
  }

  async function verifyBackup(path: string): Promise<BackupVerification> {
    const result = verifyFile(path);
    cleanupSidecars(path, databasePath);
    return result;
  }

  async function maybeCreateDailyBackup(): Promise<BackupInfo | null> {
    const today = stampParts(now()).date;
    const existing = (await listBackups()).find(
      (item) => !item.isPreRestore && stampParts(new Date(item.createdAt)).date === today,
    );
    if (existing) return null;
    return createBackup("daily");
  }

  async function restoreBackup(backupPath: string): Promise<RestoreResult> {
    const verification = verifyFile(backupPath);
    cleanupSidecars(backupPath, databasePath);
    if (!verification.ok) {
      throw new Error(`备份未通过完整性校验，拒绝恢复：${describeVerification(verification)}`);
    }

    let preRestore: BackupInfo | null = null;
    if (existsSync(databasePath)) {
      preRestore = await createBackup("pre-restore");
    }

    options.closeDatabase?.();

    const walPath = `${databasePath}-wal`;
    const shmPath = `${databasePath}-shm`;
    const asidePath = `${databasePath}.restoring`;

    try {
      rmSync(asidePath, { force: true });
      if (existsSync(databasePath)) renameSync(databasePath, asidePath);
      rmSync(walPath, { force: true });
      rmSync(shmPath, { force: true });

      copyFileSync(backupPath, databasePath);

      // 备份文件自带完整内容，不存在 wal；删除任何残留，避免旧 WAL 被套用到新库
      rmSync(walPath, { force: true });
      rmSync(shmPath, { force: true });

      const live = verifyFile(databasePath);
      if (!live.ok) {
        throw new Error(`恢复后的主库未通过校验：${describeVerification(live)}`);
      }

      // 重开连接（含 migration）也属于恢复的一部分：失败同样要回滚
      options.reopenDatabase?.();

      rmSync(asidePath, { force: true });
      const info = infoOf(backupPath);
      const removed = await pruneOldBackups();
      console.info(
        `[backup] 已从 ${info.fileName} 恢复${preRestore ? `（恢复前库已备份为 ${preRestore.fileName}）` : ""}${removed.length > 0 ? `，按保留策略删除 ${removed.length} 份旧备份` : ""}`,
      );
      return { restored: info, preRestore, verification: live };
    } catch (error) {
      // 回滚：丢掉半恢复的主库，把恢复前的库放回去并重开
      rmSync(databasePath, { force: true });
      rmSync(walPath, { force: true });
      rmSync(shmPath, { force: true });
      if (existsSync(asidePath)) renameSync(asidePath, databasePath);
      try {
        options.reopenDatabase?.();
      } catch {
        // 回滚路上的重开失败不再覆盖原始错误
      }
      throw new Error(`恢复失败，已回滚到恢复前状态：${messageOf(error)}`);
    }
  }

  return {
    createBackup,
    listBackups,
    verifyBackup,
    restoreBackup,
    pruneOldBackups,
    maybeCreateDailyBackup,
  };
}
