import "server-only";

import type { z } from "zod";

import { ValidationError } from "@/server/errors";

/**
 * 校验并返回数据；失败时抛出带字段错误的 ValidationError。
 * 所有 Server Action 的入参都必须先经过这里，前端校验只是辅助。
 */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);

  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ||= []).push(issue.message);
    }
    throw new ValidationError("提交的数据不合法，请检查后重试。", fieldErrors);
  }

  return result.data;
}

/** 把 FormData 转成普通对象（只取字符串值） */
export function formDataToObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}
