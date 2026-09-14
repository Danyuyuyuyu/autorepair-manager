import Link from "next/link";
import {
  ClipboardPlus,
  PackagePlus,
  Receipt,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface QuickAction {
  href: string;
  label: string;
  icon: LucideIcon;
  /** primary 用于最高频操作：新建维修工单 */
  tone?: "primary" | "default";
}

const ACTIONS: QuickAction[] = [
  { href: "/work-orders/new", label: "新建维修工单", icon: ClipboardPlus, tone: "primary" },
  { href: "/customers?action=new", label: "新增客户", icon: UserPlus },
  { href: "/work-orders?status=UNPAID", label: "收一笔款", icon: Wallet },
  { href: "/finance?action=expense", label: "登记支出", icon: Receipt },
  { href: "/inventory?action=purchase", label: "配件入库", icon: PackagePlus },
];

/**
 * 快捷操作区。
 * 设计取舍：把「新建维修工单」做成整行大按钮（拇指最容易点到的位置），
 * 其余 4 个高频操作排成 2×2 网格，全部满足 44px 触控标准。
 */
export function QuickActions({ canViewFinance }: { canViewFinance: boolean }) {
  const actions = ACTIONS.filter(
    (action) => canViewFinance || !["/finance?action=expense"].includes(action.href),
  );
  const primary = actions.find((a) => a.tone === "primary");
  const rest = actions.filter((a) => a.tone !== "primary");

  return (
    <div className="space-y-2.5">
      {primary ? (
        <Link
          href={primary.href}
          className="rounded-card bg-brand text-brand-foreground shadow-card active:bg-brand-hover flex h-14 items-center justify-center gap-2.5 text-base font-semibold transition-colors"
        >
          <primary.icon className="size-5" />
          {primary.label}
        </Link>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5">
        {rest.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={cn(
              "rounded-card border-border bg-card flex h-14 items-center justify-center gap-2 border px-3",
              "text-foreground shadow-soft active:bg-muted text-[15px] font-medium transition-colors",
            )}
          >
            <action.icon className="text-brand size-[18px] shrink-0" />
            <span className="truncate">{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** 首页/我的页的小型功能入口 */
export function ActionTile({
  href,
  label,
  icon: Icon,
  description,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  description?: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-card border-border bg-card shadow-soft active:bg-muted flex items-center gap-3 border px-4 py-3.5 transition-colors"
    >
      <span className="rounded-control bg-brand-soft text-brand-strong grid size-10 shrink-0 place-items-center">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-[15px] font-medium">{label}</p>
        {description ? (
          <p className="text-muted-foreground truncate text-xs">{description}</p>
        ) : null}
      </div>
    </Link>
  );
}
