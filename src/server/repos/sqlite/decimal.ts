import { D, type DecimalInput } from "@/lib/money";
import type { Decimal } from "decimal.js";

/**
 * SQLite 金额/数量存取转换
 * ---------------------------------------------------------------------------
 * SQLite 没有十进制类型，REAL（IEEE 754 浮点）无法保证精确 round-trip
 * （99999999.99 存成 REAL 读回是 99999999.98999786…）。
 * 因此本项目的 SQLite schema 把所有 Decimal 列定义为 TEXT，存规范十进制字符串。
 *
 * 规则：
 * - 写入：领域 Decimal → `toFixed(2)` 规范字符串（与 PostgreSQL Decimal(14,2)
 *   / Decimal(12,2) 的定标语义一致，超出 2 位由领域层 money()/qty() 先归一化）
 * - 读取：TEXT → decimal.js Decimal，逐字符精确，无任何浮点参与
 * - NULL 语义与 Prisma 列一致（可空列传 null）
 */

/** 领域 Decimal → 库内规范字符串（"1234.56"）；null/undefined → NULL */
export function toDbDecimal(value: DecimalInput | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return D(value).toFixed(2);
}

/** 非空版本：列 NOT NULL 时使用（null 一律按 0 处理，与 D() 的空值语义一致） */
export function toDbDecimalOrZero(value: DecimalInput | null | undefined): string {
  return D(value).toFixed(2);
}

/** 库内字符串 → 领域 Decimal；NULL → null */
export function fromDbDecimal(raw: string | null | undefined): Decimal | null {
  if (raw === null || raw === undefined) return null;
  return D(raw);
}

/** 非空版本：列 NOT NULL 时使用 */
export function fromDbDecimalOrZero(raw: string | null | undefined): Decimal {
  return D(raw ?? "0");
}
