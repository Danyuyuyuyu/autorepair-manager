"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SearchInput } from "@/components/ui/search-input";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks";
import type { WorkOrderStatus } from "@prisma/client";

type FilterValue = WorkOrderStatus | "ALL" | "UNPAID";

const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "PENDING_INTAKE", label: WORK_ORDER_STATUS_LABELS.PENDING_INTAKE },
  { value: "IN_PROGRESS", label: WORK_ORDER_STATUS_LABELS.IN_PROGRESS },
  { value: "PENDING_QC", label: WORK_ORDER_STATUS_LABELS.PENDING_QC },
  { value: "UNPAID", label: "待收款" },
  { value: "COMPLETED", label: WORK_ORDER_STATUS_LABELS.COMPLETED },
  { value: "CANCELLED", label: WORK_ORDER_STATUS_LABELS.CANCELLED },
];

/**
 * 工单列表筛选。
 * 手机端：横向滚动的状态 chips（手指滑动切换，不做下拉菜单）
 * PC 端：同一组 chips 自然铺开
 */
export function WorkOrderFilters({ total }: { total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentStatus = (searchParams.get("status") ?? "ALL") as FilterValue;
  const [keyword, setKeyword] = React.useState(searchParams.get("q") ?? "");
  const debounced = useDebouncedValue(keyword, 350);

  const pushParams = React.useCallback(
    (patch: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === "") params.delete(key);
        else params.set(key, value);
      }
      params.delete("page");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // 关键词防抖后写入 URL
  React.useEffect(() => {
    const urlValue = searchParams.get("q") ?? "";
    if (debounced === urlValue) return;
    pushParams({ q: debounced || undefined });
  }, [debounced, searchParams, pushParams]);

  return (
    <div className="space-y-3">
      <SearchInput
        value={keyword}
        onValueChange={setKeyword}
        onClear={() => pushParams({ q: undefined })}
        placeholder="搜索车牌 / 客户 / 手机号 / 工单号"
      />

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {FILTERS.map((filter) => {
          const active = currentStatus === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              onClick={() =>
                pushParams({ status: filter.value === "ALL" ? undefined : filter.value })
              }
              className={cn(
                "h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors",
                active
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-card text-muted-foreground active:bg-muted",
              )}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      <p className="text-muted-foreground text-xs">共 {total} 张工单</p>
    </div>
  );
}
