"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Car, Pencil, Plus, Search, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { ITEM_TYPE_LABELS } from "@/lib/constants";
import { calcOrderTotals, money } from "@/lib/money";
import { formatMoney, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createWorkOrderAction } from "@/server/actions/work-order.actions";
import { lookupVehicleByPlateAction } from "@/server/actions/vehicle.actions";
import {
  ItemEditorSheet,
  newDraftKey,
  type DraftItem,
  type ServiceItemOption,
} from "@/features/work-orders/components/item-editor-sheet";
import type { VehicleLookupResult } from "@/features/work-orders/types";

const TYPE_ORDER: DraftItem["type"][] = ["SERVICE", "PART", "LABOR", "OTHER"];

/**
 * 新建维修工单。
 * 目标：从进店到保存工单，手机端不超过 5 次点击。
 * 流程：查车牌 → 选车 → 填故障 → 加项目 → 保存（收款在详情页完成）
 */
export function CreateWorkOrderForm({
  serviceItems,
  technicians,
}: {
  serviceItems: ServiceItemOption[];
  technicians: Array<{ id: string; name: string; position: string | null }>;
}) {
  const router = useRouter();

  // ---- 车辆 ----
  const [plate, setPlate] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [vehicle, setVehicle] = React.useState<VehicleLookupResult | null>(null);
  const [notFound, setNotFound] = React.useState(false);

  // ---- 新客户（未找到车辆时）----
  const [customerName, setCustomerName] = React.useState("");
  const [customerPhone, setCustomerPhone] = React.useState("");
  const [vehicleBrand, setVehicleBrand] = React.useState("");
  const [vehicleModel, setVehicleModel] = React.useState("");

  // ---- 工单信息 ----
  const [mileage, setMileage] = React.useState("");
  const [faultDescription, setFaultDescription] = React.useState("");
  const [technicianId, setTechnicianId] = React.useState("");
  const [discount, setDiscount] = React.useState("0");
  const [remark, setRemark] = React.useState("");

  // ---- 项目 ----
  const [items, setItems] = React.useState<DraftItem[]>([]);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<DraftItem | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<DraftItem | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const totals = React.useMemo(
    () =>
      calcOrderTotals(
        items.map((item) => ({
          type: item.type,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          costPrice: item.costPrice ?? "0",
        })),
        discount,
      ),
    [items, discount],
  );

  const handleSearch = async () => {
    const normalized = plate.trim().toUpperCase();
    if (!normalized) {
      toast.error("请先输入车牌号。");
      return;
    }

    setSearching(true);
    const result = await lookupVehicleByPlateAction(normalized);
    setSearching(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    if (result.data) {
      setVehicle(result.data);
      setNotFound(false);
      setMileage(result.data.currentMileage ? String(result.data.currentMileage) : "");
    } else {
      setVehicle(null);
      setNotFound(true);
      toast.info("未找到该车牌，请补充客户信息后继续。");
    }
  };

  const resetVehicle = () => {
    setVehicle(null);
    setNotFound(false);
    setCustomerName("");
    setCustomerPhone("");
    setVehicleBrand("");
    setVehicleModel("");
  };

  const handleSubmit = async () => {
    if (!vehicle && !plate.trim()) {
      toast.error("请填写车牌号。");
      return;
    }
    if (!vehicle && (!customerName.trim() || !customerPhone.trim())) {
      toast.error("新车牌需要填写客户姓名与手机号。");
      return;
    }

    setSubmitting(true);
    const result = await createWorkOrderAction({
      customerId: vehicle?.customerId,
      vehicleId: vehicle?.id,
      newCustomerName: vehicle ? undefined : customerName.trim(),
      newCustomerPhone: vehicle ? undefined : customerPhone.trim(),
      newVehiclePlate: vehicle ? undefined : plate.trim().toUpperCase(),
      newVehicleBrand: vehicle ? undefined : vehicleBrand.trim() || undefined,
      newVehicleModel: vehicle ? undefined : vehicleModel.trim() || undefined,
      mileage: mileage ? Number(mileage) : undefined,
      faultDescription: faultDescription.trim() || undefined,
      remark: remark.trim() || undefined,
      technicianId: technicianId || undefined,
      discountAmount: discount || "0",
      items: items.map((item) => ({
        type: item.type,
        itemRefId: item.itemRefId,
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        costPrice: item.costPrice,
        remark: item.remark,
      })),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`工单 ${result.data.orderNo} 已创建`);
    router.replace(`/work-orders/${result.data.id}`);
  };

  return (
    <div className="space-y-4 pb-36 lg:pb-28">
      {/* ============ 1. 车辆 ============ */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
            <Car className="text-brand size-4" />
            车辆信息
          </p>

          {vehicle ? (
            <div className="rounded-control border-brand-border bg-brand-soft border p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-brand-strong text-lg font-semibold tracking-wide">
                    {vehicle.plateNumber}
                  </p>
                  <p className="text-foreground mt-0.5 truncate text-sm">
                    {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "未填写车型"}
                  </p>
                  <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                    <UserRound className="size-3.5" />
                    {vehicle.customerName} · {vehicle.customerPhone}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={resetVehicle} className="shrink-0">
                  重选
                </Button>
              </div>

              {vehicle.recentOrders.length > 0 ? (
                <div className="border-brand-border/60 mt-3 space-y-1 border-t pt-2.5">
                  <p className="text-brand-strong text-xs font-medium">最近维修</p>
                  {vehicle.recentOrders.map((order) => (
                    <p key={order.id} className="text-muted-foreground truncate text-xs">
                      {order.orderNo} · {formatMoney(order.totalAmount)}
                      {order.mileage ? ` · ${order.mileage} km` : ""}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <Field label="车牌号" required hint="输入后点击查询，可自动带出客户与历史维修记录">
                <div className="flex gap-2">
                  <Input
                    value={plate}
                    onChange={(e) => setPlate(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleSearch();
                      }
                    }}
                    placeholder="例如：粤A12345"
                    autoCapitalize="characters"
                    enterKeyHint="search"
                    className="tracking-wide"
                  />
                  <Button
                    onClick={() => void handleSearch()}
                    loading={searching}
                    className="shrink-0"
                  >
                    {!searching ? <Search /> : null}
                    查询
                  </Button>
                </div>
              </Field>

              {notFound ? (
                <div className="rounded-control border-warning-border bg-warning-soft space-y-3 border p-3.5">
                  <p className="text-warning-strong text-xs font-medium">
                    未找到该车牌，补充以下信息即可建档
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="客户姓名" required>
                      <Input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="张三"
                      />
                    </Field>
                    <Field label="手机号" required>
                      <Input
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="13800138000"
                        inputMode="tel"
                        type="tel"
                      />
                    </Field>
                    <Field label="品牌">
                      <Input
                        value={vehicleBrand}
                        onChange={(e) => setVehicleBrand(e.target.value)}
                        placeholder="大众"
                      />
                    </Field>
                    <Field label="车型">
                      <Input
                        value={vehicleModel}
                        onChange={(e) => setVehicleModel(e.target.value)}
                        placeholder="朗逸"
                      />
                    </Field>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* ============ 2. 工单信息 ============ */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-foreground text-sm font-semibold">工单信息</p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="进厂里程" hint="单位 km">
              <Input
                value={mileage}
                onChange={(e) => setMileage(e.target.value.replace(/\D/g, ""))}
                placeholder="例如 68000"
                inputMode="numeric"
              />
            </Field>
            <Field label="负责技师">
              <select
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                className="rounded-control border-input bg-card focus-visible:border-brand focus-visible:ring-brand/25 h-11 w-full border px-3 text-[16px] outline-none focus-visible:ring-2"
              >
                <option value="">未指派</option>
                {technicians.map((tech) => (
                  <option key={tech.id} value={tech.id}>
                    {tech.name}
                    {tech.position ? `（${tech.position}）` : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="故障描述">
            <Textarea
              rows={3}
              value={faultDescription}
              onChange={(e) => setFaultDescription(e.target.value)}
              placeholder="客户反映的问题，例如：踩刹车抖动，怠速不稳"
            />
          </Field>
        </CardContent>
      </Card>

      {/* ============ 3. 工项清单 ============ */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-foreground text-sm font-semibold">
              维修项目与配件
              {items.length > 0 ? (
                <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                  {items.length} 项
                </span>
              ) : null}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingItem(null);
                setEditorOpen(true);
              }}
            >
              <Plus />
              添加
            </Button>
          </div>

          {items.length === 0 ? (
            <button
              type="button"
              onClick={() => {
                setEditingItem(null);
                setEditorOpen(true);
              }}
              className="rounded-control border-border-strong bg-muted/40 active:bg-muted w-full border border-dashed px-4 py-8 text-center transition-colors"
            >
              <Plus className="text-muted-foreground mx-auto size-5" />
              <p className="text-foreground mt-1.5 text-sm font-medium">添加维修项目 / 配件</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                也可以先保存工单，接车后再逐步补充
              </p>
            </button>
          ) : (
            <ul className="divide-border rounded-control border-border divide-y overflow-hidden border">
              {TYPE_ORDER.flatMap((type) =>
                items
                  .filter((item) => item.type === type)
                  .map((item) => (
                    <li key={item.key} className="flex items-center gap-3 px-3.5 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            tone={
                              item.type === "PART"
                                ? "info"
                                : item.type === "LABOR"
                                  ? "warning"
                                  : "neutral"
                            }
                            size="sm"
                          >
                            {ITEM_TYPE_LABELS[item.type]}
                          </Badge>
                          <span className="text-foreground truncate text-[15px] font-medium">
                            {item.name}
                          </span>
                        </div>
                        <p className="tabular text-muted-foreground mt-0.5 text-xs">
                          {formatQuantity(item.quantity, item.unit)} × ¥
                          {money(item.unitPrice).toFixed(2)}
                          {item.spec ? ` · ${item.spec}` : ""}
                        </p>
                      </div>

                      <span className="tabular text-foreground shrink-0 text-[15px] font-semibold">
                        {formatMoney(money(item.quantity).times(money(item.unitPrice)))}
                      </span>

                      <div className="flex shrink-0 items-center">
                        <button
                          type="button"
                          aria-label="编辑"
                          onClick={() => {
                            setEditingItem(item);
                            setEditorOpen(true);
                          }}
                          className="text-muted-foreground hover:bg-muted grid size-9 place-items-center rounded-lg transition-colors"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="删除"
                          onClick={() => setPendingDelete(item)}
                          className="text-danger hover:bg-danger-soft grid size-9 place-items-center rounded-lg transition-colors"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </li>
                  )),
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ============ 4. 金额与备注 ============ */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-foreground text-sm font-semibold">金额与备注</p>

          <div className="rounded-control bg-muted/50 space-y-1.5 p-3.5">
            <TotalRow label="维修项目" value={totals.serviceAmount.toFixed(2)} />
            <TotalRow label="配件" value={totals.partsAmount.toFixed(2)} />
            <TotalRow label="工时" value={totals.laborAmount.toFixed(2)} />
            <TotalRow label="其他费用" value={totals.otherAmount.toFixed(2)} />
            <TotalRow label="小计" value={totals.subtotal.toFixed(2)} emphasize />
          </div>

          <Field label="优惠金额" hint="优惠后不会低于 0 元">
            <MoneyInput value={discount} onValueChange={setDiscount} placeholder="0.00" />
          </Field>

          <Field label="备注">
            <Textarea
              rows={2}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="选填，例如：客户要求使用原厂件"
            />
          </Field>
        </CardContent>
      </Card>

      {/* ============ 底部结算条 ============ */}
      <div className="border-border bg-card/95 lg:rounded-card lg:shadow-card fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 backdrop-blur-md lg:static lg:border">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs">应收金额</p>
            <p className="tabular text-foreground truncate text-2xl leading-tight font-semibold">
              {formatMoney(totals.totalAmount)}
            </p>
          </div>
          <Button
            size="lg"
            loading={submitting}
            onClick={() => void handleSubmit()}
            className="shrink-0 px-8"
          >
            {submitting ? "保存中…" : "保存工单"}
          </Button>
        </div>
      </div>

      {/* 项目编辑面板 */}
      <ItemEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editingItem}
        serviceItems={serviceItems}
        onSubmit={(item) => {
          setItems((prev) => {
            if (editingItem)
              return prev.map((existing) => (existing.key === item.key ? item : existing));
            return [...prev, { ...item, key: item.key || newDraftKey() }];
          });
          toast.success(editingItem ? "已更新项目" : "已添加到工单");
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="删除该项目？"
        description={pendingDelete ? `将从工单中移除「${pendingDelete.name}」。` : undefined}
        confirmText="删除"
        onConfirm={() => {
          setItems((prev) => prev.filter((item) => item.key !== pendingDelete?.key));
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

function TotalRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span
        className={cn(
          "text-sm",
          emphasize ? "text-foreground font-medium" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "tabular text-sm",
          emphasize ? "text-foreground font-semibold" : "text-foreground",
        )}
      >
        ¥{value}
      </span>
    </div>
  );
}
