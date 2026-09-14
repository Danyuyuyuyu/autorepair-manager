"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EXPENSE_CATEGORY_LABELS,
  INCOME_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/constants";
import { formatMoney, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  createExpenseAction,
  deleteExpenseAction,
  updateExpenseAction,
} from "@/server/actions/finance.actions";
import type { CashFlowEntry, ExpenseDTO, FinanceSummaryDTO } from "@/types";
import type { ExpenseCategory, PaymentMethod } from "@prisma/client";

export type FinanceSummaryView = FinanceSummaryDTO;

const RANGES = [
  { value: "today", label: "今日" },
  { value: "week", label: "近 7 天" },
  { value: "month", label: "本月" },
  { value: "custom", label: "自定义" },
] as const;

export function FinanceView({
  summary,
  cashFlow,
  expenses,
  range,
  from,
  to,
  suppliers,
}: {
  summary: FinanceSummaryView;
  cashFlow: CashFlowEntry[];
  expenses: ExpenseDTO[];
  range: string;
  from: string;
  to: string;
  suppliers: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [expenseFormOpen, setExpenseFormOpen] = React.useState(
    searchParams.get("action") === "expense",
  );
  const [editingExpense, setEditingExpense] = React.useState<ExpenseDTO | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<ExpenseDTO | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [customFrom, setCustomFrom] = React.useState(from);
  const [customTo, setCustomTo] = React.useState(to);

  const pushParams = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="space-y-4">
      {/* 统计区间 */}
      <div className="space-y-2">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {RANGES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => pushParams({ range: option.value })}
              className={cn(
                "h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors",
                range === option.value
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-card text-muted-foreground active:bg-muted",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {range === "custom" ? (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="flex-1"
            />
            <span className="text-muted-foreground">至</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={() => pushParams({ from: customFrom, to: customTo })}
              className="shrink-0"
            >
              查询
            </Button>
          </div>
        ) : null}
      </div>

      {/* 核心指标 */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="营业收入"
          value={formatMoney(summary.income, { withSymbol: false })}
          unit="元"
          icon={TrendingUp}
          tone="success"
        />
        <StatCard
          label="店铺支出"
          value={formatMoney(summary.expense, { withSymbol: false })}
          unit="元"
          icon={TrendingDown}
          tone="danger"
        />
        <StatCard
          label="经营利润"
          value={formatMoney(summary.profit, { withSymbol: false })}
          unit="元"
          tone={Number(summary.profit) >= 0 ? "success" : "danger"}
          hint="收入 − 支出"
        />
        <StatCard
          label="毛利润"
          value={formatMoney(summary.grossProfit, { withSymbol: false })}
          unit="元"
          tone="brand"
          hint={`配件成本 ${formatMoney(summary.partsCost, { withSymbol: false })}`}
        />
      </div>

      <p className="rounded-card border-warning-border bg-warning-soft text-warning-strong border px-3.5 py-2.5 text-xs leading-relaxed">
        注意：营业额 ≠ 利润。毛利 = 营业收入 − 配件成本；经营利润 = 营业收入 −
        全部支出（含房租、工资等固定成本）。
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 收入构成 */}
        <div className="rounded-card border-border bg-card shadow-card border p-4">
          <p className="text-foreground text-sm font-semibold">收入构成</p>
          {summary.incomeByCategory.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">该区间暂无收入。</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {summary.incomeByCategory.map((item) => (
                <li key={item.category}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground">{INCOME_CATEGORY_LABELS[item.category]}</span>
                    <span className="tabular font-medium">{formatMoney(item.amount)}</span>
                  </div>
                  <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                    <div
                      className="bg-success h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (Number(item.amount) / Math.max(1, Number(summary.income))) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 支出构成 */}
        <div className="rounded-card border-border bg-card shadow-card border p-4">
          <p className="text-foreground text-sm font-semibold">支出构成</p>
          {summary.expenseByCategory.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">该区间暂无支出。</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {summary.expenseByCategory.map((item) => (
                <li key={item.category}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground">
                      {EXPENSE_CATEGORY_LABELS[item.category]}
                    </span>
                    <span className="tabular font-medium">{formatMoney(item.amount)}</span>
                  </div>
                  <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                    <div
                      className="bg-danger h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (Number(item.amount) / Math.max(1, Number(summary.expense))) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 流水 */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-foreground text-sm font-semibold">收支明细</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditingExpense(null);
            setExpenseFormOpen(true);
          }}
        >
          <Plus />
          登记支出
        </Button>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">全部流水</TabsTrigger>
          <TabsTrigger value="expense">支出</TabsTrigger>
          <TabsTrigger value="method">支付方式</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          {cashFlow.length === 0 ? (
            <EmptyState title="该区间暂无流水" description="收款或登记支出后会显示在这里。" />
          ) : (
            <ul className="divide-border rounded-card border-border bg-card divide-y overflow-hidden border">
              {cashFlow.map((entry) => (
                <li
                  key={`${entry.kind}-${entry.id}`}
                  className="flex items-center gap-3 px-3.5 py-3"
                >
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg",
                      entry.kind === "INCOME"
                        ? "bg-success-soft text-success-strong"
                        : "bg-danger-soft text-danger-strong",
                    )}
                  >
                    {entry.kind === "INCOME" ? (
                      <TrendingUp className="size-4" />
                    ) : (
                      <TrendingDown className="size-4" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm font-medium">
                      {entry.kind === "INCOME"
                        ? INCOME_CATEGORY_LABELS[
                            entry.categoryLabel as keyof typeof INCOME_CATEGORY_LABELS
                          ]
                        : EXPENSE_CATEGORY_LABELS[entry.categoryLabel as ExpenseCategory]}
                      {entry.workOrderNo ? (
                        <span className="tabular text-muted-foreground ml-2 text-xs font-normal">
                          {entry.workOrderNo}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {formatDateTime(entry.occurredAt)} ·{" "}
                      {PAYMENT_METHOD_LABELS[entry.method as PaymentMethod] ?? entry.method}
                      {entry.remark ? ` · ${entry.remark}` : ""}
                    </p>
                  </div>

                  <span
                    className={cn(
                      "tabular shrink-0 text-[15px] font-semibold",
                      entry.kind === "INCOME" ? "text-success-strong" : "text-danger-strong",
                    )}
                  >
                    {entry.kind === "INCOME" ? "+" : "−"}
                    {formatMoney(entry.amount, { withSymbol: false })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="expense">
          {expenses.length === 0 ? (
            <EmptyState title="该区间暂无支出记录" />
          ) : (
            <ul className="divide-border rounded-card border-border bg-card divide-y overflow-hidden border">
              {expenses.map((expense) => (
                <li key={expense.id} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm font-medium">
                      {EXPENSE_CATEGORY_LABELS[expense.category]}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {formatDateTime(expense.occurredAt)} · {PAYMENT_METHOD_LABELS[expense.method]}
                      {expense.supplierName ? ` · ${expense.supplierName}` : ""}
                      {expense.operatorName ? ` · ${expense.operatorName}` : ""}
                      {expense.remark ? ` · ${expense.remark}` : ""}
                    </p>
                  </div>

                  <span className="tabular text-danger-strong shrink-0 text-[15px] font-semibold">
                    −{formatMoney(expense.amount, { withSymbol: false })}
                  </span>

                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      aria-label="编辑"
                      onClick={() => {
                        setEditingExpense(expense);
                        setExpenseFormOpen(true);
                      }}
                      className="text-muted-foreground hover:bg-muted grid size-9 place-items-center rounded-lg transition-colors"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="删除"
                      onClick={() => setPendingDelete(expense)}
                      className="text-danger hover:bg-danger-soft grid size-9 place-items-center rounded-lg transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="method">
          {summary.incomeByMethod.length === 0 ? (
            <EmptyState title="该区间暂无收款" />
          ) : (
            <ul className="divide-border rounded-card border-border bg-card divide-y overflow-hidden border">
              {summary.incomeByMethod.map((item) => (
                <li
                  key={item.method}
                  className="flex items-center justify-between gap-3 px-3.5 py-3.5"
                >
                  <div>
                    <p className="text-foreground text-sm font-medium">
                      {PAYMENT_METHOD_LABELS[item.method as PaymentMethod] ?? item.method}
                    </p>
                    <p className="text-muted-foreground text-xs">{item.count} 笔</p>
                  </div>
                  <span className="tabular text-foreground text-[15px] font-semibold">
                    {formatMoney(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <ExpenseFormSheet
        open={expenseFormOpen}
        onOpenChange={(open) => {
          setExpenseFormOpen(open);
          if (!open) setEditingExpense(null);
        }}
        initial={editingExpense}
        suppliers={suppliers}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="删除这笔支出？"
        description="删除后不可恢复，操作会写入日志。"
        confirmText="删除"
        loading={deleting}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setDeleting(true);
          const result = await deleteExpenseAction(pendingDelete.id);
          setDeleting(false);
          setPendingDelete(null);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("支出已删除");
          router.refresh();
        }}
      />
    </div>
  );
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "PART_PURCHASE",
  "RENT",
  "UTILITY",
  "SALARY",
  "TOOL_EQUIPMENT",
  "LOGISTICS",
  "OTHER",
];

const METHODS: PaymentMethod[] = ["CASH", "WECHAT", "ALIPAY", "BANK_CARD", "OTHER"];

/** 支出登记 / 编辑 */
export function ExpenseFormSheet({
  open,
  onOpenChange,
  initial,
  suppliers,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ExpenseDTO | null;
  suppliers: Array<{ id: string; name: string }>;
  onSaved?: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [category, setCategory] = React.useState<ExpenseCategory>("PART_PURCHASE");
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("CASH");
  const [occurredAt, setOccurredAt] = React.useState(today);
  const [supplierId, setSupplierId] = React.useState("");
  const [remark, setRemark] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setCategory(initial?.category ?? "PART_PURCHASE");
    setAmount(initial?.amount ?? "");
    setMethod(initial?.method ?? "CASH");
    setOccurredAt(initial ? initial.occurredAt.slice(0, 10) : today);
    setSupplierId("");
    setRemark(initial?.remark ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const submit = async () => {
    if (!amount || Number(amount) <= 0) {
      toast.error("请输入大于 0 的支出金额。");
      return;
    }

    setSubmitting(true);
    const payload = {
      category,
      amount,
      method,
      occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString(),
      supplierId: supplierId || undefined,
      remark: remark.trim(),
    };

    const result = initial
      ? await updateExpenseAction(initial.id, payload)
      : await createExpenseAction(payload);
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(initial ? "支出已更新" : "支出已登记");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={initial ? "修改支出" : "登记支出"}
        description="房租、水电、工资、配件采购等店铺开支"
        footer={
          <Button size="lg" block loading={submitting} onClick={() => void submit()}>
            {submitting ? "保存中…" : "保存"}
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="支出分类" required>
            <div className="grid grid-cols-3 gap-2">
              {EXPENSE_CATEGORIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={cn(
                    "rounded-control h-11 border text-sm font-medium transition-colors",
                    category === item
                      ? "border-brand bg-brand-soft text-brand-strong"
                      : "border-border bg-card text-muted-foreground active:bg-muted",
                  )}
                >
                  {EXPENSE_CATEGORY_LABELS[item]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="金额" required>
            <MoneyInput
              value={amount}
              onValueChange={setAmount}
              className="h-14 text-xl font-semibold"
            />
          </Field>

          <Field label="支付方式">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="rounded-control border-input bg-card focus-visible:border-brand h-11 w-full border px-3 text-[16px] outline-none"
            >
              {METHODS.map((item) => (
                <option key={item} value={item}>
                  {PAYMENT_METHOD_LABELS[item]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="发生日期">
            <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </Field>

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
            <Textarea
              rows={2}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="例如：9 月房租 / 采购机油 10 桶"
            />
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  );
}
