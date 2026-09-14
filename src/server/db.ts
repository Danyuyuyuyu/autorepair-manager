import { PrismaClient } from "@prisma/client";

/**
 * Prisma 单例。
 * 开发环境下 Next.js HMR 会重复加载模块，必须挂到 globalThis 防止连接数爆炸。
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? [
            { emit: "event", level: "error" },
            { emit: "stdout", level: "warn" },
          ]
        : [{ emit: "event", level: "error" }],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** 事务客户端类型（供 service 层复用同一套代码） */
export type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
