"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, type IconName } from "@/components/shared/icon";
import { MOBILE_NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * 需要全屏专注操作、隐藏底部导航的路径（例如新建工单的收银式流程）。
 * 集中在这里声明，便于后续扩展。
 */
const FULLSCREEN_PATHS = ["/work-orders/new"];

/**
 * 移动端底部固定导航。
 * 规则：
 * - 5 个一级入口，单手可达
 * - 单行文案 + 图标，不做二级菜单
 * - 高度 64px + 安全区，主内容区通过 pb-nav 让位
 */
export function MobileNav() {
  const pathname = usePathname();

  if (FULLSCREEN_PATHS.includes(pathname)) return null;

  return (
    <nav
      className="border-border bg-card/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="主导航"
    >
      <ul className="mx-auto flex h-16 max-w-lg items-stretch">
        {MOBILE_NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
          const isDashboard = item.href === "/dashboard";
          const isActive = isDashboard ? pathname === "/dashboard" : active;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 transition-colors",
                  isActive ? "text-brand" : "text-muted-foreground active:text-foreground",
                )}
              >
                <Icon
                  name={item.icon as IconName}
                  className="size-[22px]"
                  strokeWidth={isActive ? 2.4 : 1.9}
                />
                <span className={cn("text-[11px] leading-none", isActive && "font-semibold")}>
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
