"use client";

import * as React from "react";
import { AlertTriangle, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks";
import {
  PLATE_SUGGEST_MIN_LENGTH,
  isPlausiblePlate,
  normalizePlate,
  plateMatchKeyword,
} from "@/lib/plate";
import { cn } from "@/lib/utils";
import { suggestVehiclesByPlateAction } from "@/server/actions/vehicle.actions";
import type { VehiclePlateSuggestion } from "@/features/work-orders/types";

/** 与 item-editor-sheet 的配件检索保持一致 */
const DEBOUNCE_MS = 250;

/**
 * 「输入部分车牌 → 内联候选 → 点选锁定」（ADR-017）。
 *
 * 几条刻意的选择：
 * · 候选**内联展开**而不是浮层 —— 表单本来就在纵向滚动，浮层会被手机软键盘顶飞。
 * · 请求带**序号守卫** —— 防抖之后仍会有在途请求，先发后到的旧结果必须丢弃。
 * · 失败**不弹 toast** —— 打字过程中 toast 会连成一片，这里内联降级并保留上一轮候选。
 * · 「新建车辆」必须**显式点击**，且只有车牌格式合法时才能点 ——
 *   这是拦住「输了一半就建档」的第一道闸门（Server Action 的 schema 是第二道）。
 * · 建档前会用「去掉最后一位」再查一次 —— 错一位是最常见的重复建档来源，
 *   而 contains 匹配在原关键字上抓不到它（见 requestCreateNew）。
 */
export function VehiclePlateSuggest({
  value,
  onValueChange,
  onSearch,
  searching,
  onPick,
  onConfirmCreateNew,
  createNewOpen,
}: {
  /** 已归一化的车牌输入值 */
  value: string;
  onValueChange: (next: string) => void;
  /** 精确查询（回车 / 点「查询」）—— 保留原有行为 */
  onSearch: () => void;
  /** 精确查询进行中 */
  searching: boolean;
  /** 点了候选：父组件用完整车牌去精确查询并锁定车辆 */
  onPick: (plateNumber: string) => void;
  /** 用户确认「按当前车牌新建车辆」（已过近似候选确认） */
  onConfirmCreateNew: () => void;
  /** 建档面板已展开：不再展示候选与新建入口 */
  createNewOpen: boolean;
}) {
  const debounced = useDebouncedValue(value, DEBOUNCE_MS);
  const keyword = plateMatchKeyword(value);

  const [suggestions, setSuggestions] = React.useState<VehiclePlateSuggestion[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [queriedKeyword, setQueriedKeyword] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [attempt, setAttempt] = React.useState(0);
  const [nearMiss, setNearMiss] = React.useState<VehiclePlateSuggestion[]>([]);
  const [nearMissOpen, setNearMissOpen] = React.useState(false);
  const [checkingNearMiss, setCheckingNearMiss] = React.useState(false);

  const seqRef = React.useRef(0);
  const listRef = React.useRef<HTMLUListElement>(null);

  const longEnough = keyword.length >= PLATE_SUGGEST_MIN_LENGTH;
  const plateLooksValid = isPlausiblePlate(value);

  React.useEffect(() => {
    if (createNewOpen) return;

    const target = plateMatchKeyword(debounced);
    if (target.length < PLATE_SUGGEST_MIN_LENGTH) {
      seqRef.current += 1; // 让在途请求失效
      setSuggestions([]);
      setQueriedKeyword(null);
      setLoading(false);
      setFailed(false);
      setDismissed(false);
      setActiveIndex(-1);
      return;
    }

    const seq = ++seqRef.current; // 序号守卫：只有最后一次请求能写状态
    setLoading(true);
    setDismissed(false);

    void suggestVehiclesByPlateAction(debounced).then((res) => {
      if (seq !== seqRef.current) return;
      setLoading(false);
      if (!res.ok) {
        // 保留上一轮候选 + 内联重试，不弹 toast
        setFailed(true);
        return;
      }
      setFailed(false);
      setSuggestions(res.data.items);
      setHasMore(res.data.hasMore);
      setQueriedKeyword(target);
      setActiveIndex(-1);
    });
  }, [debounced, attempt, createNewOpen]);

  const showList = !createNewOpen && longEnough && !dismissed && suggestions.length > 0;
  const showNoMatch =
    !createNewOpen &&
    longEnough &&
    !dismissed &&
    suggestions.length === 0 &&
    !loading &&
    queriedKeyword === keyword;

  // 候选「首次出现」时把它带进可视区（block: nearest，不做 center 免得页面猛跳）。
  // 依赖 showList 本身，所以连续打字时不会每敲一下都滚一次。
  React.useEffect(() => {
    if (!showList) return;
    listRef.current?.scrollIntoView({ block: "nearest" });
  }, [showList]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const picked = showList ? suggestions[activeIndex] : undefined;
      if (picked) {
        onPick(picked.plateNumber);
        return;
      }
      onSearch();
      return;
    }
    if (!showList) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (event.key === "Escape") {
      setActiveIndex(-1);
      setDismissed(true);
    }
  };

  /**
   * 按当前车牌建档。建档前用**去掉最后一位**的关键字再查一次：
   * 前台打错最后一位（粤A1234**S** vs 粤A1234**5**）是最常见的重复建档来源，
   * 而 `contains` 匹配在原关键字上抓不到它。查到相近车牌就先摆出来确认。
   */
  const requestCreateNew = async () => {
    if (!plateLooksValid) return;

    const stem = plateMatchKeyword(value).slice(0, -1);
    if (stem.length < PLATE_SUGGEST_MIN_LENGTH) {
      onConfirmCreateNew();
      return;
    }

    setCheckingNearMiss(true);
    const res = await suggestVehiclesByPlateAction(stem);
    setCheckingNearMiss(false);

    const target = plateMatchKeyword(value);
    const hits = res.ok
      ? res.data.items.filter((item) => plateMatchKeyword(item.plateNumber) !== target)
      : [];

    if (hits.length === 0) {
      onConfirmCreateNew();
      return;
    }

    setNearMiss(hits);
    setNearMissOpen(true);
  };

  return (
    <div className="space-y-3">
      <Field
        label="车牌号"
        required
        hint={
          longEnough
            ? "输入即联想，点候选即可锁定；也可以按回车精确查询"
            : "输入 2 个字符以上会自动联想，可自动带出客户与历史维修记录"
        }
      >
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => onValueChange(normalizePlate(e.target.value))}
            onKeyDown={handleKeyDown}
            placeholder="例如：粤A12345"
            autoCapitalize="characters"
            autoComplete="off"
            enterKeyHint="search"
            role="combobox"
            aria-expanded={showList}
            aria-controls="vehicle-plate-suggest-list"
            aria-activedescendant={
              showList && activeIndex >= 0 ? `vehicle-plate-option-${activeIndex}` : undefined
            }
            className="tracking-wide"
          />
          <Button onClick={onSearch} loading={searching} className="shrink-0">
            {!searching ? <Search /> : null}
            查询
          </Button>
        </div>
      </Field>

      {createNewOpen ? null : (
        <>
          {showList ? (
            <ul
              ref={listRef}
              id="vehicle-plate-suggest-list"
              role="listbox"
              aria-label="车牌候选"
              className="rounded-control border-border divide-border divide-y overflow-hidden border"
            >
              {suggestions.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    id={`vehicle-plate-option-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => onPick(item.plateNumber)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors",
                      index === activeIndex ? "bg-brand-soft" : "active:bg-muted",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground text-[15px] font-semibold tracking-wide">
                        {item.plateNumber}
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {[item.brand, item.model].filter(Boolean).join(" ") || "未填写车型"}
                        {item.vinLast4 ? ` · VIN …${item.vinLast4}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-foreground text-xs font-medium">{item.customerName}</p>
                      <p className="tabular text-muted-foreground mt-0.5 text-xs">
                        {item.lastVisitAt
                          ? `${item.lastVisitAt.slice(0, 10)} 进厂 · ${item.workOrderCount} 次`
                          : "暂无维修记录"}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
              {hasMore ? (
                <li className="bg-muted/40 text-muted-foreground px-3.5 py-2 text-xs">
                  还有更多候选，请继续输入以缩小范围
                </li>
              ) : null}
            </ul>
          ) : null}

          {failed ? (
            <p className="text-danger-strong text-xs">
              车牌联想暂时不可用（可能是网络或登录已过期）。
              <button
                type="button"
                onClick={() => setAttempt((prev) => prev + 1)}
                className="ml-1 underline underline-offset-2"
              >
                重试
              </button>
            </p>
          ) : null}

          {showNoMatch ? (
            <div className="rounded-control border-border bg-muted/40 space-y-2 border px-3.5 py-3">
              <p className="text-muted-foreground text-xs">没有匹配的车牌。</p>
              {plateLooksValid ? (
                <button
                  type="button"
                  disabled={checkingNearMiss}
                  onClick={() => void requestCreateNew()}
                  className="text-brand-strong flex items-center gap-1.5 text-xs font-medium disabled:opacity-60"
                >
                  <Plus className="size-3.5" />
                  {checkingNearMiss ? "正在核对相近车牌…" : `以「${value}」新建车辆`}
                </button>
              ) : null}
            </div>
          ) : null}

          {longEnough && !plateLooksValid ? (
            <p className="text-warning-strong flex items-start gap-1.5 text-xs">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              车牌号看起来不完整（如：粤A12345），补齐后才能新建车辆。
            </p>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={nearMissOpen}
        onOpenChange={setNearMissOpen}
        tone="primary"
        title={`没找到「${value}」`}
        cancelText="返回选择"
        confirmText="仍然新建"
        description={
          <span>
            但找到 {nearMiss.length} 条相近的车牌，确认都不是吗？
            <span className="mt-1.5 block space-y-0.5">
              {nearMiss.slice(0, 3).map((item) => (
                <span key={item.id} className="block">
                  {item.plateNumber} · {item.customerName}
                </span>
              ))}
            </span>
          </span>
        }
        onConfirm={() => {
          setNearMissOpen(false);
          onConfirmCreateNew();
        }}
      />
    </div>
  );
}
