"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/** 分页控件：手机端只显示「上一页 / x / n / 下一页」 */
export function Pagination({
  page,
  totalPages,
  total,
}: {
  page: number;
  totalPages: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) {
    return total > 0 ? (
      <p className="text-muted-foreground text-center text-xs">共 {total} 条记录</p>
    ) : null;
  }

  const go = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage <= 1) params.delete("page");
    else params.set("page", String(nextPage));
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: true });
  };

  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => go(page - 1)}>
        <ChevronLeft />
        上一页
      </Button>

      <span className="tabular text-muted-foreground text-xs">
        {page} / {totalPages} · 共 {total} 条
      </span>

      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => go(page + 1)}
      >
        下一页
        <ChevronRight />
      </Button>
    </div>
  );
}
