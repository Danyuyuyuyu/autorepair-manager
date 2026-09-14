"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { loginSchema } from "@/lib/validation/auth";
import { writeAuditLog } from "@/server/auth/audit";
import { verifyPassword } from "@/server/auth/password";
import {
  createSession,
  destroySession,
  getCurrentUser,
  maybePruneExpiredSessions,
} from "@/server/auth/session";
import { repos } from "@/server/context";
import { AppError, safeAction } from "@/server/errors";
import { parseOrThrow } from "@/server/validate";
import type { ActionResult } from "@/types";

/** 登录：失败统一提示，避免暴露账号是否存在 */
export async function loginAction(formData: FormData): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const input = parseOrThrow(loginSchema, {
      username: formData.get("username"),
      password: formData.get("password"),
    });

    const user = await repos.user.findForLogin(input.username);

    const invalid = new AppError("账号或密码不正确。", "INVALID_CREDENTIALS", 401);

    if (!user) {
      // 固定耗时，规避时间侧信道
      await verifyPassword(
        input.password,
        "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva",
      );
      throw invalid;
    }
    if (!user.isActive)
      throw new AppError("该账号已被停用，请联系管理员。", "ACCOUNT_DISABLED", 403);

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) throw invalid;

    await repos.user.recordLogin(user.id);
    await createSession(user.id);
    // 顺带清理过期会话：进程内按小时节流，失败静默（见 src/server/auth/session-prune.ts）
    await maybePruneExpiredSessions();

    await writeAuditLog({
      user: { id: user.id, name: user.name },
      action: "LOGIN",
      entity: "user",
      entityId: user.id,
      summary: `${user.name} 登录系统`,
    });

    revalidatePath("/", "layout");
    redirect("/dashboard");
  });
}

/** 退出登录：清会话 + 留痕 + 跳转登录页 */
export async function logoutAction(): Promise<{ ok: true }> {
  const user = await getCurrentUser();

  if (user) {
    await writeAuditLog({
      user,
      action: "LOGOUT",
      entity: "user",
      entityId: user.id,
      summary: `${user.name} 退出登录`,
    }).catch(() => undefined);
  }

  await destroySession();
  revalidatePath("/", "layout");
  return { ok: true };
}
