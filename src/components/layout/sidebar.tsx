"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, type IconName } from "@/components/shared/icon";
import { NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/types";

/**
 * PC 端左侧 Sidebar。
 * 与手机端共用同一份 NAV_ITEMS，只是呈现方式不同（不是把手机布局放大）。
 */
export function Sidebar({ user }: { user: CurrentUser }) {
  const pathname = usePathname();

  const visible = NAV_ITEMS.filter((item) => !item.adminOnly || user.isAdmin);
  const main = visible.filter((item) => item.mobile || item.href === "/vehicles");
  const admin = visible.filter((item) => item.adminOnly);

  const renderItem = (item: (typeof NAV_ITEMS)[number]) => {
    const isActive =
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "rounded-control flex h-11 items-center gap-3 px-3 text-[15px] font-medium transition-colors",
          isActive
            ? "bg-brand-soft text-brand-strong"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Icon
          name={item.icon as IconName}
          className="size-[18px]"
          strokeWidth={isActive ? 2.3 : 1.9}
        />
        {item.label}
      </Link>
    );
  };

  return (
    <aside className="border-border bg-card fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r lg:flex">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <span className="rounded-control bg-brand text-brand-foreground grid size-9 place-items-center">
          <Icon name="Wrench" className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-foreground truncate text-[15px] leading-tight font-semibold">
            汽修管家
          </p>
          <p className="text-muted-foreground truncate text-[11px]">维修店管理系统</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4" aria-label="主导航">
        {main.map(renderItem)}

        {admin.length > 0 ? (
          <>
            <p className="text-subtle-foreground px-3 pt-4 pb-1.5 text-[11px] font-medium tracking-wide">
              管理
            </p>
            {admin.map(renderItem)}
          </>
        ) : null}
      </nav>
    </aside>
  );
}
