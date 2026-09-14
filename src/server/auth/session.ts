import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";

import { getEnv } from "@/lib/env";
import { sessionStore } from "@/server/context";
import type { CurrentUser } from "@/types";

const COOKIE_NAME = "ar_session";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function ttlMs() {
  return getEnv().SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/** 创建会话并把原始 token 写入 httpOnly Cookie（数据库中只存哈希） */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs());
  const headerBag = await headers();

  await sessionStore.create({
    id: hashToken(token),
    userId,
    expiresAt,
    userAgent: headerBag.get("user-agent")?.slice(0, 255) ?? null,
    ip: headerBag.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    await sessionStore.revoke(hashToken(token));
  }

  cookieStore.delete(COOKIE_NAME);
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await sessionStore.revokeAll(userId);
}

/**
 * 读取当前登录用户。
 * 使用 React cache 保证同一请求内只查一次库。
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await sessionStore.findValid(hashToken(token), new Date());

  if (!session) return null;

  const { user } = session;
  if (!user.isActive || user.deletedAt) return null;

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    isAdmin: user.role === "ADMIN",
  };
});

/**
 * 过期会话清理：调度与触发策略全部在 `session-prune.ts`，本文件只保留对外入口。
 *   - 运维定时任务：`pruneExpiredSessions()`（立即执行，失败抛错）
 *   - 登录成功路径：`maybePruneExpiredSessions()`（按小时节流，失败静默）
 */
export { maybePruneExpiredSessions, pruneExpiredSessions } from "@/server/auth/session-prune";

export { COOKIE_NAME };
