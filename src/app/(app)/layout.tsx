import * as React from "react";

import { MobileNav } from "@/components/layout/mobile-nav";
import { GlobalSearchProvider } from "@/components/layout/global-search";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { requireUser } from "@/server/auth/guard";

/**
 * 已登录区域外壳。
 * - 手机（< 1024px）：顶部栏 + 内容 + 底部固定导航
 * - PC（>= 1024px）：左侧 Sidebar + 顶部栏 + 居中内容区
 * 同一份 children，由 CSS 决定布局，而不是渲染两套页面。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <GlobalSearchProvider>
      <div className="bg-background min-h-dvh">
        <Sidebar user={user} />

        <div className="lg:pl-60">
          <TopBar user={user} />
          <main className="pb-nav mx-auto w-full max-w-6xl px-4 pt-4 lg:px-8 lg:pt-6 lg:pb-12">
            {children}
          </main>
        </div>

        <MobileNav />
      </div>
    </GlobalSearchProvider>
  );
}
