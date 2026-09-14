/**
 * 存储模式解析 —— 全应用唯一的「存储实现选择」依据
 * ---------------------------------------------------------------------------
 * 规则（阶段 2 Step 2 规范）：
 * - APP_STORAGE 未设置 → "postgres"（保持既有行为，pnpm dev 不能被这次改造改变）
 * - APP_STORAGE=postgres / sqlite → 对应模式
 * - 其他任何值 → 启动时立即抛错，绝不静默 fallback 到 postgres
 *
 * 本文件不 import "server-only"：验证脚本需要单独复用 resolveStorageKind()。
 */

export type StorageKind = "postgres" | "sqlite";

const VALID_KINDS: readonly StorageKind[] = ["postgres", "sqlite"] as const;

export function isStorageKind(value: string): value is StorageKind {
  return (VALID_KINDS as readonly string[]).includes(value);
}

/** 解析 APP_STORAGE；非法值直接抛错（含两个合法值，便于纠正） */
export function resolveStorageKind(env: string | undefined): StorageKind {
  if (env === undefined || env === "") return "postgres";
  if (isStorageKind(env)) return env;
  throw new Error(
    `Invalid APP_STORAGE value: "${env}".\nExpected ${VALID_KINDS.map((k) => `"${k}"`).join(" or ")}.`,
  );
}

/** 存储元信息（日志与运维排查用；database 仅 SQLite 模式有值） */
export interface StorageInfo {
  kind: StorageKind;
  /** 存储引擎标识：装配的是哪套实现（不是环境变量字符串） */
  engine: "prisma-postgresql" | "node-sqlite";
  /** SQLite 数据文件绝对路径；postgres 模式为 null（连接串在 env，不在此泄露） */
  database: string | null;
}

export function storageInfoOf(kind: StorageKind, database: string | null): StorageInfo {
  return {
    kind,
    engine: kind === "postgres" ? "prisma-postgresql" : "node-sqlite",
    database,
  };
}
