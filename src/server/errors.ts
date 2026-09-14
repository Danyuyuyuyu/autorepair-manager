import { ZodError } from "zod";

import type { ActionResult } from "@/types";

/** 业务异常：message 会直接展示给用户，必须是中文可读文案 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string = "APP_ERROR",
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "登录已过期，请重新登录。") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "没有权限执行该操作。") {
    super(message, "FORBIDDEN", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "数据不存在或已被删除。") {
    super(message, "NOT_FOUND", 404);
  }
}

export class ValidationError extends AppError {
  constructor(
    message = "提交的数据不合法，请检查后重试。",
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message, "VALIDATION_ERROR", 422);
  }
}

/** 库存不足等可预期业务失败，单独标记便于前端友好提示 */
export class BusinessRuleError extends AppError {
  constructor(message: string) {
    super(message, "BUSINESS_RULE", 409);
  }
}

// ---------------------------------------------------------------------------
// 存储层约束冲突 —— 后端无关
// ---------------------------------------------------------------------------
// 各仓储实现负责把底层驱动错误（Prisma P2002/P2003/P2025/P2034、
// SQLite SQLITE_CONSTRAINT_* 等）翻译成下面这几个领域异常。
// 这样业务层永远不需要 import 任何数据库驱动的错误类型，手机端才能复用。

/** 唯一约束冲突（如工单号重复） */
export class UniqueConstraintError extends AppError {
  constructor(
    message = "数据已存在，请勿重复提交。",
    readonly field?: string,
  ) {
    super(message, "UNIQUE_VIOLATION", 409);
  }
}

/** 外键约束冲突（记录被其他数据引用） */
export class ForeignKeyConstraintError extends AppError {
  constructor(message = "该记录已被其他数据引用，无法删除。") {
    super(message, "FOREIGN_KEY_VIOLATION", 409);
  }
}

/** 并发修改冲突（乐观锁失败 / 序列化冲突） */
export class ConcurrentModificationError extends AppError {
  constructor(message = "数据被同时修改，请重试。") {
    super(message, "CONCURRENT_MODIFICATION", 409);
  }
}

/**
 * 把任意异常收敛成统一文案。
 * 原则：可预期错误（AppError / Zod）原样展示；未知错误打日志 + 兜底文案。
 */
export function toUserMessage(error: unknown): {
  error: string;
  fieldErrors?: Record<string, string[]>;
} {
  if (error instanceof ValidationError) {
    return { error: error.message, fieldErrors: error.fieldErrors };
  }
  if (error instanceof AppError) {
    return { error: error.message };
  }
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ||= []).push(issue.message);
    }
    return { error: "提交的数据不合法，请检查后重试。", fieldErrors };
  }
  // 存储驱动的约束冲突。
  // 说明：仓储适配层会把底层驱动错误翻译成上面的领域异常，因此这里**不 import** 任何
  // 数据库驱动的错误类型（否则领域层被绑死在 Prisma 上，手机端无法复用本模块）。
  // 但尚未迁移到仓储的 service 仍会直接抛出 Prisma 错误，所以这里用结构化判断兜一层，
  // 保证这些路径的提示文案不退化。等全部 service 迁移完成后即可删除本分支。
  const driverCode = (error as { code?: unknown } | null)?.code;
  if (typeof driverCode === "string" && /^P2\d{3}$/.test(driverCode)) {
    if (driverCode === "P2002") return { error: "数据已存在，请勿重复提交。" };
    if (driverCode === "P2003") return { error: "该记录已被其他数据引用，无法删除。" };
    if (driverCode === "P2025") return { error: "数据不存在或已被删除。" };
    if (driverCode === "P2034") return { error: "数据被同时修改，请重试。" };
    console.error("[db]", driverCode, error instanceof Error ? error.message : "");
    return { error: "数据库操作失败，请稍后重试。" };
  }
  if (error instanceof Error && error.message.includes("connect")) {
    return { error: "数据库连接异常，请检查服务是否正常。" };
  }
  console.error("[unexpected]", error);
  return { error: "网络连接异常，请稍后重试。" };
}

/** Server Action 统一包装：永不抛出，永远返回 ActionResult */
export async function safeAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof Error && (error as Error).message === "NEXT_REDIRECT") throw error;
    // Next.js 的 redirect() 通过抛异常实现，必须原样放行
    if (error && typeof error === "object" && "digest" in error) {
      const digest = String((error as { digest?: string }).digest ?? "");
      if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND")) throw error;
    }
    return { ok: false, ...toUserMessage(error) };
  }
}
