"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

import { useGlobalSearch } from "@/components/layout/global-search";
import { Icon } from "@/components/shared/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/server/actions/auth.actions";
import { ROLE_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/types";

/**
 * 顶部栏。
 * 手机端：紧凑单行（返回 / 标题 / 搜索 / 更多）
 * PC 端：左侧面包屑 + 右侧用户菜单
 */
export function TopBar({
  user,
  title,
  showBack,
  showSearch = true,
}: {
  user: CurrentUser;
  title?: string;
  showBack?: boolean;
  showSearch?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const globalSearch = useGlobalSearch();
  const [loggingOut, setLoggingOut] = React.useState(false);

  const fallbackTitle = React.useMemo(() => {
    const map: Record<string, string> = {
      "/dashboard": "工作台",
      "/work-orders": "维修工单",
      "/customers": "客户",
      "/vehicles": "车辆",
      "/inventory": "配件库存",
      "/finance": "财务",
      "/reports": "报表",
      "/settings": "设置",
      "/me": "我的",
      "/search": "搜索",
    };
    const key = Object.keys(map).find((k) => pathname === k || pathname.startsWith(`${k}/`));
    return key ? map[key] : "汽修管家";
  }, [pathname]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutAction();
      router.push("/login");
      router.refresh();
    } catch {
      setLoggingOut(false);
      toast.error("退出登录失败，请重试。");
    }
  };

  const openSearch = () => {
    globalSearch.open();
  };

  return (
    <header className="border-border bg-card/95 sticky top-0 z-30 border-b backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-4 lg:h-16 lg:px-6">
        {showBack ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-2 shrink-0"
            onClick={() => router.back()}
            aria-label="返回"
          >
            <Icon name="ChevronLeft" />
          </Button>
        ) : null}

        {/* 手机端品牌标识 */}
        {!showBack ? (
          <span className="bg-brand text-brand-foreground grid size-8 shrink-0 place-items-center rounded-lg lg:hidden">
            <Icon name="Wrench" className="size-[18px]" />
          </span>
        ) : null}

        <h1 className="text-foreground lg:text-muted-foreground min-w-0 flex-1 truncate text-[17px] font-semibold lg:text-base lg:font-medium">
          {title ?? fallbackTitle}
        </h1>

        {showSearch ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={openSearch}
            aria-label="搜索"
          >
            <Icon name="Search" />
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "bg-muted text-foreground hover:bg-border-strong/50 grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold transition-colors",
              )}
              aria-label="账号菜单"
            >
              {user.name.slice(0, 1)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel>
              <span className="flex items-center justify-between gap-2">
                <span className="text-foreground truncate text-sm font-medium">{user.name}</span>
                <Badge tone={user.isAdmin ? "brand" : "neutral"} size="sm">
                  {ROLE_LABELS[user.role]}
                </Badge>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/me">
                <Icon name="UserCircle" />
                个人中心
              </Link>
            </DropdownMenuItem>
            {user.isAdmin ? (
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Icon name="Settings" />
                  系统设置
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              tone="danger"
              disabled={loggingOut}
              onSelect={(event) => {
                event.preventDefault();
                void handleLogout();
              }}
            >
              <Icon name="LogOut" />
              {loggingOut ? "正在退出…" : "退出登录"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
