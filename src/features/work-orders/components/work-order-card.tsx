import Link from "next/link";
import { Car, ChevronRight, Clock } from "lucide-react";

import { WorkOrderStatusBadge } from "@/components/shared/status-badge";
import { formatMoney, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WorkOrderListItemDTO } from "@/types";

/**
 * 工单卡片 —— 手机端与 PC 端列表统一使用（PC 表格另有一套，但卡片仍是移动端主力）。
 * 信息优先级：车牌 > 状态 > 金额 > 客户/车型 > 时间
 */
export function WorkOrderCard({
  order,
  showCustomer = true,
  className,
}: {
  order: WorkOrderListItemDTO;
  showCustomer?: boolean;
  className?: string;
}) {
  const hasDebt = Number(order.outstandingAmount) > 0;

  return (
    <Link
      href={`/work-orders/${order.id}`}
      className={cn(
        "rounded-card border-border bg-card shadow-card active:bg-muted block border p-3.5 transition-colors",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-[17px] leading-tight font-semibold tracking-wide">
              {order.plateNumber}
            </span>
            <WorkOrderStatusBadge status={order.status} size="sm" />
          </div>

          <p className="text-muted-foreground mt-1 truncate text-[13px]">
            {[order.vehicleModel, showCustomer ? order.customerName : null]
              .filter(Boolean)
              .join(" · ") || "未填写车型"}
          </p>

          <div className="text-subtle-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="tabular">{order.orderNo}</span>
            {order.itemCount > 0 ? <span>{order.itemCount} 个项目</span> : null}
            {order.technicianName ? <span>{order.technicianName}</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "tabular text-[17px] leading-tight font-semibold",
              hasDebt ? "text-danger-strong" : "text-foreground",
            )}
          >
            {formatMoney(order.totalAmount)}
          </span>
          {hasDebt ? (
            <span className="tabular bg-danger-soft text-danger-strong rounded-md px-1.5 py-0.5 text-[11px] font-medium">
              欠 {formatMoney(order.outstandingAmount, { withSymbol: false })}
            </span>
          ) : order.status !== "CANCELLED" ? (
            <span className="text-success-strong text-[11px]">已结清</span>
          ) : null}
          <span className="text-subtle-foreground flex items-center gap-0.5 text-[11px]">
            <Clock className="size-3" />
            {formatRelative(order.createdAt)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** 紧凑行：用于首页「今日维修记录」 */
export function WorkOrderRow({ order }: { order: WorkOrderListItemDTO }) {
  return (
    <Link
      href={`/work-orders/${order.id}`}
      className="active:bg-muted flex items-center gap-3 px-4 py-3 transition-colors"
    >
      <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
        <Car className="size-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground truncate text-[15px] font-medium">
            {order.plateNumber}
          </span>
          <WorkOrderStatusBadge status={order.status} size="sm" />
        </div>
        <p className="text-muted-foreground truncate text-xs">
          {order.customerName} · {formatRelative(order.createdAt)}
        </p>
      </div>

      <span className="tabular text-foreground shrink-0 text-sm font-semibold">
        {formatMoney(order.totalAmount, { withSymbol: false })}
      </span>
      <ChevronRight className="text-subtle-foreground size-4 shrink-0" />
    </Link>
  );
}
