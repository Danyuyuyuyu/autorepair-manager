"use client";

import * as React from "react";
import { Loader2, PackageSearch, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { MoneyInput, QuantityStepper } from "@/components/ui/money-input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ITEM_TYPE_LABELS, UNIT_OPTIONS } from "@/lib/constants";
import { lineAmount } from "@/lib/money";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks";
import { searchPartsPickerAction } from "@/server/actions/inventory.actions";
import type { WorkOrderItemType } from "@prisma/client";

export interface DraftItem {
  key: string;
  type: WorkOrderItemType;
  itemRefId?: string;
  name: string;
  spec?: string;
  unit?: string;
  quantity: string;
  unitPrice: string;
  costPrice?: string;
  remark?: string;
}

export interface ServiceItemOption {
  id: string;
  name: string;
  kind: "SERVICE" | "LABOR";
  unit: string;
  defaultPrice: string;
  costPrice: string;
  categoryName: string | null;
}

interface PartOption {
  id: string;
  name: string;
  spec: string | null;
  unit: string;
  salePrice: string;
  costPrice: string;
  stock: string;
}

const TYPE_TABS: Array<{ value: WorkOrderItemType; label: string }> = [
  { value: "SERVICE", label: "维修项目" },
  { value: "PART", label: "配件" },
  { value: "LABOR", label: "工时" },
  { value: "OTHER", label: "其他费用" },
];

export function newDraftKey() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * 添加工单项面板（底部抽屉）。
 * 手机端用 Bottom Sheet，避免大弹窗遮挡表单与键盘。
 */
export function ItemEditorSheet({
  open,
  onOpenChange,
  initial,
  serviceItems,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入则为编辑模式 */
  initial?: DraftItem | null;
  serviceItems: ServiceItemOption[];
  onSubmit: (item: DraftItem) => void;
}) {
  const [type, setType] = React.useState<WorkOrderItemType>(initial?.type ?? "SERVICE");
  const [keyword, setKeyword] = React.useState("");
  const [name, setName] = React.useState(initial?.name ?? "");
  const [spec, setSpec] = React.useState(initial?.spec ?? "");
  const [unit, setUnit] = React.useState(initial?.unit ?? "个");
  const [quantity, setQuantity] = React.useState(initial?.quantity ?? "1");
  const [unitPrice, setUnitPrice] = React.useState(initial?.unitPrice ?? "");
  const [remark, setRemark] = React.useState(initial?.remark ?? "");
  const [itemRefId, setItemRefId] = React.useState<string | undefined>(initial?.itemRefId);
  const [costPrice, setCostPrice] = React.useState<string | undefined>(initial?.costPrice);

  const [parts, setParts] = React.useState<PartOption[]>([]);
  const [partsLoading, setPartsLoading] = React.useState(false);
  const debouncedKeyword = useDebouncedValue(keyword, 250);

  // 每次打开重置表单
  React.useEffect(() => {
    if (!open) return;
    setType(initial?.type ?? "SERVICE");
    setKeyword("");
    setName(initial?.name ?? "");
    setSpec(initial?.spec ?? "");
    setUnit(initial?.unit ?? (initial?.type === "PART" ? "个" : "项"));
    setQuantity(initial?.quantity ?? "1");
    setUnitPrice(initial?.unitPrice ?? "");
    setRemark(initial?.remark ?? "");
    setItemRefId(initial?.itemRefId);
    setCostPrice(initial?.costPrice);
    setParts([]);
  }, [open, initial]);

  // 配件检索
  React.useEffect(() => {
    if (!open || type !== "PART") return;
    let cancelled = false;
    setPartsLoading(true);

    void searchPartsPickerAction(debouncedKeyword).then((res) => {
      if (cancelled) return;
      setPartsLoading(false);
      if (res.ok) setParts(res.data);
      else toast.error(res.error);
    });

    return () => {
      cancelled = true;
    };
  }, [open, type, debouncedKeyword]);

  const catalog = React.useMemo(() => {
    const pool = serviceItems.filter(
      (item) => item.kind === (type === "LABOR" ? "LABOR" : "SERVICE"),
    );
    const kw = keyword.trim().toLowerCase();
    if (!kw) return pool.slice(0, 30);
    return pool.filter((item) => item.name.toLowerCase().includes(kw));
  }, [serviceItems, type, keyword]);

  // 配件模式下 serviceItems 不参与展示
  const list = type === "PART" ? parts : type === "OTHER" ? [] : catalog;

  const pickCatalog = (option: ServiceItemOption | PartOption) => {
    setName(option.name);
    if ("spec" in option) setSpec(option.spec ?? "");
    setUnit(option.unit);
    setItemRefId(option.id);
    setCostPrice("costPrice" in option ? option.costPrice : undefined);
    setUnitPrice(
      "salePrice" in option ? option.salePrice : (option as ServiceItemOption).defaultPrice,
    );
    if (!quantity || quantity === "0") setQuantity("1");
  };

  const amount = lineAmount(quantity || "0", unitPrice || "0");

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error("请填写项目名称或从下方选择。");
      return;
    }
    if (Number(quantity) <= 0) {
      toast.error("数量必须大于 0。");
      return;
    }

    onSubmit({
      key: initial?.key ?? newDraftKey(),
      type,
      itemRefId,
      name: name.trim(),
      spec: spec.trim() || undefined,
      unit,
      quantity: quantity || "1",
      unitPrice: unitPrice || "0",
      costPrice,
      remark: remark.trim() || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={initial ? "修改项目" : "添加项目"}
        description={initial ? "调整数量或价格后保存" : "选择维修项目、配件或手工录入"}
        footer={
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground text-xs">小计</p>
              <p className="tabular text-foreground truncate text-lg font-semibold">
                {formatMoney(amount)}
              </p>
            </div>
            <Button size="lg" onClick={handleSubmit} className="shrink-0">
              {initial ? "保存修改" : "添加到工单"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Tabs value={type} onValueChange={(value: string) => setType(value as WorkOrderItemType)}>
            <TabsList>
              {TYPE_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* 检索 */}
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={
                type === "PART"
                  ? "搜索配件名称 / 规格"
                  : type === "OTHER"
                    ? "其他费用无需检索"
                    : "搜索项目名称"
              }
              disabled={type === "OTHER"}
              className={cn(
                "rounded-control border-input bg-card h-11 w-full border pr-3 pl-10 text-[16px] outline-none",
                "focus-visible:border-brand focus-visible:ring-brand/25 focus-visible:ring-2",
                "disabled:bg-muted disabled:text-muted-foreground",
              )}
            />
          </div>

          {/* 候选列表 */}
          {type !== "OTHER" ? (
            <div className="rounded-control border-border max-h-64 overflow-hidden border">
              {type === "PART" && partsLoading ? (
                <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  正在检索配件…
                </div>
              ) : list.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {type === "PART"
                    ? "没有找到配件，可在下方手工录入"
                    : "没有匹配的项目，可在下方手工录入"}
                </p>
              ) : (
                <ul className="divide-border max-h-64 divide-y overflow-y-auto overscroll-contain">
                  {(list as Array<ServiceItemOption | PartOption>).map((option) => {
                    const isPart = "salePrice" in option;
                    const selected = itemRefId === option.id;
                    return (
                      <li key={option.id}>
                        <button
                          type="button"
                          onClick={() => pickCatalog(option)}
                          className={cn(
                            "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors",
                            selected ? "bg-brand-soft" : "active:bg-muted",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-foreground truncate text-[15px] font-medium">
                              {option.name}
                            </p>
                            <p className="text-muted-foreground truncate text-xs">
                              {isPart
                                ? `${option.spec ?? "无规格"} · 库存 ${option.stock}${option.unit}`
                                : (option.categoryName ?? "未分类")}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="tabular text-foreground text-[15px] font-semibold">
                              ¥{isPart ? option.salePrice : option.defaultPrice}
                            </p>
                            {isPart && Number(option.stock) <= 0 ? (
                              <p className="text-danger-strong text-[11px]">无库存</p>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}

          {/* 手工录入 / 微调 */}
          <div className="rounded-control border-border bg-muted/40 space-y-3 border p-3.5">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <PackageSearch className="size-3.5" />
              {type === "PART" ? "配件信息" : "项目信息"}
            </p>

            <Field label="名称" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：更换机油"
              />
            </Field>

            {type === "PART" ? (
              <Field label="规格型号">
                <Input
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  placeholder="例如：5W-40 4L"
                />
              </Field>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label="数量">
                <QuantityStepper value={quantity} onValueChange={setQuantity} min={0.01} step={1} />
              </Field>
              <Field label="单位">
                <Input
                  list="unit-options"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="个"
                />
                <datalist id="unit-options">
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </Field>
            </div>

            <Field label="单价" required hint="店长可修改价格；员工如需改价请联系管理员">
              <MoneyInput value={unitPrice} onValueChange={setUnitPrice} placeholder="0.00" />
            </Field>

            <Field label="备注">
              <Textarea
                rows={2}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="选填，例如：客户自带配件"
              />
            </Field>
          </div>

          <p className="text-subtle-foreground text-center text-xs">
            {ITEM_TYPE_LABELS[type]} · 单价 × 数量 = {formatMoney(amount)}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
