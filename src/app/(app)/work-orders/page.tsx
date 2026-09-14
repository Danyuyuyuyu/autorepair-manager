import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/shared/pagination";
import { WorkOrderStatusBadge } from "@/components/shared/status-badge";
import { WorkOrderCard } from "@/features/work-orders/components/work-order-card";
import { WorkOrderFilters } from "@/features/work-orders/components/work-order-filters";
import { requireUser } from "@/server/auth/guard";
import { listWorkOrders } from "@/server/services/work-order.service";
import { workOrderListQuerySchema } from "@/lib/validation/work-order";
import { parseOrThrow } from "@/server/validate";

export const metadata: Metadata = { title: "维修工单" };
export const dynamic = "force-dynamic";

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const query = parseOrThrow(workOrderListQuerySchema, {
    q: typeof params.q === "string" ? params.q : undefined,
    status: typeof params.status === "string" ? params.status : "ALL",
    page: typeof params.page === "string" ? params.page : 1,
    pageSize: 20,
  });

  const result = await listWorkOrders({
    ...query,
    // 员工只看自己创建的工单，管理员看全部（服务端强制）
    restrictToUserId: user.isAdmin ? undefined : user.id,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-foreground text-lg font-semibold">维修工单</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {user.isAdmin ? "全部工单" : "我创建的工单"}
          </p>
        </div>
        <Button asChild className="shrink-0">
          <Link href="/work-orders/new">
            <Plus />
            新建
          </Link>
        </Button>
      </div>

      <WorkOrderFilters total={result.total} />

      {result.items.length === 0 ? (
        <EmptyState
          title="没有符合条件的工单"
          description="换个筛选条件，或直接新建一张维修工单。"
          action={
            <Button asChild>
              <Link href="/work-orders/new">
                <Plus />
                新建维修工单
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* 手机端：卡片列表 */}
          <div className="space-y-2.5 lg:hidden">
            {result.items.map((order) => (
              <WorkOrderCard key={order.id} order={order} />
            ))}
          </div>

          {/* PC 端：表格 */}
          <div className="rounded-card border-border bg-card shadow-card hidden overflow-hidden border lg:block">
            <table className="w-full text-sm">
              <thead className="border-border bg-muted/40 border-b">
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="px-4 py-3 font-medium">工单号</th>
                  <th className="px-4 py-3 font-medium">车牌</th>
                  <th className="px-4 py-3 font-medium">客户</th>
                  <th className="px-4 py-3 font-medium">故障</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 text-right font-medium">应收</th>
                  <th className="px-4 py-3 text-right font-medium">未收</th>
                  <th className="px-4 py-3 font-medium">技师</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((order) => (
                  <tr
                    key={order.id}
                    className="border-border hover:bg-muted/50 border-b last:border-0"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/work-orders/${order.id}`}
                        className="tabular text-brand font-medium hover:underline"
                      >
                        {order.orderNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium">{order.plateNumber}</td>
                    <td className="text-muted-foreground px-4 py-3">
                      {order.customerName}
                      <span className="tabular ml-2 text-xs">{order.customerPhone}</span>
                    </td>
                    <td className="text-muted-foreground max-w-56 truncate px-4 py-3">
                      {order.faultDescription ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <WorkOrderStatusBadge status={order.status} size="sm" />
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium">
                      ¥{order.totalAmount}
                    </td>
                    <td className="tabular px-4 py-3 text-right">
                      {Number(order.outstandingAmount) > 0 ? (
                        <span className="text-danger-strong font-medium">
                          ¥{order.outstandingAmount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">已结清</span>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {order.technicianName ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={result.page} totalPages={result.totalPages} total={result.total} />
        </>
      )}
    </div>
  );
}
