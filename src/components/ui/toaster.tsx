"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * 全局 Toast。移动端统一从顶部弹出，避免被底部导航与键盘遮挡。
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      offset={16}
      duration={2600}
      visibleToasts={3}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-card !border !border-border !bg-card !text-foreground !shadow-raised !text-[15px]",
          title: "!font-medium",
          description: "!text-muted-foreground",
          success: "!border-success-border !bg-success-soft !text-success-strong",
          error: "!border-danger-border !bg-danger-soft !text-danger-strong",
          warning: "!border-warning-border !bg-warning-soft !text-warning-strong",
          info: "!border-info-border !bg-info-soft !text-info-strong",
        },
        style: {
          padding: "12px 14px",
        },
      }}
      closeButton={false}
    />
  );
}
