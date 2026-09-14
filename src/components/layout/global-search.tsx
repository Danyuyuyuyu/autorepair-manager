"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { WORK_ORDER_STATUS_LABELS, WORK_ORDER_STATUS_TONE } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks";
import { globalSearchAction } from "@/server/actions/search.actions";
import type { GlobalSearchResult } from "@/types";

interface GlobalSearchContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const GlobalSearchContext = React.createContext<GlobalSearchContextValue | null>(null);

export function useGlobalSearch() {
  const ctx = React.useContext(GlobalSearchContext);
  if (!ctx) throw new Error("useGlobalSearch 必须在 GlobalSearchProvider 内使用");
  return ctx;
}

const EMPTY: GlobalSearchResult = { customers: [], vehicles: [], workOrders: [], parts: [] };

const HOT_KEYWORDS = ["待收款", "机油", "刹车片", "保养"];

/**
 * 全局快速搜索。
 * 手机端为全屏浮层（便于手指操作），PC 端为居中面板。
 */
export function GlobalSearchProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);

  const value = React.useMemo<GlobalSearchContextValue>(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    }),
    [isOpen],
  );

  return (
    <GlobalSearchContext.Provider value={value}>
      {children}
      {isOpen ? <GlobalSearchPanel onClose={() => setIsOpen(false)} /> : null}
    </GlobalSearchContext.Provider>
  );
}

function GlobalSearchPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [result, setResult] = React.useState<GlobalSearchResult>(EMPTY);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const debounced = useDebouncedValue(query, 220);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  React.useEffect(() => {
    const keyword = debounced.trim();
    if (!keyword) {
      setResult(EMPTY);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void globalSearchAction(keyword).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) {
        setResult(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const hasResult =
    result.workOrders.length +
      result.vehicles.length +
      result.customers.length +
      result.parts.length >
    0;

  return (
    <div className="bg-background sm:bg-overlay fixed inset-0 z-70 flex flex-col sm:items-center sm:justify-start sm:pt-[10dvh]">
      <div className="bg-background sm:rounded-card sm:border-border sm:shadow-raised flex h-full w-full flex-col sm:h-auto sm:max-h-[76dvh] sm:max-w-2xl sm:border">
        {/* 搜索头 */}
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-3">
          <Search className="text-muted-foreground size-[18px] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 客户 / 手机号 / 车牌 / 工单号 / 配件"
            className="placeholder:text-subtle-foreground h-10 min-w-0 flex-1 bg-transparent text-[16px] outline-none"
            inputMode="search"
            enterKeyHint="search"
          />
          {loading ? (
            <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭搜索"
            className="text-muted-foreground hover:bg-muted grid size-9 shrink-0 place-items-center rounded-full"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="pb-safe flex-1 overflow-y-auto overscroll-contain p-3">
          {!query.trim() ? (
            <div className="space-y-4 py-2">
              <div>
                <p className="text-muted-foreground mb-2 px-1 text-xs font-medium">常用搜索</p>
                <div className="flex flex-wrap gap-2">
                  {HOT_KEYWORDS.map((word) => (
                    <button
                      key={word}
                      type="button"
                      onClick={() => setQuery(word)}
                      className="border-border bg-card text-foreground hover:bg-muted h-9 rounded-full border px-3.5 text-sm transition-colors"
                    >
                      {word}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-muted-foreground px-1 text-xs">
                支持：客户姓名、手机号、车牌号、VIN、工单编号、配件名称
              </p>
            </div>
          ) : error ? (
            <p className="text-danger-strong py-8 text-center text-sm">{error}</p>
          ) : !hasResult && !loading ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              没有找到「{query}」相关记录
            </p>
          ) : (
            <div className="space-y-4">
              {result.workOrders.length > 0 ? (
                <Group title="维修工单">
                  {result.workOrders.map((item) => (
                    <Row key={item.id} onClick={() => go(`/work-orders/${item.id}`)}>
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-[15px] font-medium">
                          {item.plateNumber}
                        </p>
                        <p className="tabular text-muted-foreground truncate text-xs">
                          {item.orderNo}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="tabular text-foreground text-sm font-medium">
                          {formatMoney(item.totalAmount)}
                        </span>
                        <Badge className={WORK_ORDER_STATUS_TONE[item.status]} size="sm">
                          {WORK_ORDER_STATUS_LABELS[item.status]}
                        </Badge>
                      </div>
                    </Row>
                  ))}
                </Group>
              ) : null}

              {result.vehicles.length > 0 ? (
                <Group title="车辆">
                  {result.vehicles.map((item) => (
                    <Row key={item.id} onClick={() => go(`/vehicles/${item.id}`)}>
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-[15px] font-medium">
                          {item.plateNumber}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {[item.brand, item.model].filter(Boolean).join(" ") || "未填写车型"}
                        </p>
                      </div>
                      <span className="text-muted-foreground shrink-0 text-sm">
                        {item.customerName}
                      </span>
                    </Row>
                  ))}
                </Group>
              ) : null}

              {result.customers.length > 0 ? (
                <Group title="客户">
                  {result.customers.map((item) => (
                    <Row key={item.id} onClick={() => go(`/customers/${item.id}`)}>
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-[15px] font-medium">
                          {item.name}
                        </p>
                        <p className="tabular text-muted-foreground truncate text-xs">
                          {item.phone}
                        </p>
                      </div>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {item.vehicleCount} 台车
                      </span>
                    </Row>
                  ))}
                </Group>
              ) : null}

              {result.parts.length > 0 ? (
                <Group title="配件">
                  {result.parts.map((item) => (
                    <Row key={item.id} onClick={() => go(`/inventory/${item.id}`)}>
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-[15px] font-medium">
                          {item.name}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {item.spec ?? "无规格"}
                        </p>
                      </div>
                      <Badge tone={item.isLowStock ? "danger" : "neutral"} size="sm">
                        库存 {item.stockValue}
                      </Badge>
                    </Row>
                  ))}
                </Group>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-muted-foreground mb-1.5 px-1 text-xs font-medium">{title}</p>
      <div className="rounded-control border-border bg-card overflow-hidden border">{children}</div>
    </section>
  );
}

function Row({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors",
        "border-border hover:bg-muted active:bg-muted border-b last:border-b-0",
      )}
    >
      {children}
    </button>
  );
}
