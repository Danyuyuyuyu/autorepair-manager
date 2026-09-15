/**
 * 跨存储领域异常
 * ---------------------------------------------------------------------------
 * Repository adapter 把各自驱动错误翻译成这些类型；业务层因此不认识
 * Prisma、node:sqlite 或 Capacitor SQLite 的错误码。
 */

/** message 可以直接展示给用户，必须是中文可读文案。 */
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

/** 库存不足等可预期业务失败。 */
export class BusinessRuleError extends AppError {
  constructor(message: string) {
    super(message, "BUSINESS_RULE", 409);
  }
}

export class UniqueConstraintError extends AppError {
  constructor(
    message = "数据已存在，请勿重复提交。",
    readonly field?: string,
  ) {
    super(message, "UNIQUE_VIOLATION", 409);
  }
}

export class ForeignKeyConstraintError extends AppError {
  constructor(message = "该记录已被其他数据引用，无法删除。") {
    super(message, "FOREIGN_KEY_VIOLATION", 409);
  }
}

export class ConcurrentModificationError extends AppError {
  constructor(message = "数据被同时修改，请重试。") {
    super(message, "CONCURRENT_MODIFICATION", 409);
  }
}
