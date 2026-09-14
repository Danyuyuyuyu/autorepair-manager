"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/** 表单级错误提示（用于 Server Action 返回的整体错误） */
export function FormMessage({ error, className }: { error?: string | null; className?: string }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-control border-danger-border bg-danger-soft flex items-start gap-2 border px-3 py-2.5",
        className,
      )}
    >
      <AlertCircle className="text-danger mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="text-danger-strong text-sm">{error}</p>
    </div>
  );
}

/** 用于「字段级」错误的列表 */
export function FieldErrors({
  errors,
  field,
}: {
  errors?: Record<string, string[]>;
  field: string;
}) {
  const list = errors?.[field];
  if (!list?.length) return null;
  return <p className="text-danger-strong text-xs">{list[0]}</p>;
}
