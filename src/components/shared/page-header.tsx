import * as React from "react";

import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 右上角操作（PC 端），移动端通常放在右下悬浮按钮 */
  actions?: React.ReactNode;
  backHref?: string;
  className?: string;
}

/**
 * 页面标题区。
 * PC 端为「标题 + 操作按钮」一行；移动端自动变为紧凑两行。
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-foreground truncate text-lg font-semibold sm:text-xl">{title}</h1>
        {description ? <p className="text-muted-foreground mt-0.5 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <h2 className="text-foreground text-sm font-semibold">{children}</h2>
      {action}
    </div>
  );
}

/** 定义列表：用于详情页字段展示 */
export function DescList({ className, ...props }: React.HTMLAttributes<HTMLDListElement>) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)} {...props} />
  );
}

export function DescItem({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-3 sm:block", className)}>
      <dt className="text-muted-foreground shrink-0 text-sm sm:mb-0.5">{label}</dt>
      <dd className="truncate-1 text-foreground min-w-0 text-right text-sm font-medium sm:text-left">
        {children}
      </dd>
    </div>
  );
}
