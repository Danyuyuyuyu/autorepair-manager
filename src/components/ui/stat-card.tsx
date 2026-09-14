import * as React from "react";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: string;
  icon?: LucideIcon;
  /** 数值语义色：营业额用品牌色，支出用红色，利润用绿色 */
  tone?: "default" | "brand" | "success" | "danger" | "warning";
  trend?: { value: number; label?: string };
  className?: string;
}

const toneValueClass: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  brand: "text-brand-strong",
  success: "text-success-strong",
  danger: "text-danger-strong",
  warning: "text-warning-strong",
};

const toneIconClass: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-muted text-muted-foreground",
  brand: "bg-brand-soft text-brand-strong",
  success: "bg-success-soft text-success-strong",
  danger: "bg-danger-soft text-danger-strong",
  warning: "bg-warning-soft text-warning-strong",
};

/**
 * 数据卡片 —— 首页 / 报表统一使用的指标卡。
 * 数值使用等宽数字，保证多卡并排时纵向对齐。
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = "default",
  trend,
  className,
}: StatCardProps) {
  return (
    <div className={cn("rounded-card border-border bg-card shadow-card border p-3.5", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="truncate-1 text-muted-foreground text-xs font-medium">{label}</p>
        {Icon ? (
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg",
              toneIconClass[tone],
            )}
          >
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-baseline gap-1">
        <span
          className={cn("tabular text-[22px] leading-tight font-semibold", toneValueClass[tone])}
        >
          {value}
        </span>
        {unit ? <span className="text-muted-foreground text-xs">{unit}</span> : null}
      </div>

      {trend ? (
        <p
          className={cn(
            "mt-1.5 flex items-center gap-0.5 text-xs",
            trend.value >= 0 ? "text-success-strong" : "text-danger-strong",
          )}
        >
          {trend.value >= 0 ? (
            <ArrowUpRight className="size-3.5" />
          ) : (
            <ArrowDownRight className="size-3.5" />
          )}
          {Math.abs(trend.value).toFixed(1)}%
          {trend.label ? <span className="text-muted-foreground ml-1">{trend.label}</span> : null}
        </p>
      ) : hint ? (
        <p className="truncate-1 text-muted-foreground mt-1.5 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
