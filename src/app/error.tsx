"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * 全局错误边界。
 * 页面级渲染异常时展示，避免白屏；错误详情仅记录到控制台。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  const isNetwork = /fetch|network|connect/i.test(error.message);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="bg-danger-soft text-danger-strong grid size-16 place-items-center rounded-2xl">
        <AlertTriangle className="size-8" />
      </span>
      <div className="space-y-1">
        <h1 className="text-foreground text-lg font-semibold">
          {isNetwork ? "网络连接异常" : "页面加载失败"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {isNetwork ? "请检查网络后重试。" : "系统遇到了一点问题，请点击重试。"}
        </p>
      </div>
      <Button onClick={reset}>重新加载</Button>
      {error.digest ? (
        <p className="tabular text-subtle-foreground text-xs">错误编号：{error.digest}</p>
      ) : null}
    </div>
  );
}
