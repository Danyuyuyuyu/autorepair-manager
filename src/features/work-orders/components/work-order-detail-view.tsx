"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Phone, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { InventoryTxBadge, WorkOrderStatusBadge } from "@/components/shared/status-badge";
import {
  ItemEditorSheet,
  type DraftItem,
} from "@/features/work-orders/components/item-editor-sheet";
import { PaymentSheet } from "@/features/work-orders/components/payment-sheet";
import { StatusSheet } from "@/features/work-orders/components/status-sheet";
import {
  ITEM_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  WORK_ORDER_STATUS_FLOW,
  WORK_ORDER_STATUS_LABELS,
} from "@/lib/constants";
import { formatDateTime, formatMoney, formatQuantity, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  addWorkOrderItemAction,
  cancelWorkOrderAction,
  deleteWorkOrderAction,
  removeWorkOrderItemAction,
  updateWorkOrderAction,
  updateWorkOrderItemAction,
} from "@/server/actions/work-order.actions";
import { voidPaymentAction } from "@/server/actions/finance.actions";
import type { WorkOrderDetailDTO, WorkOrderItemDTO } from "@/types";
import type { WorkOrderItemType } from "@prisma/client";

const TYPE_ORDER: WorkOrderItemType[] = ["SERVICE", "PART", "LABOR", "OTHER"];

export function WorkOrderDetailView({
  order,
  technicians,
  serviceItems,
  isAdmin,
}: {
  order: WorkOrderDetailDTO;
  technicians: Array<{ id: string; name: string; position: string | null }>;
  serviceItems: Array<{
    id: string;
    name: string;
    kind: "SERVICE" | "LABOR";
    unit: string;
    defaultPrice: string;
    costPrice: string;
    categoryName: string | null;
  }>;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<WorkOrderItemDTO | null>(null);
  const [pendingItemDelete, setPendingItemDelete] = React.useState<WorkOrderItemDTO | null>(null);
  const [pendingVoidPayment, setPendingVoidPayment] = React.useState<string | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [discountDraft, setDiscountDraft] = React.useState(order.discountAmount);

  const outstanding = Number(order.outstandingAmount);
  const nextStatuses = WORK_ORDER_STATUS_FLOW[order.status].filter((s) => s !== "CANCELLED");

  const refresh = () => router.refresh();

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, successText?: string) => {
    setPending(true);
    const result = await fn();
    setPending(false);
    if (!result.ok) {
      toast.error(result.error ?? "操作失败，请重试。");
      return false;
    }
    if (successText) toast.success(successText);
    refresh();
    return true;
  };

  const primaryAction = React.useMemo(() => {
    if (order.status === "CANCELLED") return null;
    if (outstanding > 0) {
      return {
        label: `收款 ${formatMoney(order.outstandingAmount, { withSymbol: false })}`,
        onClick: () => setPaymentOpen(true),
      };
    }
    if (nextStatuses.length > 0) {
      return {
        label: `下一步：${WORK_ORDER_STATUS_LABELS[nextStatuses[0]!]}`,
        onClick: () => setStatusOpen(true),
      };
    }
    return null;
  }, [order.status, order.outstandingAmount, outstanding, nextStatuses]);

  return (
    <div className="space-y-4 pb-32 lg:pb-6">
      {/* ===== 头部 ===== */}
      <div className="rounded-card border-border bg-card shadow-card border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/vehicles/${order.vehicleId}`}
                className="text-foreground hover:text-brand text-xl font-semibold tracking-wide"
              >
                {order.plateNumber}
              </Link>
              <WorkOrderStatusBadge status={order.status} />
            </div>
            <p className="tabular text-muted-foreground mt-1 text-sm">
              {order.orderNo} · {formatDateTime(order.createdAt)}
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMoreOpen(true)}
            aria-label="更多操作"
          >
            <MoreHorizontal />
          </Button>
        </div>

        {/* 金额三栏 */}
        <div className="rounded-control bg-muted/50 mt-4 grid grid-cols-3 gap-2 p-3">
          <div>
            <p className="text-muted-foreground text-xs">应收</p>
            <p className="tabular text-foreground mt-0.5 text-[17px] font-semibold">
              {formatMoney(order.totalAmount, { withSymbol: false })}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">已收</p>
            <p className="tabular text-success-strong mt-0.5 text-[17px] font-semibold">
              {formatMoney(order.paidAmount, { withSymbol: false })}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">未收</p>
            <p
              className={cn(
                "tabular mt-0.5 text-[17px] font-semibold",
                outstanding > 0 ? "text-danger-strong" : "text-muted-foreground",
              )}
            >
              {formatMoney(order.outstandingAmount, { withSymbol: false })}
            </p>
          </div>
        </div>

        {order.status !== "CANCELLED" ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setPaymentOpen(true)}
              disabled={order.status === "COMPLETED" && outstanding === 0}
            >
              <Wallet />
              收款
            </Button>
            <Button
              variant="outline"
              onClick={() => setStatusOpen(true)}
              disabled={nextStatuses.length === 0}
            >
              推进状态
            </Button>
          </div>
        ) : (
          <p className="rounded-control bg-muted text-muted-foreground mt-3 px-3 py-2 text-xs">
            该工单已取消{order.cancelReason ? ` · 原因：${order.cancelReason}` : ""}
          </p>
        )}
      </div>

      {/* ===== 客户与车辆 ===== */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-foreground text-sm font-semibold">客户与车辆</p>

          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">客户</span>
              <Link
                href={`/customers/${order.customerId}`}
                className="text-brand font-medium hover:underline"
              >
                {order.customerName}
              </Link>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">联系电话</span>
              <a
                href={`tel:${order.customerPhone}`}
                className="tabular text-brand flex items-center gap-1.5 font-medium"
              >
                <Phone className="size-3.5" />
                {order.customerPhone}
              </a>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">车型</span>
              <span className="text-foreground font-medium">
                {[order.brand, order.model, order.year ? `${order.year}款` : null]
                  .filter(Boolean)
                  .join(" ") || "-"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">VIN</span>
              <span className="tabular text-foreground truncate font-medium">
                {order.vin ?? "-"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">进厂里程</span>
              <span className="tabular text-foreground font-medium">
                {order.mileage ? `${order.mileage} km` : "-"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">负责技师</span>
              <span className="text-foreground font-medium">
                {order.technicianName ?? "未指派"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">开单员工</span>
              <span className="text-foreground font-medium">{order.createdByName ?? "-"}</span>
            </div>
          </div>

          {order.faultDescription ? (
            <div className="rounded-control bg-muted/50 p-3">
              <p className="text-muted-foreground text-xs font-medium">故障描述</p>
              <p className="text-foreground mt-1 text-sm whitespace-pre-wrap">
                {order.faultDescription}
              </p>
            </div>
          ) : null}

          {order.remark ? (
            <div className="rounded-control bg-muted/50 p-3">
              <p className="text-muted-foreground text-xs font-medium">备注</p>
              <p className="text-foreground mt-1 text-sm whitespace-pre-wrap">{order.remark}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ===== 项目清单 ===== */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-foreground text-sm font-semibold">
              维修项目与配件
              <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                {order.items.length} 项
              </span>
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={order.status === "CANCELLED"}
              onClick={() => {
                setEditingItem(null);
                setEditorOpen(true);
              }}
            >
              <Plus />
              添加
            </Button>
          </div>

          {order.items.length === 0 ? (
            <p className="rounded-control border-border text-muted-foreground border border-dashed py-6 text-center text-sm">
              还没有添加任何项目
            </p>
          ) : (
            <ul className="divide-border rounded-control border-border divide-y overflow-hidden border">
              {TYPE_ORDER.flatMap((type) =>
                order.items
                  .filter((item) => item.type === type)
                  .map((item) => (
                    <li key={item.id} className="flex items-center gap-3 px-3.5 py-3">
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
                          {formatQuantity(item.quantity, item.unit ?? undefined)} × ¥
                          {item.unitPrice}
                          {item.spec ? ` · ${item.spec}` : ""}
                          {item.remark ? ` · ${item.remark}` : ""}
                        </p>
                      </div>

                      <span className="tabular text-foreground shrink-0 text-[15px] font-semibold">
                        {formatMoney(item.amount)}
                      </span>

                      <div className="flex shrink-0 items-center">
                        <button
                          type="button"
                          aria-label="编辑"
                          disabled={order.status === "CANCELLED"}
                          onClick={() => {
                            setEditingItem(item);
                            setEditorOpen(true);
                          }}
                          className="text-muted-foreground hover:bg-muted grid size-9 place-items-center rounded-lg transition-colors disabled:opacity-40"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="删除"
                          disabled={order.status === "CANCELLED"}
                          onClick={() => setPendingItemDelete(item)}
                          className="text-danger hover:bg-danger-soft grid size-9 place-items-center rounded-lg transition-colors disabled:opacity-40"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </li>
                  )),
              )}
            </ul>
          )}

          {/* 金额汇总 */}
          <div className="rounded-control bg-muted/50 space-y-1.5 p-3.5">
            <SummaryRow label="维修项目" value={order.serviceAmount} />
            <SummaryRow label="配件" value={order.partsAmount} />
            <SummaryRow label="工时" value={order.laborAmount} />
            <SummaryRow label="其他费用" value={order.otherAmount} />
            <SummaryRow label="小计" value={order.subtotal} emphasize />
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-sm">优惠</span>
              <button
                type="button"
                disabled={order.status === "CANCELLED"}
                onClick={() => {
                  setDiscountDraft(order.discountAmount);
                  setInfoOpen(true);
                }}
                className="tabular text-brand text-sm underline-offset-4 hover:underline disabled:opacity-50"
              >
                −¥{order.discountAmount}
              </button>
            </div>
            <div className="border-border flex items-center justify-between gap-3 border-t pt-1.5">
              <span className="text-foreground text-sm font-medium">应收金额</span>
              <span className="tabular text-foreground text-base font-semibold">
                {formatMoney(order.totalAmount)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== 收款记录 ===== */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-foreground text-sm font-semibold">
            收款记录
            <span className="text-muted-foreground ml-1.5 text-xs font-normal">
              {order.payments.length} 笔
            </span>
          </p>

          {order.payments.length === 0 ? (
            <p className="rounded-control border-border text-muted-foreground border border-dashed py-5 text-center text-sm">
              还没有收款记录
            </p>
          ) : (
            <ul className="divide-border rounded-control border-border divide-y overflow-hidden border">
              {order.payments.map((payment) => (
                <li key={payment.id} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-[15px] font-medium">
                      {PAYMENT_METHOD_LABELS[payment.method]}
                      {payment.source === "MANUAL" ? " · 手工登记" : ""}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {formatDateTime(payment.occurredAt)}
                      {payment.operatorName ? ` · ${payment.operatorName}` : ""}
                      {payment.remark ? ` · ${payment.remark}` : ""}
                    </p>
                  </div>
                  <span className="tabular text-success-strong shrink-0 text-[15px] font-semibold">
                    +{formatMoney(payment.amount)}
                  </span>
                  {isAdmin ? (
                    <button
                      type="button"
                      aria-label="作废收款"
                      onClick={() => setPendingVoidPayment(payment.id)}
                      className="text-danger hover:bg-danger-soft grid size-9 shrink-0 place-items-center rounded-lg transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ===== 配件出库流水 ===== */}
      {order.inventoryTxs.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-foreground text-sm font-semibold">配件库存流水</p>
            <ul className="divide-border rounded-control border-border divide-y overflow-hidden border">
              {order.inventoryTxs.map((tx) => (
                <li key={tx.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm font-medium">{tx.partName}</p>
                    <p className="tabular text-muted-foreground text-xs">
                      {formatDateTime(tx.createdAt)} · {tx.qtyBefore} → {tx.qtyAfter}
                    </p>
                  </div>
                  <InventoryTxBadge type={tx.type} size="sm" />
                  <span className="tabular text-muted-foreground shrink-0 text-sm">
                    {tx.quantity}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* ===== 底部操作条（手机端固定） ===== */}
      <div className="border-border bg-card/95 pb-safe lg:rounded-card fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 backdrop-blur-md lg:static lg:border lg:pb-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs">
              {outstanding > 0 ? "未收金额" : "已结清"}
            </p>
            <p
              className={cn(
                "tabular truncate text-xl leading-tight font-semibold",
                outstanding > 0 ? "text-danger-strong" : "text-success-strong",
              )}
            >
              {outstanding > 0
                ? formatMoney(order.outstandingAmount)
                : formatMoney(order.paidAmount)}
            </p>
          </div>

          {primaryAction ? (
            <Button
              size="lg"
              loading={pending}
              onClick={primaryAction.onClick}
              className="shrink-0 px-6"
            >
              {primaryAction.label}
            </Button>
          ) : (
            <Badge tone="success" size="lg">
              {WORK_ORDER_STATUS_LABELS[order.status]}
            </Badge>
          )}
        </div>
      </div>

      {/* ===== 各弹层 ===== */}
      <PaymentSheet
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        workOrderId={order.id}
        orderNo={order.orderNo}
        outstandingAmount={order.outstandingAmount}
        onSuccess={refresh}
      />

      <StatusSheet
        open={statusOpen}
        onOpenChange={setStatusOpen}
        workOrderId={order.id}
        currentStatus={order.status}
        currentMileage={order.mileage}
        onSuccess={refresh}
      />

      {/* 修改工单信息 */}
      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent title="修改工单信息" description={order.orderNo}>
          <div className="space-y-4">
            <Field label="优惠金额">
              <MoneyInput value={discountDraft} onValueChange={setDiscountDraft} />
            </Field>
            <EditInfoFields order={order} technicians={technicians} />
            <Button
              block
              size="lg"
              loading={pending}
              onClick={() =>
                void run(async () => {
                  const form = document.getElementById("edit-info-form") as HTMLFormElement | null;
                  const formData = form ? new FormData(form) : null;
                  const mileageRaw = String(formData?.get("mileage") ?? "").trim();
                  return updateWorkOrderAction({
                    id: order.id,
                    mileage: mileageRaw ? Number(mileageRaw) : undefined,
                    faultDescription: String(formData?.get("faultDescription") ?? "") || undefined,
                    remark: String(formData?.get("remark") ?? "") || undefined,
                    technicianId: String(formData?.get("technicianId") ?? "") || undefined,
                    discountAmount: discountDraft || "0",
                  });
                }, "工单信息已更新").then((ok) => {
                  if (ok) setInfoOpen(false);
                })
              }
            >
              保存修改
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* 更多操作 */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent title="更多操作" description={order.orderNo}>
          <div className="space-y-2">
            <Button
              variant="outline"
              block
              size="lg"
              className="justify-start"
              onClick={() => {
                setMoreOpen(false);
                setInfoOpen(true);
              }}
            >
              <Pencil />
              修改工单信息
            </Button>

            {order.status !== "CANCELLED" ? (
              <Button
                variant="outline"
                block
                size="lg"
                className="text-danger-strong justify-start"
                onClick={() => {
                  setMoreOpen(false);
                  setCancelReason("");
                  setCancelOpen(true);
                }}
              >
                <Trash2 />
                取消工单
              </Button>
            ) : null}

            <Button
              variant="outline"
              block
              size="lg"
              className="text-danger-strong justify-start"
              disabled={!isAdmin || cancelOpen}
              onClick={() => {
                setMoreOpen(false);
                setDeleteOpen(true);
              }}
            >
              <Trash2 />
              {isAdmin ? "删除工单（管理员）" : "删除工单（仅管理员可用）"}
            </Button>

            <p className="text-muted-foreground pt-2 text-xs leading-relaxed">
              提示：取消工单会自动回滚已出库的配件库存；删除工单不可恢复，且会写入操作日志。
            </p>
          </div>
        </SheetContent>
      </Sheet>

      {/* 取消工单 */}
      <Sheet open={cancelOpen} onOpenChange={setCancelOpen}>
        <SheetContent
          title="取消工单"
          description="配件库存将自动回滚，工单状态变为「已取消」"
          footer={
            <Button
              variant="danger"
              size="lg"
              block
              loading={pending}
              onClick={() =>
                void run(
                  async () => cancelWorkOrderAction(order.id, cancelReason),
                  "工单已取消",
                ).then((ok) => {
                  if (ok) setCancelOpen(false);
                })
              }
            >
              确认取消工单
            </Button>
          }
        >
          <Field label="取消原因" required>
            <Textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="例如：客户临时不修了 / 重复开单"
            />
          </Field>
        </SheetContent>
      </Sheet>

      {/* 项目编辑 */}
      <ItemEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        serviceItems={serviceItems}
        initial={
          editingItem
            ? {
                key: editingItem.id,
                type: editingItem.type,
                itemRefId: editingItem.itemRefId ?? undefined,
                name: editingItem.name,
                spec: editingItem.spec ?? undefined,
                unit: editingItem.unit ?? undefined,
                quantity: editingItem.quantity,
                unitPrice: editingItem.unitPrice,
                costPrice: editingItem.costPrice,
                remark: editingItem.remark ?? undefined,
              }
            : null
        }
        onSubmit={(item: DraftItem) => {
          void run(
            async () => {
              if (editingItem) {
                return updateWorkOrderItemAction(editingItem.id, order.id, {
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  remark: item.remark,
                });
              }
              return addWorkOrderItemAction(order.id, {
                type: item.type,
                itemRefId: item.itemRefId,
                name: item.name,
                spec: item.spec,
                unit: item.unit,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                costPrice: item.costPrice,
                remark: item.remark,
              });
            },
            editingItem ? "项目已更新" : "已添加项目",
          );
        }}
      />

      <ConfirmDialog
        open={pendingItemDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingItemDelete(null);
        }}
        title="删除该项目？"
        description={
          pendingItemDelete
            ? pendingItemDelete.type === "PART"
              ? `「${pendingItemDelete.name}」已出库的配件数量会回滚到库存。`
              : `将从工单中移除「${pendingItemDelete.name}」。`
            : undefined
        }
        confirmText="删除"
        onConfirm={() => {
          const target = pendingItemDelete;
          setPendingItemDelete(null);
          if (target)
            void run(async () => removeWorkOrderItemAction(target.id, order.id), "项目已删除");
        }}
      />

      <ConfirmDialog
        open={pendingVoidPayment !== null}
        onOpenChange={(open) => {
          if (!open) setPendingVoidPayment(null);
        }}
        title="作废这笔收款？"
        description="作废后工单已收金额会重新计算，操作会写入日志。"
        confirmText="作废"
        onConfirm={() => {
          const target = pendingVoidPayment;
          setPendingVoidPayment(null);
          if (target)
            void run(async () => voidPaymentAction(target, "手工作废", order.id), "收款已作废");
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="彻底删除这张工单？"
        description="删除后无法恢复，仅建议用于误建单。已有收款记录的工单无法删除，请改用「取消工单」。"
        confirmText="删除工单"
        loading={pending}
        onConfirm={() =>
          void run(async () => {
            const result = await deleteWorkOrderAction(order.id);
            if (result.ok) router.replace("/work-orders");
            return result;
          }, "工单已删除")
        }
      />

      <p className="text-subtle-foreground pb-2 text-center text-xs">
        最后更新：{formatRelative(order.updatedAt)}
      </p>
    </div>
  );
}

function SummaryRow({
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
      <span className={cn("tabular text-sm", emphasize ? "font-semibold" : "")}>¥{value}</span>
    </div>
  );
}

/** 可编辑字段（独立组件避免每次输入重渲染整个详情） */
function EditInfoFields({
  order,
  technicians,
}: {
  order: WorkOrderDetailDTO;
  technicians: Array<{ id: string; name: string; position: string | null }>;
}) {
  return (
    <form id="edit-info-form" className="space-y-4">
      <Field label="进厂里程">
        <Input
          name="mileage"
          defaultValue={order.mileage ?? ""}
          inputMode="numeric"
          placeholder="km"
        />
      </Field>
      <Field label="负责技师">
        <select
          name="technicianId"
          defaultValue={technicians.find((t) => t.name === order.technicianName)?.id ?? ""}
          className="rounded-control border-input bg-card focus-visible:border-brand h-11 w-full border px-3 text-[16px] outline-none"
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
      <Field label="故障描述">
        <Textarea name="faultDescription" rows={3} defaultValue={order.faultDescription ?? ""} />
      </Field>
      <Field label="备注">
        <Textarea name="remark" rows={2} defaultValue={order.remark ?? ""} />
      </Field>
    </form>
  );
}
