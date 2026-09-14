import { z } from "zod";

import {
  idField,
  intField,
  moneyField,
  optionalIdField,
  optionalIntField,
  optionalText,
  plateNumberField,
  quantityField,
  requiredText,
} from "@/lib/validation/common";

export const workOrderItemSchema = z.object({
  id: optionalIdField,
  type: z.enum(["SERVICE", "PART", "LABOR", "OTHER"]),
  itemRefId: optionalIdField,
  name: requiredText(100, "名称"),
  spec: optionalText(100),
  unit: optionalText(16),
  quantity: quantityField,
  unitPrice: moneyField(),
  costPrice: moneyField().optional(),
  remark: optionalText(200),
});

/** 创建工单（支持「客户 / 车辆」二选一：已有客户 或 现场新建） */
export const createWorkOrderSchema = z.object({
  customerId: z.string().trim().optional(),
  vehicleId: z.string().trim().optional(),

  // 现场快速建档
  newCustomerName: optionalText(32),
  newCustomerPhone: optionalText(20),
  newVehiclePlate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toUpperCase().replace(/\s+/g, "") : undefined)),
  newVehicleBrand: optionalText(32),
  newVehicleModel: optionalText(64),
  newVehicleMileage: optionalIntField({ min: 0, max: 2_000_000 }),

  plateNumber: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toUpperCase().replace(/\s+/g, "") : undefined)),

  mileage: optionalIntField({ min: 0, max: 2_000_000 }),
  faultDescription: optionalText(1000),
  remark: optionalText(1000),
  technicianId: optionalIdField,
  discountAmount: moneyField().default("0.00"),
  items: z.array(workOrderItemSchema).default([]),
});

export const updateWorkOrderSchema = z.object({
  id: idField,
  mileage: optionalIntField({ min: 0, max: 2_000_000 }),
  faultDescription: optionalText(1000),
  remark: optionalText(1000),
  technicianId: optionalIdField,
  discountAmount: moneyField(),
});

export const changeStatusSchema = z.object({
  id: idField,
  status: z.enum([
    "PENDING_INTAKE",
    "IN_PROGRESS",
    "PENDING_QC",
    "PENDING_PAYMENT",
    "COMPLETED",
    "CANCELLED",
  ]),
  reason: optionalText(200),
  /** 完工时同步里程 */
  mileage: optionalIntField({ min: 0, max: 2_000_000 }),
  /** 完工时是否自动生成保养记录 */
  createServiceRecord: z.coerce.boolean().default(false),
  serviceDescription: optionalText(200),
  nextServiceAt: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.date().optional(),
  ),
  nextServiceMileage: optionalIntField({ min: 0, max: 2_000_000 }),
});

export const workOrderListQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z
    .enum([
      "ALL",
      "PENDING_INTAKE",
      "IN_PROGRESS",
      "PENDING_QC",
      "PENDING_PAYMENT",
      "COMPLETED",
      "CANCELLED",
      "UNPAID",
    ])
    .default("ALL"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  customerId: z.string().trim().optional(),
  vehicleId: z.string().trim().optional(),
});

export const paymentSchema = z.object({
  workOrderId: optionalIdField,
  customerId: optionalIdField,
  amount: moneyField(),
  method: z.enum(["CASH", "WECHAT", "ALIPAY", "BANK_CARD", "OTHER"]),
  category: z.enum(["REPAIR_SERVICE", "PART_SALE", "LABOR", "OTHER"]).default("REPAIR_SERVICE"),
  occurredAt: z.coerce.date().default(() => new Date()),
  remark: optionalText(200),
});

export const expenseSchema = z.object({
  category: z.enum([
    "PART_PURCHASE",
    "RENT",
    "UTILITY",
    "SALARY",
    "TOOL_EQUIPMENT",
    "LOGISTICS",
    "OTHER",
  ]),
  amount: moneyField(),
  method: z.enum(["CASH", "WECHAT", "ALIPAY", "BANK_CARD", "OTHER"]),
  occurredAt: z.coerce.date().default(() => new Date()),
  supplierId: optionalIdField,
  workOrderId: optionalIdField,
  remark: optionalText(200),
});

/** 工单列表卡片上直接改优惠（高频操作） */
export const quickDiscountSchema = z.object({
  id: idField,
  discountAmount: moneyField(),
});

export const generateOrderNoFromPlate = z.object({ plateNumber: plateNumberField });

export const technicianAssignSchema = z.object({
  id: idField,
  technicianId: optionalIdField,
});

export const quickMileageSchema = z.object({
  id: idField,
  mileage: intField({ min: 0, max: 2_000_000 }),
});
