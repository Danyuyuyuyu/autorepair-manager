import { randomBytes } from "node:crypto";

/**
 * ID 生成（cuid 风格）
 * ---------------------------------------------------------------------------
 * PostgreSQL 模式下由 Prisma 的 @default(cuid()) 生成；SQLite 模式由本模块接手。
 * 只要求「全局唯一 + 时间可排序」，不要求与 cuid 完全同构 —— 数据迁移时
 * 原 ID 原样保留（见阶段 2 规范：迁移不得重新生成 ID），新 ID 只要唯一即可。
 *
 * 形如 `cm1abc123def4`：小写字母开头 + 毫秒时间戳(base36) + 随机熵，25 字符内。
 */
export function newId(): string {
  const time = Date.now().toString(36);
  const rand = randomBytes(8).toString("hex");
  return `c${time}${rand}`;
}
