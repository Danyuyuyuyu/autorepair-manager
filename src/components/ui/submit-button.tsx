"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";

export interface SubmitButtonProps extends Omit<ButtonProps, "type" | "loading"> {
  /** 自定义挂起文案 */
  pendingText?: string;
}

/**
 * 表单提交按钮：自动接入 useFormStatus，无需每个表单手写 pending 状态。
 */
export function SubmitButton({ children, pendingText, disabled, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" loading={pending} disabled={disabled || pending} {...props}>
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/** 非表单场景的本地 pending 指示 */
export function InlineSpinner({ className }: { className?: string }) {
  return <Loader2 className={className ?? "text-muted-foreground size-4 animate-spin"} />;
}
