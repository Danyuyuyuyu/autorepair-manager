import {
  AppError,
  ConcurrentModificationError,
  ForeignKeyConstraintError,
  UniqueConstraintError,
} from "@/server/errors";

/**
 * SQLite 驱动错误 → 领域异常
 * ---------------------------------------------------------------------------
 * 与 prisma/client.ts 的 translateDriverError 同一职责，只是翻译对象换成
 * node:sqlite 的错误。业务层只会见到 src/server/errors.ts 里的领域异常。
 *
 * node:sqlite 的约束冲突错误形态：
 *   Error { code: 'ERR_SQLITE_ERROR', message: 'UNIQUE constraint failed: users.username' }
 */

/** 从约束错误消息中提取「表.列」，用于生成可读文案 */
function extractField(message: string): string | undefined {
  // UNIQUE constraint failed: users.username / categories.kind, categories.name
  const match = /(?:UNIQUE|CHECK) constraint failed: ([\w., ]+)$/.exec(message);
  if (!match?.[1]) return undefined;
  const first = match[1].split(",")[0]?.trim();
  return first?.split(".")[1] ?? first;
}

export function translateSqliteError(error: unknown): unknown {
  if (error instanceof AppError) return error;

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("UNIQUE constraint failed")) {
    const field = extractField(message);
    throw new UniqueConstraintError(
      field ? `数据已存在（${field}），请勿重复提交。` : undefined,
      field,
    );
  }
  if (message.includes("FOREIGN KEY constraint failed")) {
    throw new ForeignKeyConstraintError();
  }
  // CHECK 约束失败基本只可能是枚举列收到了非法值 —— 这是程序错误，
  // 按「立即暴露」原则给出明确异常，绝不静默 fallback。
  if (message.includes("CHECK constraint failed")) {
    const field = extractField(message);
    throw new AppError(
      `数据不合法（${field ?? "约束校验"}），请检查输入或联系开发者。`,
      "CHECK_VIOLATION",
      400,
    );
  }
  if (message.includes("database is locked") || message.includes("database table is locked")) {
    throw new ConcurrentModificationError();
  }
  if (message.includes("no such table")) {
    throw new AppError("数据库尚未初始化，请重启应用。", "DB_NOT_INITIALIZED", 500);
  }
  return error;
}

/**
 * 与 prisma 侧同名的包装器：用代理包住仓储对象，
 * 任何方法抛出的驱动错误都会被翻译成领域异常。
 */
export function withSqliteErrorTranslation<T extends object>(repo: T): T {
  return new Proxy(repo, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        try {
          const result = (value as (...a: unknown[]) => unknown).apply(target, args);
          if (result instanceof Promise) {
            return result.catch((error) => {
              throw translateSqliteError(error);
            });
          }
          return result;
        } catch (error) {
          throw translateSqliteError(error);
        }
      };
    },
  }) as T;
}
