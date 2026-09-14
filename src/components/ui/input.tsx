import * as React from "react";

import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** 统一输入框：44px 高、16px 字号（避免 iOS 聚焦缩放） */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "rounded-control border-input bg-card text-foreground flex h-11 w-full border px-3 py-2 text-[16px]",
        "placeholder:text-subtle-foreground",
        "transition-shadow outline-none",
        "focus-visible:border-brand focus-visible:ring-brand/25 focus-visible:ring-2",
        "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
        "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20 aria-[invalid=true]:ring-2",
        className,
      )}
      {...props}
    />
  );
});

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 3, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        "rounded-control border-input bg-card text-foreground flex w-full resize-none border px-3 py-2.5 text-[16px]",
        "placeholder:text-subtle-foreground",
        "transition-shadow outline-none",
        "focus-visible:border-brand focus-visible:ring-brand/25 focus-visible:ring-2",
        "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
        "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20 aria-[invalid=true]:ring-2",
        className,
      )}
      {...props}
    />
  );
});
