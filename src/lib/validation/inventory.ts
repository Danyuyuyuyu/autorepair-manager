import { z } from "zod";

import {
  moneyField,
  nonNegativeQuantityField,
  optionalIdField,
  optionalText,
  quantityField,
  requiredText,
} from "@/lib/validation/common";

export const partSchema = z.object({
  code: optionalText(32),
  name: requiredText(64, "配件名称"),
  spec: optionalText(64),
  brand: optionalText(32),
  unit: z.string().trim().min(1, "请填写单位").max(8).default("个"),
  categoryId: optionalIdField,
  supplierId: optionalIdField,
  costPrice: moneyField(),
  salePrice: moneyField(),
  safeQuantity: nonNegativeQuantityField.default("0.00"),
  location: optionalText(32),
  remark: optionalText(200),
  /** 建档时可选直接录入期初库存 */
  initialQuantity: nonNegativeQuantityField.optional(),
});

export const purchaseInSchema = z.object({
  partId: z.string().min(1, "请选择配件"),
  quantity: quantityField,
  unitCost: moneyField(),
  /** 是否同步更新配件档案的最近进货价 */
  updateCostPrice: z.coerce.boolean().default(true),
  supplierId: optionalIdField,
  occurredAt: z.coerce.date().default(() => new Date()),
  remark: optionalText(200),
});

export const adjustStockSchema = z.object({
  partId: z.string().min(1, "请选择配件"),
  /** 调整后的目标库存（盘点口径，避免正负号歧义） */
  targetQuantity: nonNegativeQuantityField,
  unitCost: moneyField().optional(),
  remark: requiredText(200, "调整原因"),
});

export const stocktakeItemSchema = z.object({
  partId: z.string().min(1),
  countedQuantity: nonNegativeQuantityField,
});

export const stocktakeSchema = z.object({
  items: z.array(stocktakeItemSchema).min(1, "请填写至少一项盘点结果"),
  remark: optionalText(200),
});

export const inventoryQuerySchema = z.object({
  q: z.string().trim().optional(),
  categoryId: z.string().trim().optional(),
  /** all | low | zero */
  stock: z.enum(["all", "low", "zero"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const supplierSchema = z.object({
  name: requiredText(64, "供应商名称"),
  contact: optionalText(32),
  phone: optionalText(20),
  address: optionalText(200),
  remark: optionalText(200),
});

export const serviceItemSchema = z.object({
  code: optionalText(32),
  name: requiredText(64, "项目名称"),
  kind: z.enum(["SERVICE", "LABOR"]).default("SERVICE"),
  categoryId: optionalIdField,
  unit: z.string().trim().min(1).max(8).default("项"),
  defaultPrice: moneyField(),
  defaultHours: moneyField().optional(),
  costPrice: moneyField(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  remark: optionalText(200),
});

export const categorySchema = z.object({
  name: requiredText(32, "分类名称"),
  kind: z.enum(["PART", "SERVICE", "EXPENSE", "INCOME"]),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});
