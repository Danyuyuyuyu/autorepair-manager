"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownToLine,
  ClipboardCheck,
  PackagePlus,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { StatCard } from "@/components/ui/stat-card";
import { UNIT_OPTIONS } from "@/lib/constants";
import { formatMoney, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks";
import {
  adjustStockAction,
  createPartAction,
  deletePartAction,
  purchaseInAction,
  stocktakeAction,
  updatePartAction,
} from "@/server/actions/inventory.actions";
import type { PartListItemDTO } from "@/types";

interface Option {
  id: string;
  name: string;
}

interface PartFormValue {
  id?: string;
  code: string;
  name: string;
  spec: string;
  brand: string;
  unit: string;
  categoryId: string;
  supplierId: string;
  costPrice: string;
  salePrice: string;
  safeQuantity: string;
  location: string;
  remark: string;
  initialQuantity: string;
}

const EMPTY_PART: PartFormValue = {
  code: "",
  name: "",
  spec: "",
  brand: "",
  unit: "个",
  categoryId: "",
  supplierId: "",
  costPrice: "0.00",
  salePrice: "0.00",
  safeQuantity: "0",
  location: "",
  remark: "",
  initialQuantity: "0",
};

export function InventoryListView({
  parts,
  total,
  categories,
  suppliers,
  summary,
  canDelete,
}: {
  parts: PartListItemDTO[];
  total: number;
  categories: Option[];
  suppliers: Option[];
  summary: { stockValue: string; lowStockCount: number; partsCount: number };
  canDelete: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [keyword, setKeyword] = React.useState(searchParams.get("q") ?? "");
  const [partFormOpen, setPartFormOpen] = React.useState(false);
  const [editingPart, setEditingPart] = React.useState<PartFormValue | null>(null);
  const [purchaseTarget, setPurchaseTarget] = React.useState<PartListItemDTO | null>(null);
  const [adjustTarget, setAdjustTarget] = React.useState<PartListItemDTO | null>(null);
  const [stocktakeOpen, setStocktakeOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<PartListItemDTO | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const stockFilter = (searchParams.get("stock") ?? "all") as "all" | "low" | "zero";
  const categoryId = searchParams.get("categoryId") ?? "";
  const debounced = useDebouncedValue(keyword, 350);

  const pushParams = React.useCallback(
    (patch: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (!value) params.delete(key);
        else params.set(key, value);
      }
      params.delete("page");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    const urlValue = searchParams.get("q") ?? "";
    if (debounced === urlValue) return;
    pushParams({ q: debounced || undefined });
  }, [debounced, searchParams, pushParams]);

  const openEdit = (part: PartListItemDTO) => {
    setEditingPart({
      id: part.id,
      code: part.code ?? "",
      name: part.name,
      spec: part.spec ?? "",
      brand: part.brand ?? "",
      unit: part.unit,
      categoryId: part.categoryId ?? "",
      supplierId: "",
      costPrice: part.costPrice,
      salePrice: part.salePrice,
      safeQuantity: part.safeQuantity,
      location: "",
      remark: "",
      initialQuantity: "0",
    });
    setPartFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        <StatCard
          label="库存总金额"
          value={formatMoney(summary.stockValue, { withSymbol: false })}
          unit="元"
          tone="brand"
        />
        <StatCard label="配件种类" value={summary.partsCount} unit="种" />
        <StatCard
          label="库存预警"
          value={summary.lowStockCount}
          unit="项"
          tone={summary.lowStockCount > 0 ? "warning" : "default"}
          icon={summary.lowStockCount > 0 ? AlertTriangle : undefined}
        />
      </div>

      <SearchInput
        value={keyword}
        onValueChange={setKeyword}
        placeholder="搜索配件名称 / 规格 / 编码"
      />

      <div className="space-y-2">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {(
            [
              { value: "all", label: "全部" },
              { value: "low", label: "库存不足" },
              { value: "zero", label: "已用完" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                pushParams({ stock: option.value === "all" ? undefined : option.value })
              }
              className={cn(
                "h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors",
                stockFilter === option.value
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-card text-muted-foreground active:bg-muted",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={categoryId}
            onChange={(e) => pushParams({ categoryId: e.target.value || undefined })}
            className="border-border bg-card text-foreground h-9 rounded-full border px-3 text-sm"
          >
            <option value="">全部分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <Button size="sm" variant="outline" onClick={() => setStocktakeOpen(true)}>
            <ClipboardCheck />
            盘点
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingPart(null);
              setPartFormOpen(true);
            }}
          >
            <PackagePlus />
            新增配件
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">共 {total} 种配件</p>

      {parts.length === 0 ? (
        <EmptyState title="没有找到配件" description="换个关键词，或新增一个配件档案。" />
      ) : (
        <>
          {/* 手机端卡片 */}
          <div className="space-y-2.5 lg:hidden">
            {parts.map((part) => (
              <PartCard
                key={part.id}
                part={part}
                canDelete={canDelete}
                onEdit={openEdit}
                onPurchase={setPurchaseTarget}
                onAdjust={setAdjustTarget}
                onDelete={setPendingDelete}
              />
            ))}
          </div>

          {/* PC 表格 */}
          <div className="rounded-card border-border bg-card shadow-card hidden overflow-hidden border lg:block">
            <table className="w-full text-sm">
              <thead className="border-border bg-muted/40 border-b">
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="px-4 py-3 font-medium">配件名称</th>
                  <th className="px-4 py-3 font-medium">规格</th>
                  <th className="px-4 py-3 text-right font-medium">库存</th>
                  <th className="px-4 py-3 text-right font-medium">安全库存</th>
                  <th className="px-4 py-3 text-right font-medium">进货价</th>
                  <th className="px-4 py-3 text-right font-medium">销售价</th>
                  <th className="px-4 py-3 text-right font-medium">库存金额</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((part) => (
                  <tr
                    key={part.id}
                    className="border-border hover:bg-muted/50 border-b last:border-0"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/inventory/${part.id}`}
                        className="text-brand font-medium hover:underline"
                      >
                        {part.name}
                      </Link>
                      {part.categoryName ? (
                        <span className="text-subtle-foreground ml-2 text-xs">
                          {part.categoryName}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">{part.spec ?? "-"}</td>
                    <td className="tabular px-4 py-3 text-right">
                      <span className={part.isLowStock ? "text-danger-strong font-medium" : ""}>
                        {formatQuantity(part.quantity, part.unit)}
                      </span>
                    </td>
                    <td className="tabular text-muted-foreground px-4 py-3 text-right">
                      {part.safeQuantity}
                    </td>
                    <td className="tabular px-4 py-3 text-right">¥{part.costPrice}</td>
                    <td className="tabular px-4 py-3 text-right">¥{part.salePrice}</td>
                    <td className="tabular px-4 py-3 text-right font-medium">
                      {formatMoney(part.stockValue, { withSymbol: false })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setPurchaseTarget(part)}>
                          入库
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setAdjustTarget(part)}>
                          调整
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <PartFormSheet
        open={partFormOpen}
        onOpenChange={(open) => {
          setPartFormOpen(open);
          if (!open) setEditingPart(null);
        }}
        initial={editingPart}
        categories={categories}
        suppliers={suppliers}
        onSaved={() => router.refresh()}
      />

      <PurchaseInSheet
        part={purchaseTarget}
        onOpenChange={(open) => {
          if (!open) setPurchaseTarget(null);
        }}
        suppliers={suppliers}
        onSaved={() => router.refresh()}
      />

      <AdjustStockSheet
        part={adjustTarget}
        onOpenChange={(open) => {
          if (!open) setAdjustTarget(null);
        }}
        onSaved={() => router.refresh()}
      />

      <StocktakeSheet
        open={stocktakeOpen}
        onOpenChange={setStocktakeOpen}
        parts={parts}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? `删除配件「${pendingDelete.name}」？` : "删除配件？"}
        description="仅可删除库存为 0 的配件；删除后历史工单仍保留记录。"
        confirmText="删除"
        loading={deleting}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setDeleting(true);
          const result = await deletePartAction(pendingDelete.id);
          setDeleting(false);
          setPendingDelete(null);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("配件已删除");
          router.refresh();
        }}
      />
    </div>
  );
}

function PartCard({
  part,
  canDelete,
  onEdit,
  onPurchase,
  onAdjust,
  onDelete,
}: {
  part: PartListItemDTO;
  canDelete: boolean;
  onEdit: (part: PartListItemDTO) => void;
  onPurchase: (part: PartListItemDTO) => void;
  onAdjust: (part: PartListItemDTO) => void;
  onDelete: (part: PartListItemDTO) => void;
}) {
  return (
    <div className="rounded-card border-border bg-card shadow-card border p-3.5">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/inventory/${part.id}`} className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-[16px] font-semibold">{part.name}</span>
            {part.isLowStock ? (
              <Badge tone="danger" size="sm">
                库存不足
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground truncate text-xs">
            {[part.spec, part.brand, part.categoryName].filter(Boolean).join(" · ") || "无规格"}
          </p>
          <p className="tabular text-subtle-foreground mt-1 text-xs">
            进货 ¥{part.costPrice} · 售价 ¥{part.salePrice} · 库存金额 ¥{part.stockValue}
          </p>
        </Link>

        <div className="shrink-0 text-right">
          <p
            className={cn(
              "tabular text-[19px] leading-tight font-semibold",
              part.isLowStock ? "text-danger-strong" : "text-foreground",
            )}
          >
            {formatQuantity(part.quantity)}
          </p>
          <p className="text-muted-foreground text-[11px]">{part.unit}</p>
          <p className="tabular text-subtle-foreground text-[11px]">安全 {part.safeQuantity}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => onPurchase(part)}>
          <ArrowDownToLine />
          入库
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => onAdjust(part)}>
          <SlidersHorizontal />
          调整
        </Button>
        <button
          type="button"
          aria-label="编辑"
          onClick={() => onEdit(part)}
          className="text-muted-foreground hover:bg-muted grid size-9 place-items-center rounded-lg transition-colors"
        >
          <Pencil className="size-4" />
        </button>
        {canDelete ? (
          <button
            type="button"
            aria-label="删除"
            onClick={() => onDelete(part)}
            className="text-danger hover:bg-danger-soft grid size-9 place-items-center rounded-lg transition-colors"
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 配件建档 / 编辑 */
export function PartFormSheet({
  open,
  onOpenChange,
  initial,
  categories,
  suppliers,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: PartFormValue | null;
  categories: Option[];
  suppliers: Option[];
  onSaved?: () => void;
}) {
  const [form, setForm] = React.useState<PartFormValue>(EMPTY_PART);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) setForm(initial ?? EMPTY_PART);
  }, [open, initial]);

  const set = <K extends keyof PartFormValue>(key: K, value: PartFormValue[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("请填写配件名称。");
      return;
    }
    if (Number(form.salePrice) < Number(form.costPrice)) {
      toast.error("销售价低于进货价，请确认价格是否正确。");
      return;
    }

    setSubmitting(true);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      spec: form.spec.trim(),
      brand: form.brand.trim(),
      unit: form.unit.trim() || "个",
      categoryId: form.categoryId || undefined,
      supplierId: form.supplierId || undefined,
      costPrice: form.costPrice,
      salePrice: form.salePrice,
      safeQuantity: form.safeQuantity || "0",
      location: form.location.trim(),
      remark: form.remark.trim(),
      initialQuantity: form.id ? undefined : form.initialQuantity || "0",
    };

    const result = form.id
      ? await updatePartAction(form.id, payload)
      : await createPartAction(payload);
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(form.id ? "配件已更新" : "配件已建档");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={form.id ? "编辑配件" : "新增配件"}
        description={form.id ? undefined : "建档后可直接开单出库"}
        footer={
          <Button size="lg" block loading={submitting} onClick={() => void submit()}>
            {submitting ? "保存中…" : "保存"}
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="配件名称" required>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="机油 5W-40"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="规格型号">
              <Input
                value={form.spec}
                onChange={(e) => set("spec", e.target.value)}
                placeholder="4L"
              />
            </Field>
            <Field label="品牌">
              <Input
                value={form.brand}
                onChange={(e) => set("brand", e.target.value)}
                placeholder="美孚"
              />
            </Field>
            <Field label="单位">
              <Input
                list="unit-options"
                value={form.unit}
                onChange={(e) => set("unit", e.target.value)}
                placeholder="个"
              />
              <datalist id="unit-options">
                {UNIT_OPTIONS.map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>
            </Field>
            <Field label="配件编码">
              <Input
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                placeholder="选填"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="分类">
              <select
                value={form.categoryId}
                onChange={(e) => set("categoryId", e.target.value)}
                className="rounded-control border-input bg-card focus-visible:border-brand h-11 w-full border px-3 text-[16px] outline-none"
              >
                <option value="">未分类</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="默认供应商">
              <select
                value={form.supplierId}
                onChange={(e) => set("supplierId", e.target.value)}
                className="rounded-control border-input bg-card focus-visible:border-brand h-11 w-full border px-3 text-[16px] outline-none"
              >
                <option value="">未指定</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="进货价" required>
              <MoneyInput value={form.costPrice} onValueChange={(v) => set("costPrice", v)} />
            </Field>
            <Field label="销售价" required>
              <MoneyInput value={form.salePrice} onValueChange={(v) => set("salePrice", v)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="安全库存" hint="低于该数量会预警">
              <Input
                value={form.safeQuantity}
                onChange={(e) => set("safeQuantity", e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
              />
            </Field>
            {form.id ? (
              <Field label="货架位置">
                <Input
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="A-03"
                />
              </Field>
            ) : (
              <Field label="期初库存" hint="建档时已有库存数量">
                <Input
                  value={form.initialQuantity}
                  onChange={(e) => set("initialQuantity", e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                />
              </Field>
            )}
          </div>

          <Field label="备注">
            <Textarea
              rows={2}
              value={form.remark}
              onChange={(e) => set("remark", e.target.value)}
            />
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** 采购入库 */
export function PurchaseInSheet({
  part,
  onOpenChange,
  suppliers,
  onSaved,
}: {
  part: PartListItemDTO | null;
  onOpenChange: (open: boolean) => void;
  suppliers: Option[];
  onSaved?: () => void;
}) {
  const [quantity, setQuantity] = React.useState("1");
  const [unitCost, setUnitCost] = React.useState("0.00");
  const [supplierId, setSupplierId] = React.useState("");
  const [remark, setRemark] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!part) return;
    setQuantity("1");
    setUnitCost(part.costPrice);
    setSupplierId("");
    setRemark("");
  }, [part]);

  const submit = async () => {
    if (!part) return;
    if (Number(quantity) <= 0) {
      toast.error("入库数量必须大于 0。");
      return;
    }

    setSubmitting(true);
    const result = await purchaseInAction({
      partId: part.id,
      quantity,
      unitCost,
      updateCostPrice: true,
      supplierId: supplierId || undefined,
      occurredAt: new Date().toISOString(),
      remark: remark.trim(),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success("入库成功，已同步登记一笔采购支出");
    onOpenChange(false);
    onSaved?.();
  };

  const amount = (Number(quantity) || 0) * (Number(unitCost) || 0);

  return (
    <Sheet open={part !== null} onOpenChange={onOpenChange}>
      <SheetContent
        title="采购入库"
        description={part ? `${part.name} · 当前库存 ${part.quantity}${part.unit}` : undefined}
        footer={
          <Button size="lg" block loading={submitting} onClick={() => void submit()}>
            确认入库 ¥{amount.toFixed(2)}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="入库数量" required>
              <Input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
              />
            </Field>
            <Field label="进货单价" required hint="会重算库存均价">
              <MoneyInput value={unitCost} onValueChange={setUnitCost} />
            </Field>
          </div>

          <Field label="供应商">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="rounded-control border-input bg-card focus-visible:border-brand h-11 w-full border px-3 text-[16px] outline-none"
            >
              <option value="">未指定</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="备注">
            <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" />
          </Field>

          <p className="rounded-control bg-info-soft text-info-strong px-3 py-2 text-xs">
            入库会按移动加权平均法重算库存成本，并自动生成一笔「配件采购」支出与库存流水。
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** 库存调整（以目标数量为准） */
export function AdjustStockSheet({
  part,
  onOpenChange,
  onSaved,
}: {
  part: PartListItemDTO | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [target, setTarget] = React.useState("0");
  const [remark, setRemark] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (part) {
      setTarget(part.quantity);
      setRemark("");
    }
  }, [part]);

  const submit = async () => {
    if (!part) return;
    if (!remark.trim()) {
      toast.error("请填写调整原因。");
      return;
    }

    setSubmitting(true);
    const result = await adjustStockAction({
      partId: part.id,
      targetQuantity: target,
      remark: remark.trim(),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success("库存已调整");
    onOpenChange(false);
    onSaved?.();
  };

  const delta = (Number(target) || 0) - (Number(part?.quantity) || 0);

  return (
    <Sheet open={part !== null} onOpenChange={onOpenChange}>
      <SheetContent
        title="库存调整"
        description={part ? `${part.name} · 当前 ${part.quantity}${part.unit}` : undefined}
        footer={
          <Button size="lg" block loading={submitting} onClick={() => void submit()}>
            确认调整
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="调整后数量" required hint="系统会自动计算差额并记录流水">
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              className="h-14 text-xl font-semibold"
            />
          </Field>

          <p className="tabular rounded-control bg-muted text-muted-foreground px-3 py-2 text-sm">
            差额：
            <span
              className={
                delta >= 0 ? "text-success-strong font-medium" : "text-danger-strong font-medium"
              }
            >
              {delta >= 0 ? "+" : ""}
              {delta.toFixed(2)}
            </span>
          </p>

          <Field label="调整原因" required>
            <Textarea
              rows={3}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="例如：破损报废 / 盘点差异 / 员工自用"
            />
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** 批量盘点 */
export function StocktakeSheet({
  open,
  onOpenChange,
  parts,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parts: PartListItemDTO[];
  onSaved?: () => void;
}) {
  const [counts, setCounts] = React.useState<Record<string, string>>({});
  const [remark, setRemark] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setCounts(Object.fromEntries(parts.map((part) => [part.id, part.quantity])));
    setRemark("");
  }, [open, parts]);

  const changed = parts.filter((part) => {
    const counted = counts[part.id];
    return counted !== undefined && counted !== part.quantity;
  });

  const submit = async () => {
    if (changed.length === 0) {
      toast.info("没有需要调整的配件。");
      return;
    }

    setSubmitting(true);
    const result = await stocktakeAction({
      items: changed.map((part) => ({
        partId: part.id,
        countedQuantity: counts[part.id] ?? part.quantity,
      })),
      remark: remark.trim(),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`盘点完成，调整 ${result.data.adjusted} 项`);
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="库存盘点"
        description="填写实盘数量，系统只保存有差异的项"
        footer={
          <Button size="lg" block loading={submitting} onClick={() => void submit()}>
            提交盘点（{changed.length} 项差异）
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="盘点备注">
            <Input
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="例如：月末盘点"
            />
          </Field>

          {parts.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              当前筛选结果为空，请先调整搜索条件。
            </p>
          ) : (
            <ul className="divide-border rounded-control border-border divide-y overflow-hidden border">
              {parts.map((part) => {
                const counted = counts[part.id] ?? part.quantity;
                const diff = (Number(counted) || 0) - Number(part.quantity);

                return (
                  <li key={part.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-medium">{part.name}</p>
                      <p className="tabular text-muted-foreground text-xs">
                        账面 {formatQuantity(part.quantity, part.unit)}
                        {diff !== 0 ? (
                          <span className={diff > 0 ? "text-success-strong" : "text-danger-strong"}>
                            {" "}
                            · 差异 {diff > 0 ? "+" : ""}
                            {diff.toFixed(2)}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <Input
                      value={counted}
                      onChange={(e) =>
                        setCounts((prev) => ({
                          ...prev,
                          [part.id]: e.target.value.replace(/[^\d.]/g, ""),
                        }))
                      }
                      inputMode="decimal"
                      className="w-24 shrink-0 text-center"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
