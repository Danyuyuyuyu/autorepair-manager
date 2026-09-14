"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Pencil, Phone, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatMoney, formatRelative } from "@/lib/format";
import { useDebouncedValue } from "@/hooks";
import {
  createCustomerAction,
  deleteCustomerAction,
  updateCustomerAction,
} from "@/server/actions/customer.actions";
import type { CustomerListItemDTO } from "@/types";

interface CustomerFormValue {
  id?: string;
  name: string;
  phone: string;
  wechat: string;
  address: string;
  remark: string;
}

const EMPTY_FORM: CustomerFormValue = {
  name: "",
  phone: "",
  wechat: "",
  address: "",
  remark: "",
};

/**
 * 客户列表视图（手机 + PC 同一份组件）。
 * 手机端为卡片，PC 端在同一张卡内使用更宽的两列信息布局。
 */
export function CustomerListView({
  customers,
  total,
  canDelete,
}: {
  customers: CustomerListItemDTO[];
  total: number;
  canDelete: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [keyword, setKeyword] = React.useState(searchParams.get("q") ?? "");
  const [formOpen, setFormOpen] = React.useState(searchParams.get("action") === "new");
  const [editing, setEditing] = React.useState<CustomerFormValue | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<CustomerListItemDTO | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const debounced = useDebouncedValue(keyword, 350);

  React.useEffect(() => {
    const urlValue = searchParams.get("q") ?? "";
    if (debounced === urlValue) return;
    const params = new URLSearchParams(searchParams.toString());
    if (debounced) params.set("q", debounced);
    else params.delete("q");
    params.delete("page");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [debounced, pathname, router, searchParams]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (customer: CustomerListItemDTO) => {
    setEditing({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      wechat: customer.wechat ?? "",
      address: "",
      remark: "",
    });
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <CustomersToolbar
        keyword={keyword}
        onKeywordChange={setKeyword}
        total={total}
        onCreate={openCreate}
      />

      {customers.length === 0 ? (
        <EmptyState
          title="没有找到客户"
          description="换个关键词试试，或直接新增一位客户。"
          action={
            <Button onClick={openCreate}>
              <UserPlus />
              新增客户
            </Button>
          }
        />
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
          {customers.map((customer) => (
            <div
              key={customer.id}
              className="rounded-card border-border bg-card shadow-card border p-3.5 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <Link href={`/customers/${customer.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground truncate text-[17px] font-semibold">
                      {customer.name}
                    </span>
                    {Number(customer.outstandingAmount) > 0 ? (
                      <Badge tone="danger" size="sm">
                        欠 {formatMoney(customer.outstandingAmount, { withSymbol: false })}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="tabular text-muted-foreground mt-0.5 text-sm">{customer.phone}</p>
                  <div className="text-subtle-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span>{customer.vehicleCount} 台车</span>
                    <span>{customer.workOrderCount} 次维修</span>
                    <span>累计 {formatMoney(customer.totalSpent, { withSymbol: false })}</span>
                    {customer.lastVisitAt ? (
                      <span>{formatRelative(customer.lastVisitAt)}</span>
                    ) : null}
                  </div>
                </Link>

                <div className="flex shrink-0 items-center">
                  <a
                    href={`tel:${customer.phone}`}
                    aria-label="拨打电话"
                    className="text-brand hover:bg-brand-soft grid size-9 place-items-center rounded-lg transition-colors"
                  >
                    <Phone className="size-4" />
                  </a>
                  <button
                    type="button"
                    aria-label="编辑"
                    onClick={() => openEdit(customer)}
                    className="text-muted-foreground hover:bg-muted grid size-9 place-items-center rounded-lg transition-colors"
                  >
                    <Pencil className="size-4" />
                  </button>
                  {canDelete ? (
                    <button
                      type="button"
                      aria-label="删除"
                      onClick={() => setPendingDelete(customer)}
                      className="text-danger hover:bg-danger-soft grid size-9 place-items-center rounded-lg transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                  <Link
                    href={`/customers/${customer.id}`}
                    aria-label="查看详情"
                    className="text-subtle-foreground grid size-9 place-items-center rounded-lg"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CustomerFormSheet
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        initial={editing}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? `删除客户「${pendingDelete.name}」？` : "删除客户？"}
        description="仅可删除没有任何维修记录的客户，操作会写入操作日志。"
        confirmText="删除"
        loading={deleting}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setDeleting(true);
          const result = await deleteCustomerAction(pendingDelete.id);
          setDeleting(false);
          setPendingDelete(null);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("客户已删除");
          router.refresh();
        }}
      />
    </div>
  );
}

function CustomersToolbar({
  keyword,
  onKeywordChange,
  total,
  onCreate,
}: {
  keyword: string;
  onKeywordChange: (value: string) => void;
  total: number;
  onCreate: () => void;
}) {
  return (
    <div className="space-y-3">
      <SearchInput
        value={keyword}
        onValueChange={onKeywordChange}
        placeholder="搜索客户姓名 / 手机号"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">共 {total} 位客户</p>
        <Button size="sm" onClick={onCreate}>
          <UserPlus />
          新增客户
        </Button>
      </div>
    </div>
  );
}

/** 新增 / 编辑客户表单（底部抽屉） */
export function CustomerFormSheet({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: CustomerFormValue | null;
  onSaved?: () => void;
}) {
  const [form, setForm] = React.useState<CustomerFormValue>(EMPTY_FORM);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) setForm(initial ?? EMPTY_FORM);
  }, [open, initial]);

  const set = <K extends keyof CustomerFormValue>(key: K, value: CustomerFormValue[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("请填写客户姓名。");
      return;
    }
    if (!form.phone.trim()) {
      toast.error("请填写手机号。");
      return;
    }

    setSubmitting(true);
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      wechat: form.wechat.trim(),
      address: form.address.trim(),
      remark: form.remark.trim(),
    };

    const result = form.id
      ? await updateCustomerAction(form.id, payload)
      : await createCustomerAction(payload);
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(form.id ? "客户资料已更新" : "客户已新增");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={form.id ? "编辑客户" : "新增客户"}
        description={form.id ? undefined : "只需姓名与手机号即可建档"}
        footer={
          <Button size="lg" block loading={submitting} onClick={() => void submit()}>
            {submitting ? "保存中…" : "保存"}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="姓名" required>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="张三"
              />
            </Field>
            <Field label="手机号" required>
              <Input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="13800138000"
                inputMode="tel"
                type="tel"
              />
            </Field>
          </div>

          <Field label="微信备注" hint="例如：微信昵称 / 微信号，方便联系">
            <Input
              value={form.wechat}
              onChange={(e) => set("wechat", e.target.value)}
              placeholder="选填"
            />
          </Field>

          <Field label="地址">
            <Input
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="选填"
            />
          </Field>

          <Field label="备注">
            <Textarea
              rows={2}
              value={form.remark}
              onChange={(e) => set("remark", e.target.value)}
              placeholder="选填，例如：老客户、介绍人"
            />
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  );
}
