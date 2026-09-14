import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "页面不存在" };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="bg-muted text-muted-foreground grid size-16 place-items-center rounded-2xl">
        <SearchX className="size-8" />
      </span>
      <div className="space-y-1">
        <h1 className="text-foreground text-lg font-semibold">页面或数据不存在</h1>
        <p className="text-muted-foreground text-sm">它可能已被删除，或者链接已经失效。</p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/dashboard">回到首页</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/work-orders">查看工单</Link>
        </Button>
      </div>
    </div>
  );
}
