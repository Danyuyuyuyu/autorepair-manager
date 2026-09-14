import type { PrismaClient } from "@prisma/client";

import type { TxClient } from "@/server/db";
import {
  ConcurrentModificationError,
  ForeignKeyConstraintError,
  NotFoundError,
  UniqueConstraintError,
} from "@/server/errors";

/**
 * 仓储实现可用的客户端：连接池本体，或事务客户端。
 * 两者在 Prisma 里是同一套 API，事务客户端只是去掉了无法在事务中调用的方法。
 */
export type RepoClient = TxClient | PrismaClient;

// ---------------------------------------------------------------------------
// 驱动错误 -> 领域异常
// ---------------------------------------------------------------------------

/** Prisma 已知错误码的结构化识别（不依赖 instanceof，便于换驱动时复用） */
function driverErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/**
 * 把底层驱动抛出的错误翻译成领域异常。
 * 这是「领域层不 import 任何数据库驱动」的关键一环 —— 翻译只发生在适配层内部，
 * 业务代码只会见到 `src/server/errors.ts` 里定义的异常。
 */
export function translateDriverError(error: unknown): never {
  const code = driverErrorCode(error);
  const meta = (error as { meta?: Record<string, unknown> } | null)?.meta;

  switch (code) {
    case "P2002": {
      const target = meta?.target;
      const field = Array.isArray(target)
        ? String(target[0])
        : typeof target === "string"
          ? target
          : undefined;
      throw new UniqueConstraintError(
        field ? `数据已存在（${field}），请勿重复提交。` : undefined,
        field,
      );
    }
    case "P2003":
      throw new ForeignKeyConstraintError();
    case "P2025":
      throw new NotFoundError();
    case "P2034":
      throw new ConcurrentModificationError();
    default:
      throw error;
  }
}

/**
 * 用代理包住仓储对象：任何方法抛出的驱动错误都会被翻译。
 * 这样即使某个方法忘了 try/catch，也不会把 Prisma 异常泄漏到业务层。
 */
export function withTranslatedErrors<T extends object>(repo: T): T {
  return new Proxy(repo, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        try {
          const result = (value as (...a: unknown[]) => unknown).apply(target, args);
          return result instanceof Promise ? result.catch(translateDriverError) : result;
        } catch (error) {
          translateDriverError(error);
        }
      };
    },
  }) as T;
}
