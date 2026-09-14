"use client";

import * as React from "react";

import { money } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface MoneyInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> {
  value: string;
  onValueChange: (value: string) => void;
  /** 失焦时把输入规整为 2 位小数 */
  normalizeOnBlur?: boolean;
}

function sanitize(raw: string) {
  // 只保留数字与一个小数点，最多两位小数
  let next = raw.replace(/[^\d.]/g, "");
  const firstDot = next.indexOf(".");
  if (firstDot !== -1) {
    next = next.slice(0, firstDot + 1) + next.slice(firstDot + 1).replace(/\./g, "");
    const [intPart, decPart = ""] = next.split(".");
    next = `${intPart}.${decPart.slice(0, 2)}`;
  }
  return next;
}

/** 金额输入框：仅接受合法金额字符，展示 ¥ 前缀 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onValueChange, normalizeOnBlur = true, className, onBlur, ...props },
  ref,
) {
  return (
    <div className="relative">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
        ¥
      </span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onValueChange(sanitize(e.target.value))}
        onBlur={(e) => {
          if (normalizeOnBlur && value !== "") {
            onValueChange(money(value).toFixed(2));
          }
          onBlur?.(e);
        }}
        onFocus={(e) => e.currentTarget.select()}
        className={cn(
          "tabular rounded-control border-input bg-card text-foreground h-11 w-full border pr-3 pl-7 text-[16px]",
          "focus-visible:border-brand focus-visible:ring-brand/25 transition-shadow outline-none focus-visible:ring-2",
          "disabled:bg-muted disabled:cursor-not-allowed",
          "aria-[invalid=true]:border-danger",
          className,
        )}
        {...props}
      />
    </div>
  );
});

export interface QuantityStepperProps {
  value: string;
  onValueChange: (value: string) => void;
  min?: number;
  step?: number;
  unit?: string;
  className?: string;
  disabled?: boolean;
}

/** 数量步进器：移动端高频使用（配件数量、工时） */
export function QuantityStepper({
  value,
  onValueChange,
  min = 0,
  step = 1,
  unit,
  className,
  disabled,
}: QuantityStepperProps) {
  const numeric = Number(value || 0);

  const bump = (delta: number) => {
    const next = Math.max(min, Number((numeric + delta).toFixed(2)));
    onValueChange(String(next));
  };

  return (
    <div
      className={cn(
        "rounded-control border-input bg-card flex h-11 items-center border",
        disabled && "opacity-60",
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled || numeric <= min}
        onClick={() => bump(-step)}
        className="text-foreground hover:bg-muted grid h-full w-11 shrink-0 place-items-center text-lg font-medium transition-colors disabled:opacity-40"
        aria-label="减少"
      >
        −
      </button>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={value}
        onChange={(e) => onValueChange(e.target.value.replace(/[^\d.]/g, ""))}
        onBlur={() => {
          if (value === "" || Number.isNaN(numeric)) onValueChange(String(min));
          else onValueChange(String(Math.max(min, Number(numeric.toFixed(2)))));
        }}
        className="tabular border-input h-full w-full min-w-0 border-x bg-transparent text-center text-[16px] outline-none"
      />
      {unit ? (
        <span className="border-input text-muted-foreground shrink-0 border-r px-2 text-xs">
          {unit}
        </span>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => bump(step)}
        className="text-foreground hover:bg-muted grid h-full w-11 shrink-0 place-items-center text-lg font-medium transition-colors disabled:opacity-40"
        aria-label="增加"
      >
        +
      </button>
    </div>
  );
}
