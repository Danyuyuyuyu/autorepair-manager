import "server-only";

import type { WorkOrderStatus } from "@prisma/client";

import type { CurrentUser } from "@/types";

/**
 * 纯权限判断（无副作用、不依赖框架 API）
 * ---------------------------------------------------------------------------
 * 这一层刻意**不引入 `next/navigation` / `next/headers`**：
 *   - service 层需要判断权限（例如「这张工单能不能改」），但不应该因此耦合到路由与请求上下文；
 *   - 纯函数可以在任意环境运行（Server Action、Route Handler、CLI 脚本、集成测试），
 *     这也是 `scripts/smoke-test.ts` 能直接调用 service 层的前提。
 *
 * 需要「未登录就跳转登录页」的页面级守卫放在 `guard.ts`。
 */

export function isAdmin(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "ADMIN";
}

/**
 * 是否可以操作某张工单。
 * 规则：管理员可操作全部；员工只能操作自己创建的工单。
 */
export function canModifyWorkOrder(
  user: Pick<CurrentUser, "id" | "isAdmin">,
  workOrder: { createdBy: string | null },
): boolean {
  if (user.isAdmin) return true;
  return workOrder.createdBy === user.id;
}

/** 财务（收入 / 支出 / 利润）等敏感数据的可见性 */
export function canViewFinance(user: Pick<CurrentUser, "isAdmin">): boolean {
  return user.isAdmin;
}

/** 已取消 / 已完成属于终态，不再允许修改业务内容 */
export function isTerminalStatus(status: WorkOrderStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}
