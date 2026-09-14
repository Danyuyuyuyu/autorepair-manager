"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";

import { cn } from "@/lib/utils";

export interface DatePickerProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> {
  value: string;
  onValueChange: (value: string) => void;
  /** 是否显示「今天 / 昨天 / 前天」快捷选择 */
  quickPicks?: boolean;
  containerClassName?: string;
}

/** yyyy-MM-dd（本地时区，不做 UTC 偏移） */
export function toInputDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayInput(): string {
  return toInputDate(new Date());
}

export function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toInputDate(d);
}

/**
 * 日期选择器。
 * 移动端直接复用原生 date 控件（系统原生滚轮体验最好、零 JS 体积）；
 * 桌面端叠加日历图标与快捷选项。
 */
export function DatePicker({
  value,
  onValueChange,
  quickPicks = false,
  className,
  containerClassName,
  ...props
}: DatePickerProps) {
  const picks = React.useMemo(
    () => [
      { label: "今天", value: todayInput() },
      { label: "昨天", value: shiftDays(-1) },
      { label: "前天", value: shiftDays(-2) },
    ],
    [],
  );

  return (
    <div className={cn("flex flex-col gap-2", containerClassName)}>
      <div className="relative">
        <CalendarDays className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2" />
        <input
          type="date"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className={cn(
            "tabular rounded-control border-input bg-card text-foreground h-11 w-full appearance-none border pr-3 pl-10 text-[16px]",
            "focus-visible:border-brand focus-visible:ring-brand/25 transition-shadow outline-none focus-visible:ring-2",
            "disabled:bg-muted disabled:cursor-not-allowed",
            className,
          )}
          {...props}
        />
      </div>

      {quickPicks ? (
        <div className="flex gap-2">
          {picks.map((pick) => (
            <button
              key={pick.label}
              type="button"
              onClick={() => onValueChange(pick.value)}
              className={cn(
                "h-8 flex-1 rounded-full border text-xs font-medium transition-colors",
                value === pick.value
                  ? "border-brand-border bg-brand-soft text-brand-strong"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {pick.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
