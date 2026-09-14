import { z } from "zod";

import { optionalText, phoneField, requiredText } from "@/lib/validation/common";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "请输入账号"),
  password: z.string().min(1, "请输入密码"),
});

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "账号至少 3 位")
    .max(32, "账号最多 32 位")
    .regex(/^[a-zA-Z0-9_.-]+$/, "账号只能包含字母、数字、_ . -"),
  name: requiredText(32, "姓名"),
  phone: optionalText(20),
  password: z.string().min(8, "密码至少 8 位").max(72, "密码过长"),
  role: z.enum(["ADMIN", "STAFF"]),
});

export const updateUserSchema = z.object({
  id: z.string().min(1),
  name: requiredText(32, "姓名"),
  phone: optionalText(20),
  role: z.enum(["ADMIN", "STAFF"]),
  isActive: z.coerce.boolean(),
});

export const resetPasswordSchema = z.object({
  id: z.string().min(1),
  password: z.string().min(8, "密码至少 8 位").max(72, "密码过长"),
});

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "请输入当前密码"),
    newPassword: z.string().min(8, "新密码至少 8 位").max(72, "密码过长"),
    confirmPassword: z.string().min(1, "请再次输入新密码"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "两次输入的新密码不一致",
    path: ["confirmPassword"],
  });

export const employeeSchema = z.object({
  name: requiredText(32, "姓名"),
  phone: optionalText(20),
  position: optionalText(32),
  isTechnician: z.coerce.boolean().default(true),
  userId: optionalText(64),
  remark: optionalText(200),
});

export const customerQuickSchema = z.object({
  name: requiredText(32, "客户姓名"),
  phone: phoneField,
  wechat: optionalText(64),
});
