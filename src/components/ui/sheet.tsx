"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

type Side = "bottom" | "right" | "left";

const sideClasses: Record<Side, string> = {
  bottom:
    "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-sheet border-t data-[state=open]:animate-[sheet-up_220ms_cubic-bezier(0.32,0.72,0,1)] data-[state=closed]:animate-[sheet-down_180ms_ease-in]",
  right:
    "top-0 right-0 h-full w-[86vw] max-w-md border-l data-[state=open]:animate-[slide-in-right_220ms_ease-out] data-[state=closed]:animate-[slide-out-right_180ms_ease-in]",
  left: "top-0 left-0 h-full w-[86vw] max-w-md border-r data-[state=open]:animate-[slide-in-left_220ms_ease-out] data-[state=closed]:animate-[slide-out-left_180ms_ease-in]",
};

export interface SheetContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  side?: Side;
  title: string;
  description?: string;
  footer?: React.ReactNode;
}

/**
 * 通用抽屉 / 底部面板。
 * 复杂表单在手机端优先使用 side="bottom"，避免大弹窗遮挡表单。
 */
export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  { className, children, side = "bottom", title, description, footer, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="bg-overlay fixed inset-0 z-50 data-[state=closed]:animate-[fade-out_120ms_ease-in] data-[state=open]:animate-[fade-in_150ms_ease-out]" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "border-border bg-card shadow-sheet fixed z-50 flex flex-col overflow-hidden outline-none",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {side === "bottom" ? (
          <div className="flex shrink-0 justify-center pt-2.5 pb-1">
            <div className="bg-border-strong h-1 w-10 rounded-full" />
          </div>
        ) : null}

        <div className="border-border flex shrink-0 items-start justify-between gap-4 border-b px-4 py-3.5">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-foreground text-base font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-muted-foreground mt-0.5 text-xs">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-9 shrink-0 place-items-center rounded-full transition-colors"
            aria-label="关闭"
          >
            <span className="text-lg leading-none">✕</span>
          </DialogPrimitive.Close>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>

        {footer ? (
          <div className="border-border pb-safe shrink-0 border-t px-4 py-3">{footer}</div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
