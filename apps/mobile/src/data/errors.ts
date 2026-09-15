import {
  AppError,
  ConcurrentModificationError,
  ForeignKeyConstraintError,
  UniqueConstraintError,
} from "@/domain/errors";

function extractField(message: string): string | undefined {
  const match = /(?:UNIQUE|CHECK) constraint failed: ([\w., ]+)$/.exec(message);
  const first = match?.[1]?.split(",")[0]?.trim();
  return first?.split(".")[1] ?? first;
}

export function translateMobileSqliteError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE constraint failed")) {
    const field = extractField(message);
    return new UniqueConstraintError(
      field ? `数据已存在（${field}），请勿重复提交。` : undefined,
      field,
    );
  }
  if (message.includes("FOREIGN KEY constraint failed")) {
    return new ForeignKeyConstraintError();
  }
  if (message.includes("CHECK constraint failed")) {
    return new AppError(
      `数据不合法（${extractField(message) ?? "约束校验"}），请检查输入或联系开发者。`,
      "CHECK_VIOLATION",
      400,
    );
  }
  if (message.includes("database is locked") || message.includes("database table is locked")) {
    return new ConcurrentModificationError();
  }
  if (message.includes("no such table")) {
    return new AppError("数据库尚未初始化，请重启应用。", "DB_NOT_INITIALIZED", 500);
  }
  return error;
}

export function withMobileSqliteErrorTranslation<T extends object>(repository: T): T {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        Promise.resolve((value as (...values: unknown[]) => unknown).apply(target, args)).catch(
          (error: unknown) => {
            throw translateMobileSqliteError(error);
          },
        );
    },
  });
}
