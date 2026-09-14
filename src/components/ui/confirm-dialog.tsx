"use client";

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "@/lib/utils";

export const AlertDialog = AlertDialogPrimitive.Root;

const toneClasses = {
  danger: "bg-danger text-danger-foreground hover:bg-danger-hover",
  primary: "bg-brand text-brand-foreground hover:bg-brand-hover",
  success: "bg-success text-success-foreground hover:bg-success-strong",
} as const;

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: keyof typeof toneClasses;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * 统一确认弹窗 —— 所有危险操作（删除工单 / 作废收款 / 库存调整）必须走这里
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  tone = "danger",
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="bg-overlay fixed inset-0 z-60 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <div className="pointer-events-none fixed inset-0 z-60 flex items-end justify-center sm:items-center sm:p-4">
          <AlertDialogPrimitive.Content
            className={cn(
              "border-border bg-card pointer-events-auto w-full max-w-sm border p-5",
              "rounded-t-sheet shadow-sheet sm:rounded-card sm:shadow-raised",
              "data-[state=open]:animate-[sheet-up_200ms_cubic-bezier(0.32,0.72,0,1)]",
            )}
          >
            <AlertDialogPrimitive.Title className="text-foreground text-base font-semibold">
              {title}
            </AlertDialogPrimitive.Title>
            {description ? (
              <AlertDialogPrimitive.Description asChild>
                <div className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {description}
                </div>
              </AlertDialogPrimitive.Description>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialogPrimitive.Cancel
                disabled={loading}
                className="rounded-control border-border bg-card text-foreground hover:bg-muted h-11 border px-4 text-[15px] font-medium transition-colors disabled:opacity-50"
              >
                {cancelText}
              </AlertDialogPrimitive.Cancel>
              <button
                type="button"
                disabled={loading}
                onClick={() => void onConfirm()}
                className={cn(
                  "rounded-control h-11 px-4 text-[15px] font-medium transition-colors disabled:opacity-50",
                  toneClasses[tone],
                )}
              >
                {loading ? "处理中…" : confirmText}
              </button>
            </div>
          </AlertDialogPrimitive.Content>
        </div>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
