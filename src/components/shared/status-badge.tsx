import { Badge } from "@/components/ui/badge";
import {
  INVENTORY_TX_LABELS,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_TONE,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { InventoryTxType, WorkOrderStatus } from "@prisma/client";

export function WorkOrderStatusBadge({
  status,
  size = "md",
}: {
  status: WorkOrderStatus;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <Badge className={cn(WORK_ORDER_STATUS_TONE[status])} size={size}>
      {WORK_ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

const TX_TONE: Record<InventoryTxType, string> = {
  PURCHASE_IN: "border-success-border bg-success-soft text-success-strong",
  RETURN_IN: "border-success-border bg-success-soft text-success-strong",
  WORKORDER_OUT: "border-warning-border bg-warning-soft text-warning-strong",
  ADJUST: "border-info-border bg-info-soft text-info-strong",
  STOCKTAKE: "border-brand-border bg-brand-soft text-brand-strong",
};

export function InventoryTxBadge({
  type,
  size = "md",
}: {
  type: InventoryTxType;
  size?: "sm" | "md";
}) {
  return (
    <Badge className={cn(TX_TONE[type])} size={size}>
      {INVENTORY_TX_LABELS[type]}
    </Badge>
  );
}

/** 金额展示：支出/欠款用红色语义，收入用绿色语义 */
export function AmountText({
  value,
  tone = "default",
  className,
}: {
  value: React.ReactNode;
  tone?: "default" | "income" | "expense" | "muted";
  className?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    income: "text-success-strong",
    expense: "text-danger-strong",
    muted: "text-muted-foreground",
  }[tone];

  return <span className={cn("tabular font-semibold", toneClass, className)}>{value}</span>;
}
