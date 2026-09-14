import * as React from "react";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** 统一空状态 */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-card border-border bg-card/60 flex flex-col items-center justify-center gap-3 border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <div className="bg-muted text-muted-foreground grid size-12 place-items-center rounded-full">
        {icon ?? <Inbox className="size-6" />}
      </div>
      <div className="space-y-1">
        <p className="text-foreground text-[15px] font-medium">{title}</p>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

/** 统一错误状态 */
export function ErrorState({
  title = "加载失败",
  description = "网络连接异常，请稍后重试。",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "rounded-card border-danger-border bg-danger-soft flex flex-col items-center justify-center gap-3 border px-6 py-10 text-center",
        className,
      )}
    >
      <div className="bg-card text-danger grid size-12 place-items-center rounded-full">
        <AlertCircle className="size-6" />
      </div>
      <div className="space-y-1">
        <p className="text-danger-strong text-[15px] font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw />
          重新加载
        </Button>
      ) : null}
    </div>
  );
}
