"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/input";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { collectPaymentAction } from "@/server/actions/work-order.actions";
import type { PaymentMethod } from "@prisma/client";

const METHODS: PaymentMethod[] = ["WECHAT", "ALIPAY", "CASH", "BANK_CARD", "OTHER"];

const METHOD_EMOJI: Record<PaymentMethod, string> = {
  WECHAT: "微",
  ALIPAY: "支",
  CASH: "现",
  BANK_CARD: "卡",
  OTHER: "他",
};

/**
 * 收款面板。
 * 设计要点（移动端）：
 * - 默认带入「未收金额」，一键全额收款
 * - 支付方式做成大按块，避免下拉选择
 * - 数字键盘输入，不需要滑到别处
 */
export function PaymentSheet({
  open,
  onOpenChange,
  workOrderId,
  orderNo,
  outstandingAmount,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  orderNo: string;
  outstandingAmount: string;
  onSuccess?: () => void;
}) {
  const [amount, setAmount] = React.useState(outstandingAmount);
  const [method, setMethod] = React.useState<PaymentMethod>("WECHAT");
  const [remark, setRemark] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setAmount(outstandingAmount);
      setMethod("WECHAT");
      setRemark("");
    }
  }, [open, outstandingAmount]);

  const submit = async () => {
    if (Number(amount) <= 0) {
      toast.error("请输入大于 0 的收款金额。");
      return;
    }

    setSubmitting(true);
    const result = await collectPaymentAction({
      workOrderId,
      amount,
      method,
      category: "REPAIR_SERVICE",
      occurredAt: new Date().toISOString(),
      remark: remark.trim() || undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`已收款 ${formatMoney(amount)}`);
    onOpenChange(false);
    onSuccess?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="收款"
        description={`${orderNo} · 未收 ${formatMoney(outstandingAmount)}`}
        footer={
          <Button size="lg" block loading={submitting} onClick={() => void submit()}>
            {submitting ? "处理中…" : `确认收款 ${formatMoney(amount || 0)}`}
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="收款金额" required>
            <MoneyInput
              value={amount}
              onValueChange={setAmount}
              className="h-14 text-xl font-semibold"
              autoFocus
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAmount(outstandingAmount)}
              className="border-brand-border bg-brand-soft text-brand-strong h-9 rounded-full border px-3.5 text-sm font-medium"
            >
              全额 {formatMoney(outstandingAmount, { withSymbol: false })}
            </button>
            <button
              type="button"
              onClick={() => setAmount("100")}
              className="border-border bg-card text-muted-foreground h-9 rounded-full border px-3.5 text-sm"
            >
              100
            </button>
            <button
              type="button"
              onClick={() => setAmount("200")}
              className="border-border bg-card text-muted-foreground h-9 rounded-full border px-3.5 text-sm"
            >
              200
            </button>
            <button
              type="button"
              onClick={() => setAmount("500")}
              className="border-border bg-card text-muted-foreground h-9 rounded-full border px-3.5 text-sm"
            >
              500
            </button>
          </div>

          <div>
            <p className="text-foreground mb-2 text-sm font-medium">支付方式</p>
            <div className="grid grid-cols-5 gap-2">
              {METHODS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMethod(item)}
                  className={cn(
                    "rounded-control flex h-16 flex-col items-center justify-center gap-1 border text-xs font-medium transition-colors",
                    method === item
                      ? "border-brand bg-brand-soft text-brand-strong"
                      : "border-border bg-card text-muted-foreground active:bg-muted",
                  )}
                >
                  <span className="bg-card grid size-7 place-items-center rounded-full text-sm">
                    {METHOD_EMOJI[item]}
                  </span>
                  {PAYMENT_METHOD_LABELS[item]}
                </button>
              ))}
            </div>
          </div>

          <Field label="备注">
            <Textarea
              rows={2}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="选填，例如：客户微信转账"
            />
          </Field>

          <p className="rounded-control bg-muted/60 text-muted-foreground px-3 py-2 text-xs">
            收款后工单「已收金额」会自动累加，欠款同步更新；作废收款需管理员操作。
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
