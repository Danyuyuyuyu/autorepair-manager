import "server-only";

import { headers } from "next/headers";

import type { Repositories } from "@/domain/repositories";
import { repos as defaultRepos } from "@/server/context";
import type { CurrentUser } from "@/types";

/** 需要留痕的关键操作 */
export const AUDIT_ACTIONS = {
  WORK_ORDER_CREATE: "新建工单",
  WORK_ORDER_UPDATE: "修改工单",
  WORK_ORDER_DELETE: "删除工单",
  WORK_ORDER_CANCEL: "取消工单",
  WORK_ORDER_STATUS: "变更工单状态",
  WORK_ORDER_COMPLETE: "工单完工",
  WORK_ORDER_ITEM_ADD: "添加工单项",
  WORK_ORDER_ITEM_UPDATE: "修改工单项",
  WORK_ORDER_ITEM_DELETE: "删除工单项",
  PRICE_UPDATE: "修改金额",
  PAYMENT_CREATE: "登记收款",
  PAYMENT_DELETE: "删除收款",
  EXPENSE_CREATE: "登记支出",
  EXPENSE_UPDATE: "修改支出",
  EXPENSE_DELETE: "删除支出",
  STOCK_ADJUST: "库存调整",
  STOCK_PURCHASE_IN: "采购入库",
  STOCK_STOCKTAKE: "库存盘点",
  PART_CREATE: "新增配件",
  PART_UPDATE: "修改配件",
  PART_DELETE: "删除配件",
  CUSTOMER_CREATE: "新增客户",
  CUSTOMER_UPDATE: "修改客户",
  CUSTOMER_DELETE: "删除客户",
  VEHICLE_CREATE: "新增车辆",
  VEHICLE_UPDATE: "修改车辆",
  VEHICLE_DELETE: "删除车辆",
  USER_CREATE: "新增员工账号",
  USER_UPDATE: "修改员工账号",
  USER_DELETE: "停用员工账号",
  SERVICE_ITEM_SAVE: "维护维修项目",
  LOGIN: "登录",
  LOGOUT: "退出登录",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export interface AuditInput {
  user: Pick<CurrentUser, "id" | "name"> | null;
  action: AuditAction;
  entity: string;
  entityId: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * 写审计日志。
 * 注意：审计失败绝不阻断主业务，仅记录到服务端日志。
 *
 * `repos` 传入事务内的仓储时，审计会与主业务同事务提交；
 * 不传则走默认仓储（单条写入，独立提交）。
 */
export async function writeAuditLog(input: AuditInput, repos: Repositories = defaultRepos) {
  try {
    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const headerBag = await headers();
      ip = headerBag.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      userAgent = headerBag.get("user-agent")?.slice(0, 255) ?? null;
    } catch {
      // 在非请求上下文（如 seed 脚本）中 headers() 不可用，忽略
    }

    await repos.audit.append({
      userId: input.user?.id ?? null,
      userName: input.user?.name ?? "系统",
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      summary: input.summary ?? AUDIT_ACTIONS[input.action],
      before: input.before === undefined ? undefined : JSON.parse(JSON.stringify(input.before)),
      after: input.after === undefined ? undefined : JSON.parse(JSON.stringify(input.after)),
      ip,
      userAgent,
    });
  } catch (error) {
    console.error("[audit] 写入审计日志失败", error);
  }
}

/**
 * 查询审计日志（管理员）。
 */
export async function listAuditLogs(
  params: {
    userId?: string;
    action?: string;
    entity?: string;
    entityId?: string;
    from?: Date;
    to?: Date;
    skip?: number;
    take?: number;
  },
  repos: Repositories = defaultRepos,
) {
  const result = await repos.audit.list(
    {
      userId: params.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      from: params.from,
      to: params.to,
    },
    { skip: params.skip ?? 0, take: params.take ?? 50 },
  );
  return result.rows;
}
