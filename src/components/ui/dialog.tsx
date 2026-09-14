"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "bg-overlay fixed inset-0 z-50 backdrop-blur-[1px]",
        "data-[state=open]:animate-[fade-in_150ms_ease-out]",
        "data-[state=closed]:animate-[fade-out_120ms_ease-in]",
        className,
      )}
      {...props}
    />
  );
});

/**
 * 响应式对话框：
 * - 手机（< 640px）：从底部升起的 Bottom Sheet，适合单手操作
 * - 平板 / PC：居中弹出
 */
export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    hideClose?: boolean;
    /** 手机端是否占满高度 */
    fullHeightOnMobile?: boolean;
  }
>(function DialogContent(
  { className, children, hideClose = false, fullHeightOnMobile = false, ...props },
  ref,
) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            "border-border bg-card pointer-events-auto relative flex w-full flex-col overflow-hidden border",
            "rounded-t-sheet shadow-sheet sm:rounded-card sm:shadow-raised max-h-[92dvh] sm:max-w-lg",
            fullHeightOnMobile && "h-[92dvh] sm:h-auto",
            "data-[state=open]:animate-[sheet-up_220ms_cubic-bezier(0.32,0.72,0,1)]",
            "data-[state=closed]:animate-[sheet-down_180ms_ease-in]",
            className,
          )}
          {...props}
        >
          {children}
          {hideClose ? null : (
            <DialogPrimitive.Close
              className={cn(
                "absolute top-3.5 right-3.5 z-10 grid size-9 place-items-center rounded-full",
                "text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
                "focus-visible:ring-brand/40 focus-visible:ring-2 focus-visible:outline-none",
              )}
              aria-label="关闭"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  );
});

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-border flex shrink-0 flex-col gap-1 border-b px-4 py-4 pr-14 sm:px-5",
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-foreground text-base font-semibold", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-border pb-safe flex shrink-0 flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end sm:px-5",
        className,
      )}
      {...props}
    />
  );
}

/** 手机端底部拖拽提示条 */
export function SheetHandle({ className }: { className?: string }) {
  return (
    <div className={cn("flex justify-center pt-2.5 pb-1 sm:hidden", className)}>
      <div className="bg-border-strong h-1 w-10 rounded-full" />
    </div>
  );
}
