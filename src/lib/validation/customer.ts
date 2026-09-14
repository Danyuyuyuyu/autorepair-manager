import { z } from "zod";

import {
  optionalIntField,
  optionalText,
  phoneField,
  plateNumberField,
  requiredText,
} from "@/lib/validation/common";

export const customerSchema = z.object({
  name: requiredText(32, "客户姓名"),
  phone: phoneField,
  wechat: optionalText(64),
  address: optionalText(200),
  remark: optionalText(500),
});

export const vehicleSchema = z.object({
  customerId: z.string().min(1, "请选择所属客户"),
  plateNumber: plateNumberField,
  brand: optionalText(32),
  model: optionalText(64),
  year: optionalIntField({ min: 1950, max: 2100 }),
  vin: optionalText(32),
  engineNo: optionalText(32),
  currentMileage: optionalIntField({ min: 0, max: 2_000_000 }),
  lastServiceAt: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.date().optional(),
  ),
  nextServiceAt: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.date().optional(),
  ),
  remark: optionalText(500),
});

/** 新建车辆时可同时创建客户（一步到位，减少操作层级） */
export const vehicleWithCustomerSchema = vehicleSchema.extend({
  customerId: z.string().trim().optional(),
  newCustomerName: optionalText(32),
  newCustomerPhone: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || /^(1[3-9]\d{9}|0\d{2,3}-?\d{7,8}|\d{7,20})$/.test(v),
      "请输入正确的手机号",
    ),
});

/** 保养记录 */
export const serviceRecordSchema = z.object({
  vehicleId: z.string().min(1),
  servicedAt: z.coerce.date(),
  mileage: optionalIntField({ min: 0, max: 2_000_000 }),
  description: requiredText(200, "保养内容"),
  nextServiceAt: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.date().optional(),
  ),
  nextServiceMileage: optionalIntField({ min: 0, max: 2_000_000 }),
});
