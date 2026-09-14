import "server-only";

import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/session";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";
import type { CurrentUser } from "@/types";

/**
 * 守卫入口
 * ---------------------------------------------------------------------------
 * 分两类，用途不同，不能混用：
 *   - 页面守卫（requireUser / requireAdminPage）：未登录直接 redirect 到登录页，体验优先；
 *   - Action 守卫（requireUserAction / requireAdminAction）：抛异常交给 safeAction 转成中文提示。
 *     这里**不能 redirect**，否则表单状态与提示会丢失。
 *
 * 纯权限判断（canModifyWorkOrder / canViewFinance 等）在 `permissions.ts`。
 * service 层只应依赖那一层 —— 否则领域逻辑会被迫加载 next/navigation，
 * 既增加耦合，也让 service 无法在 CLI / 测试环境中直接运行。
 */

/** 页面用：未登录跳转登录页 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** 页面用：非管理员跳转首页（财务 / 报表 / 设置） */
export async function requireAdminPage(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/dashboard?forbidden=1");
  return user;
}

/** Server Action 用：未登录直接报错，不做跳转 */
export async function requireUserAction(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Server Action 用：需要管理员权限 */
export async function requireAdminAction(): Promise<CurrentUser> {
  const user = await requireUserAction();
  if (!user.isAdmin) throw new ForbiddenError();
  return user;
}

// 便捷再导出：页面里常与守卫一起使用，统一从本模块导入即可
export {
  canModifyWorkOrder,
  canViewFinance,
  isAdmin,
  isTerminalStatus,
} from "@/server/auth/permissions";
