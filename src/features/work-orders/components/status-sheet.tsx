"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { WORK_ORDER_STATUS_FLOW, WORK_ORDER_STATUS_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { changeWorkOrderStatusAction } from "@/server/actions/work-order.actions";
import type { WorkOrderStatus } from "@prisma/client";

/** 状态推进面板：只展示「允许流转到」的状态，避免误操作 */
export function StatusSheet({
  open,
  onOpenChange,
  workOrderId,
  currentStatus,
  currentMileage,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  currentStatus: WorkOrderStatus;
  currentMileage: number | null;
  onSuccess?: () => void;
}) {
  const targets = React.useMemo(
    () => WORK_ORDER_STATUS_FLOW[currentStatus].filter((status) => status !== "CANCELLED"),
    [currentStatus],
  );

  const [target, setTarget] = React.useState<WorkOrderStatus | null>(targets[0] ?? null);
  const [mileage, setMileage] = React.useState(currentMileage ? String(currentMileage) : "");
  const [createServiceRecord, setCreateServiceRecord] = React.useState(true);
  const [serviceDescription, setServiceDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTarget(targets[0] ?? null);
    setMileage(currentMileage ? String(currentMileage) : "");
    setServiceDescription("");
    setCreateServiceRecord(true);
  }, [open, targets, currentMileage]);

  if (targets.length === 0) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          title="工单状态"
          description={`当前状态：${WORK_ORDER_STATUS_LABELS[currentStatus]}`}
        >
          <p className="text-muted-foreground py-6 text-center text-sm">
            该工单已处于终态，无法继续流转。
          </p>
        </SheetContent>
      </Sheet>
    );
  }

  const submit = async () => {
    if (!target) return;

    setSubmitting(true);
    const result = await changeWorkOrderStatusAction({
      id: workOrderId,
      status: target,
      mileage: mileage ? Number(mileage) : undefined,
      createServiceRecord: target === "COMPLETED" ? createServiceRecord : false,
      serviceDescription: serviceDescription.trim() || undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`工单已更新为「${WORK_ORDER_STATUS_LABELS[target]}」`);
    onOpenChange(false);
    onSuccess?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="推进工单状态"
        description={`当前：${WORK_ORDER_STATUS_LABELS[currentStatus]}`}
        footer={
          <Button
            size="lg"
            block
            loading={submitting}
            disabled={!target}
            onClick={() => void submit()}
          >
            确认变更
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            {targets.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setTarget(status)}
                className={cn(
                  "rounded-control flex h-12 w-full items-center justify-between border px-4 text-[15px] font-medium transition-colors",
                  target === status
                    ? "border-brand bg-brand-soft text-brand-strong"
                    : "border-border bg-card text-foreground active:bg-muted",
                )}
              >
                {WORK_ORDER_STATUS_LABELS[status]}
                {target === status ? <span className="text-xs">已选择</span> : null}
              </button>
            ))}
          </div>

          <Field label="交车里程" hint="填了会同步更新车辆当前里程">
            <Input
              value={mileage}
              onChange={(e) => setMileage(e.target.value.replace(/\D/g, ""))}
              placeholder="例如 68500"
              inputMode="numeric"
            />
          </Field>

          {target === "COMPLETED" ? (
            <div className="rounded-control border-border bg-muted/40 space-y-3 border p-3.5">
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={createServiceRecord}
                  onChange={(e) => setCreateServiceRecord(e.target.checked)}
                  className="size-5 accent-[var(--color-brand)]"
                />
                <span className="text-foreground text-sm">同时生成保养记录</span>
              </label>

              {createServiceRecord ? (
                <Field label="保养内容">
                  <Textarea
                    rows={2}
                    value={serviceDescription}
                    onChange={(e) => setServiceDescription(e.target.value)}
                    placeholder="例如：更换机油机滤、四轮定位"
                  />
                </Field>
              ) : null}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
