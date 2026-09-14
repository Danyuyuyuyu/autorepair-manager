"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Car, ChevronRight, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks";
import {
  createVehicleAction,
  deleteVehicleAction,
  updateVehicleAction,
} from "@/server/actions/vehicle.actions";
import type { VehicleListItemDTO } from "@/types";

export interface CustomerOption {
  id: string;
  name: string;
  phone: string;
}

interface VehicleFormValue {
  id?: string;
  customerId: string;
  newCustomerName: string;
  newCustomerPhone: string;
  plateNumber: string;
  brand: string;
  model: string;
  year: string;
  vin: string;
  engineNo: string;
  currentMileage: string;
  nextServiceAt: string;
  remark: string;
}

const EMPTY_FORM: VehicleFormValue = {
  customerId: "",
  newCustomerName: "",
  newCustomerPhone: "",
  plateNumber: "",
  brand: "",
  model: "",
  year: "",
  vin: "",
  engineNo: "",
  currentMileage: "",
  nextServiceAt: "",
  remark: "",
};

export function VehicleListView({
  vehicles,
  total,
  customers,
  canDelete,
}: {
  vehicles: VehicleListItemDTO[];
  total: number;
  customers: CustomerOption[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [keyword, setKeyword] = React.useState(searchParams.get("q") ?? "");
  const [formOpen, setFormOpen] = React.useState(searchParams.get("action") === "new");
  const [editing, setEditing] = React.useState<VehicleFormValue | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<VehicleListItemDTO | null>(null);
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

  const openEdit = (vehicle: VehicleListItemDTO) => {
    setEditing({
      id: vehicle.id,
      customerId: vehicle.customerId,
      newCustomerName: "",
      newCustomerPhone: "",
      plateNumber: vehicle.plateNumber,
      brand: vehicle.brand ?? "",
      model: vehicle.model ?? "",
      year: vehicle.year ? String(vehicle.year) : "",
      vin: vehicle.vin ?? "",
      engineNo: "",
      currentMileage: vehicle.currentMileage ? String(vehicle.currentMileage) : "",
      nextServiceAt: vehicle.nextServiceAt ? vehicle.nextServiceAt.slice(0, 10) : "",
      remark: "",
    });
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <SearchInput
        value={keyword}
        onValueChange={setKeyword}
        placeholder="搜索车牌号 / VIN / 品牌 / 客户"
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">共 {total} 台车</p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus />
          添加车辆
        </Button>
      </div>

      {vehicles.length === 0 ? (
        <EmptyState title="没有找到车辆" description="换个车牌号试试，或添加一台新车。" />
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {vehicles.map((vehicle) => {
            const dueSoon =
              vehicle.nextServiceAt !== null &&
              new Date(vehicle.nextServiceAt).getTime() <= Date.now() + 30 * 24 * 3600 * 1000;

            return (
              <div
                key={vehicle.id}
                className="rounded-card border-border bg-card shadow-card flex items-start gap-3 border p-3.5"
              >
                <span className="rounded-control bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center">
                  <Car className="size-5" />
                </span>

                <Link href={`/vehicles/${vehicle.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-[17px] font-semibold tracking-wide">
                      {vehicle.plateNumber}
                    </span>
                    {dueSoon ? (
                      <Badge tone="warning" size="sm">
                        待保养
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground truncate text-sm">
                    {[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") ||
                      "未填写车型"}
                  </p>
                  <p className="text-subtle-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                    <span>{vehicle.customerName}</span>
                    <span className="tabular">{vehicle.customerPhone}</span>
                    {vehicle.currentMileage ? <span>{vehicle.currentMileage} km</span> : null}
                    {vehicle.nextServiceAt ? (
                      <span>下次保养 {formatDate(vehicle.nextServiceAt)}</span>
                    ) : null}
                  </p>
                </Link>

                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    aria-label="编辑"
                    onClick={() => openEdit(vehicle)}
                    className="text-muted-foreground hover:bg-muted grid size-9 place-items-center rounded-lg transition-colors"
                  >
                    <Pencil className="size-4" />
                  </button>
                  {canDelete ? (
                    <button
                      type="button"
                      aria-label="删除"
                      onClick={() => setPendingDelete(vehicle)}
                      className="text-danger hover:bg-danger-soft grid size-9 place-items-center rounded-lg transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                  <Link
                    href={`/vehicles/${vehicle.id}`}
                    aria-label="详情"
                    className="text-subtle-foreground grid size-9 place-items-center rounded-lg"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <VehicleFormSheet
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        initial={editing}
        customers={customers}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? `删除车辆 ${pendingDelete.plateNumber}？` : "删除车辆？"}
        description="仅可删除没有维修记录的车辆，操作会写入日志。"
        confirmText="删除"
        loading={deleting}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setDeleting(true);
          const result = await deleteVehicleAction(pendingDelete.id);
          setDeleting(false);
          setPendingDelete(null);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("车辆已删除");
          router.refresh();
        }}
      />
    </div>
  );
}

/** 车辆表单：支持「选择已有客户」或「现场新建客户」 */
export function VehicleFormSheet({
  open,
  onOpenChange,
  initial,
  customers,
  defaultCustomerId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: VehicleFormValue | null;
  customers: CustomerOption[];
  defaultCustomerId?: string;
  onSaved?: () => void;
}) {
  const [form, setForm] = React.useState<VehicleFormValue>(EMPTY_FORM);
  const [customerKeyword, setCustomerKeyword] = React.useState("");
  const [creatingCustomer, setCreatingCustomer] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm({
      ...(initial ?? EMPTY_FORM),
      customerId: initial?.customerId ?? defaultCustomerId ?? "",
    });
    setCustomerKeyword("");
    setCreatingCustomer(false);
  }, [open, initial, defaultCustomerId]);

  const set = <K extends keyof VehicleFormValue>(key: K, value: VehicleFormValue[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const filteredCustomers = React.useMemo(() => {
    const kw = customerKeyword.trim().toLowerCase();
    if (!kw) return customers.slice(0, 8);
    return customers
      .filter((customer) => customer.name.toLowerCase().includes(kw) || customer.phone.includes(kw))
      .slice(0, 20);
  }, [customers, customerKeyword]);

  const selectedCustomer = customers.find((customer) => customer.id === form.customerId);

  const submit = async () => {
    if (!form.plateNumber.trim()) {
      toast.error("请填写车牌号。");
      return;
    }
    if (!form.customerId && !creatingCustomer) {
      toast.error("请选择客户，或新建客户。");
      return;
    }
    if (creatingCustomer && (!form.newCustomerName.trim() || !form.newCustomerPhone.trim())) {
      toast.error("请填写新客户的姓名与手机号。");
      return;
    }

    setSubmitting(true);
    const payload = {
      customerId: form.customerId || undefined,
      newCustomerName: creatingCustomer ? form.newCustomerName.trim() : undefined,
      newCustomerPhone: creatingCustomer ? form.newCustomerPhone.trim() : undefined,
      plateNumber: form.plateNumber.trim(),
      brand: form.brand.trim(),
      model: form.model.trim(),
      year: form.year ? Number(form.year) : undefined,
      vin: form.vin.trim(),
      engineNo: form.engineNo.trim(),
      currentMileage: form.currentMileage ? Number(form.currentMileage) : undefined,
      nextServiceAt: form.nextServiceAt || "",
      remark: form.remark.trim(),
    };

    const result = form.id
      ? await updateVehicleAction(form.id, payload)
      : await createVehicleAction(payload);
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(form.id ? "车辆信息已更新" : "车辆已添加");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={form.id ? "编辑车辆" : "添加车辆"}
        description={form.id ? undefined : "车牌号是维修开单时最主要的查询字段"}
        footer={
          <Button size="lg" block loading={submitting} onClick={() => void submit()}>
            {submitting ? "保存中…" : "保存"}
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="车牌号" required>
            <Input
              value={form.plateNumber}
              onChange={(e) => set("plateNumber", e.target.value.toUpperCase())}
              placeholder="粤A12345"
              autoCapitalize="characters"
              className="tracking-wide"
            />
          </Field>

          {/* 客户选择 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-foreground text-sm font-medium">
                所属客户 <span className="text-danger">*</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setCreatingCustomer((v) => !v);
                  set("customerId", "");
                }}
                className="text-brand flex items-center gap-1 text-xs font-medium"
              >
                <UserPlus className="size-3.5" />
                {creatingCustomer ? "改为选择已有客户" : "新建客户"}
              </button>
            </div>

            {creatingCustomer ? (
              <div className="rounded-control border-warning-border bg-warning-soft grid grid-cols-2 gap-3 border p-3">
                <Field label="姓名" required>
                  <Input
                    value={form.newCustomerName}
                    onChange={(e) => set("newCustomerName", e.target.value)}
                    placeholder="张三"
                  />
                </Field>
                <Field label="手机号" required>
                  <Input
                    value={form.newCustomerPhone}
                    onChange={(e) => set("newCustomerPhone", e.target.value)}
                    placeholder="13800138000"
                    inputMode="tel"
                  />
                </Field>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedCustomer ? (
                  <div className="rounded-control border-brand-border bg-brand-soft flex items-center justify-between gap-2 border px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-brand-strong truncate text-sm font-medium">
                        {selectedCustomer.name}
                      </p>
                      <p className="tabular text-muted-foreground truncate text-xs">
                        {selectedCustomer.phone}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => set("customerId", "")}
                      className="text-brand-strong shrink-0 text-xs"
                    >
                      重选
                    </button>
                  </div>
                ) : (
                  <>
                    <Input
                      value={customerKeyword}
                      onChange={(e) => setCustomerKeyword(e.target.value)}
                      placeholder="搜索客户姓名或手机号"
                    />
                    {filteredCustomers.length === 0 ? (
                      <p className="rounded-control bg-muted text-muted-foreground px-3 py-2 text-xs">
                        没有匹配客户，请点右上角「新建客户」。
                      </p>
                    ) : (
                      <ul className="divide-border rounded-control border-border max-h-44 divide-y overflow-y-auto border">
                        {filteredCustomers.map((customer) => (
                          <li key={customer.id}>
                            <button
                              type="button"
                              onClick={() => set("customerId", customer.id)}
                              className={cn(
                                "flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left",
                                "active:bg-muted transition-colors",
                              )}
                            >
                              <span className="text-foreground truncate text-sm font-medium">
                                {customer.name}
                              </span>
                              <span className="tabular text-muted-foreground shrink-0 text-xs">
                                {customer.phone}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="品牌">
              <Input
                value={form.brand}
                onChange={(e) => set("brand", e.target.value)}
                placeholder="大众"
              />
            </Field>
            <Field label="车型">
              <Input
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder="朗逸"
              />
            </Field>
            <Field label="年款">
              <Input
                value={form.year}
                onChange={(e) => set("year", e.target.value.replace(/\D/g, ""))}
                placeholder="2020"
                inputMode="numeric"
              />
            </Field>
            <Field label="当前里程">
              <Input
                value={form.currentMileage}
                onChange={(e) => set("currentMileage", e.target.value.replace(/\D/g, ""))}
                placeholder="km"
                inputMode="numeric"
              />
            </Field>
          </div>

          <Field label="VIN 车架号">
            <Input
              value={form.vin}
              onChange={(e) => set("vin", e.target.value.toUpperCase())}
              placeholder="选填，17 位"
              className="tracking-wide"
            />
          </Field>

          <Field label="发动机号">
            <Input
              value={form.engineNo}
              onChange={(e) => set("engineNo", e.target.value)}
              placeholder="选填"
            />
          </Field>

          <Field label="下次保养日期" hint="到期前会出现在首页待处理事项">
            <Input
              type="date"
              value={form.nextServiceAt}
              onChange={(e) => set("nextServiceAt", e.target.value)}
            />
          </Field>

          <Field label="备注">
            <Input
              value={form.remark}
              onChange={(e) => set("remark", e.target.value)}
              placeholder="选填"
            />
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  );
}
