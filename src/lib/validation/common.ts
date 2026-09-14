import Decimal from "decimal.js";
import { z } from "zod";

/** 通用校验片段 —— 服务端与客户端共用 */

export const idField = z.string().trim().min(1, "缺少必要的 ID");

export const optionalIdField = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

/** 手机号：11 位手机号或 6-20 位含分隔符的固话 */
export const phoneField = z
  .string()
  .trim()
  .regex(/^(1[3-9]\d{9}|0\d{2,3}-?\d{7,8}|\d{7,20})$/, "请输入正确的手机号");

export const plateNumberField = z
  .string()
  .trim()
  .min(2, "请输入车牌号")
  .max(20, "车牌号过长")
  .transform((v) => v.toUpperCase().replace(/\s+/g, ""));

export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `最多 ${max} 个字符`)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

export const requiredText = (max = 200, label = "该项") =>
  z.string().trim().min(1, `请填写${label}`).max(max, `最多 ${max} 个字符`);

/** 金额：接受字符串或数字，统一输出「两位小数的字符串」 */
export const moneyField = (options?: { max?: number; allowNegative?: boolean }) => {
  const max = options?.max ?? 99_999_999.99;
  let schema = z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => v === "" || /^-?\d+(\.\d{1,2})?$/.test(v), "请输入合法金额（最多两位小数）")
    .refine((v) => {
      if (v === "") return true;
      const n = new Decimal(v);
      return options?.allowNegative ? true : n.gte(0);
    }, "金额不能为负数")
    .refine((v) => v === "" || new Decimal(v).abs().lte(max), `金额不能超过 ${max}`);

  schema = schema.transform((v) =>
    new Decimal(v === "" ? 0 : v).toDecimalPlaces(2).toFixed(2),
  ) as never;
  return schema as unknown as z.ZodType<string>;
};

/** 数量：必须大于 0，最多两位小数 */
export const quantityField = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "请输入合法数量（最多两位小数）")
  .refine((v) => new Decimal(v).gt(0), "数量必须大于 0")
  .refine((v) => new Decimal(v).lte(999_999.99), "数量超出上限")
  .transform((v) => new Decimal(v).toDecimalPlaces(2).toFixed(2));

/** 非负数量（用于盘点，允许为 0） */
export const nonNegativeQuantityField = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "请输入合法数量（最多两位小数）")
  .transform((v) => new Decimal(v).toDecimalPlaces(2).toFixed(2));

export const intField = (options?: { min?: number; max?: number }) =>
  z.coerce
    .number()
    .int("请输入整数")
    .min(options?.min ?? 0, `不能小于 ${options?.min ?? 0}`)
    .max(options?.max ?? 9_999_999, `不能大于 ${options?.max ?? 9_999_999}`);

export const optionalIntField = (options?: { min?: number; max?: number }) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    intField(options).optional(),
  );

/** yyyy-MM-dd 或 ISO 字符串 -> Date */
export const dateField = z
  .union([z.string(), z.date()])
  .transform((v) => (typeof v === "string" ? new Date(v.length === 10 ? `${v}T00:00:00` : v) : v))
  .refine((d) => !Number.isNaN(d.getTime()), "日期格式不正确")
  .refine((d) => d.getTime() <= Date.now() + 365 * 24 * 3600 * 1000, "日期超出合理范围");

export const optionalDateField = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : v),
  dateField.optional(),
);

/** 列表查询通用参数 */
export const listQuerySchema = z.object({
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const dateRangeSchema = z.object({
  from: dateField,
  to: dateField,
});

export const sortOrderField = z.enum(["asc", "desc"]).default("desc");

/** 用于「可空字符串」表单字段（空串统一转 null） */
export const nullableText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `最多 ${max} 个字符`)
    .transform((v) => (v === "" ? "" : v));
