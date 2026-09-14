"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ROLE_LABELS, UNIT_OPTIONS } from "@/lib/constants";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  createUserAction,
  deleteUserAction,
  resetPasswordAction,
  saveEmployeeAction,
  updateUserAction,
} from "@/server/actions/user.actions";
import { createServiceItemAction } from "@/server/actions/inventory.actions";
import type { AuditLogDTO, EmployeeDTO, ServiceItemOptionDTO, UserListItemDTO } from "@/types";
import type { Role } from "@prisma/client";

export function SettingsView({
  users,
  employees,
  serviceItems,
  categories,
  auditLogs,
  currentUserId,
  initialTab,
}: {
  users: UserListItemDTO[];
  employees: EmployeeDTO[];
  serviceItems: ServiceItemOptionDTO[];
  categories: Array<{ id: string; name: string }>;
  auditLogs: AuditLogDTO[];
  currentUserId: string;
  initialTab: string;
}) {
  const router = useRouter();

  const [userFormOpen, setUserFormOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<UserListItemDTO | null>(null);
  const [passwordTarget, setPasswordTarget] = React.useState<UserListItemDTO | null>(null);
  const [pendingDisable, setPendingDisable] = React.useState<UserListItemDTO | null>(null);
  const [pending, setPending] = React.useState(false);

  const [employeeFormOpen, setEmployeeFormOpen] = React.useState(false);
  const [editingEmployee, setEditingEmployee] = React.useState<EmployeeDTO | null>(null);

  const [serviceFormOpen, setServiceFormOpen] = React.useState(false);

  return (
    <Tabs defaultValue={initialTab} className="space-y-3">
      <TabsList className="lg:w-auto lg:justify-start">
        <TabsTrigger value="users">账号权限</TabsTrigger>
        <TabsTrigger value="employees">技师档案</TabsTrigger>
        <TabsTrigger value="services">维修项目</TabsTrigger>
        <TabsTrigger value="audit">操作日志</TabsTrigger>
      </TabsList>

      {/* ============ 账号 ============ */}
      <TabsContent value="users" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">共 {users.length} 个账号</p>
          <Button
            size="sm"
            onClick={() => {
              setEditingUser(null);
              setUserFormOpen(true);
            }}
          >
            <Plus />
            新增账号
          </Button>
        </div>

        <div className="space-y-2.5">
          {users.map((item) => (
            <div
              key={item.id}
              className="rounded-card border-border bg-card shadow-card border p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground truncate text-[16px] font-semibold">
                      {item.name}
                    </span>
                    <Badge tone={item.role === "ADMIN" ? "brand" : "neutral"} size="sm">
                      {ROLE_LABELS[item.role]}
                    </Badge>
                    {!item.isActive ? (
                      <Badge tone="danger" size="sm">
                        已停用
                      </Badge>
                    ) : null}
                    {item.id === currentUserId ? (
                      <Badge tone="info" size="sm">
                        当前登录
                      </Badge>
                    ) : null}
                  </div>
                  <p className="tabular text-muted-foreground mt-0.5 truncate text-sm">
                    {item.username}
                    {item.phone ? ` · ${item.phone}` : ""}
                  </p>
                  <p className="text-subtle-foreground mt-0.5 text-xs">
                    {item.workOrderCount} 张工单 · {item.paymentCount} 笔收款 · 上次登录{" "}
                    {item.lastLoginAt ? formatDateTime(item.lastLoginAt) : "从未"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label="重置密码"
                    onClick={() => setPasswordTarget(item)}
                    className="text-muted-foreground hover:bg-muted grid size-9 place-items-center rounded-lg transition-colors"
                  >
                    <KeyRound className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="编辑"
                    onClick={() => {
                      setEditingUser(item);
                      setUserFormOpen(true);
                    }}
                    className="text-muted-foreground hover:bg-muted grid size-9 place-items-center rounded-lg transition-colors"
                  >
                    <UserCog className="size-4" />
                  </button>
                  {item.id !== currentUserId ? (
                    <button
                      type="button"
                      aria-label="停用"
                      onClick={() => setPendingDisable(item)}
                      className="text-danger hover:bg-danger-soft grid size-9 place-items-center rounded-lg transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>

        <UserFormSheet
          open={userFormOpen}
          onOpenChange={(open) => {
            setUserFormOpen(open);
            if (!open) setEditingUser(null);
          }}
          initial={editingUser}
          onSaved={() => router.refresh()}
        />

        <ResetPasswordSheet
          user={passwordTarget}
          onOpenChange={(open) => {
            if (!open) setPasswordTarget(null);
          }}
          onSaved={() => router.refresh()}
        />

        <ConfirmDialog
          open={pendingDisable !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDisable(null);
          }}
          title={pendingDisable ? `停用账号「${pendingDisable.name}」？` : "停用账号？"}
          description="停用后该账号无法登录，已登录的会话会立即失效。"
          confirmText="停用账号"
          loading={pending}
          onConfirm={async () => {
            if (!pendingDisable) return;
            setPending(true);
            const result = await deleteUserAction(pendingDisable.id);
            setPending(false);
            setPendingDisable(null);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("账号已停用");
            router.refresh();
          }}
        />
      </TabsContent>

      {/* ============ 技师 ============ */}
      <TabsContent value="employees" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">用于工单指派与业绩统计</p>
          <Button
            size="sm"
            onClick={() => {
              setEditingEmployee(null);
              setEmployeeFormOpen(true);
            }}
          >
            <Plus />
            新增技师
          </Button>
        </div>

        {employees.length === 0 ? (
          <EmptyState title="还没有技师档案" description="添加技师后即可在工单中指派负责人。" />
        ) : (
          <div className="space-y-2.5">
            {employees.map((employee) => (
              <div
                key={employee.id}
                className="rounded-card border-border bg-card shadow-card flex items-center justify-between gap-3 border p-3.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground truncate text-[16px] font-medium">
                      {employee.name}
                    </span>
                    {employee.position ? (
                      <Badge tone="neutral" size="sm">
                        {employee.position}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {employee.phone ?? "未填电话"} · 已接 {employee.workOrderCount} 张工单
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingEmployee(employee);
                    setEmployeeFormOpen(true);
                  }}
                >
                  编辑
                </Button>
              </div>
            ))}
          </div>
        )}

        <EmployeeFormSheet
          open={employeeFormOpen}
          onOpenChange={(open) => {
            setEmployeeFormOpen(open);
            if (!open) setEditingEmployee(null);
          }}
          initial={editingEmployee}
          users={users}
          onSaved={() => router.refresh()}
        />
      </TabsContent>

      {/* ============ 维修项目 ============ */}
      <TabsContent value="services" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            开单时可直接选择，共 {serviceItems.length} 项
          </p>
          <Button size="sm" onClick={() => setServiceFormOpen(true)}>
            <Plus />
            新增项目
          </Button>
        </div>

        {serviceItems.length === 0 ? (
          <EmptyState
            title="还没有维修项目"
            description="录入常用项目（如更换机油）后，开单时点选即可，减少重复输入。"
          />
        ) : (
          <div className="rounded-card border-border bg-card overflow-hidden border">
            <ul className="divide-border divide-y">
              {serviceItems.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground truncate text-sm font-medium">
                        {item.name}
                      </span>
                      <Badge tone={item.kind === "LABOR" ? "warning" : "neutral"} size="sm">
                        {item.kind === "LABOR" ? "工时" : "项目"}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground truncate text-xs">
                      {item.categoryName ?? "未分类"} · 单位 {item.unit}
                    </p>
                  </div>
                  <span className="tabular text-foreground shrink-0 text-sm font-semibold">
                    {formatMoney(item.defaultPrice)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ServiceItemFormSheet
          open={serviceFormOpen}
          onOpenChange={setServiceFormOpen}
          categories={categories}
          onSaved={() => router.refresh()}
        />
      </TabsContent>

      {/* ============ 操作日志 ============ */}
      <TabsContent value="audit" className="space-y-3">
        {auditLogs.length === 0 ? (
          <EmptyState title="暂无操作日志" description="删单、改价、库存调整等操作会记录在这里。" />
        ) : (
          <ul className="divide-border rounded-card border-border bg-card divide-y overflow-hidden border">
            {auditLogs.map((log) => (
              <li key={log.id} className="px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-foreground text-sm font-medium">
                      {log.summary ?? log.action}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {log.userName ?? "系统"} · {formatDateTime(log.createdAt)}
                      {log.ip ? ` · ${log.ip}` : ""}
                    </p>
                  </div>
                  <Badge tone="neutral" size="sm" className="shrink-0">
                    {log.action}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}

/** 账号新增 / 编辑 */
function UserFormSheet({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: UserListItemDTO | null;
  onSaved?: () => void;
}) {
  const [username, setUsername] = React.useState("");
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<Role>("STAFF");
  const [isActive, setIsActive] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setUsername(initial?.username ?? "");
    setName(initial?.name ?? "");
    setPhone(initial?.phone ?? "");
    setPassword("");
    setRole(initial?.role ?? "STAFF");
    setIsActive(initial?.isActive ?? true);
  }, [open, initial]);

  const submit = async () => {
    setSubmitting(true);
    const result = initial
      ? await updateUserAction({ id: initial.id, name, phone, role, isActive })
      : await createUserAction({ username, name, phone, password, role });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(initial ? "账号已更新" : "账号已创建");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={initial ? "编辑账号" : "新增员工账号"}
        description={initial ? initial.username : "员工可用该账号登录，权限由角色决定"}
        footer={
          <Button size="lg" block loading={submitting} onClick={() => void submit()}>
            {submitting ? "保存中…" : "保存"}
          </Button>
        }
      >
        <div className="space-y-4">
          {!initial ? (
            <Field label="登录账号" required hint="3-32 位字母、数字、下划线">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="例如 wangqiang"
              />
            </Field>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="姓名" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="王强" />
            </Field>
            <Field label="联系电话">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="选填"
                inputMode="tel"
              />
            </Field>
          </div>

          {!initial ? (
            <Field label="初始密码" required hint="至少 8 位，需包含字母与数字">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          ) : null}

          <Field label="角色权限" required>
            <div className="grid grid-cols-2 gap-2">
              {(["STAFF", "ADMIN"] as Role[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRole(item)}
                  className={cn(
                    "rounded-control border p-3 text-left transition-colors",
                    role === item ? "border-brand bg-brand-soft" : "border-border bg-card",
                  )}
                >
                  <p className="text-foreground text-sm font-medium">{ROLE_LABELS[item]}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {item === "ADMIN"
                      ? "全部数据 + 财务 + 改价 + 删除"
                      : "建单、客户车辆、加项、收款"}
                  </p>
                </button>
              ))}
            </div>
          </Field>

          {initial ? (
            <label className="rounded-control border-border bg-muted/40 flex items-center gap-2.5 border p-3">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="size-5 accent-[var(--color-brand)]"
              />
              <span className="text-foreground text-sm">账号启用（取消勾选即停用）</span>
            </label>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ResetPasswordSheet({
  user,
  onOpenChange,
  onSaved,
}: {
  user: UserListItemDTO | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (user) setPassword("");
  }, [user]);

  return (
    <Sheet open={user !== null} onOpenChange={onOpenChange}>
      <SheetContent
        title="重置登录密码"
        description={user ? `${user.name}（${user.username}）` : undefined}
        footer={
          <Button
            size="lg"
            block
            loading={submitting}
            onClick={async () => {
              if (!user) return;
              setSubmitting(true);
              const result = await resetPasswordAction(user.id, password);
              setSubmitting(false);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("密码已重置，请告知员工新密码");
              onOpenChange(false);
              onSaved?.();
            }}
          >
            确认重置
          </Button>
        }
      >
        <Field label="新密码" required hint="至少 8 位，需包含字母与数字">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <p className="text-muted-foreground mt-3 text-xs">重置后该员工的所有登录会话会立即失效。</p>
      </SheetContent>
    </Sheet>
  );
}

function EmployeeFormSheet({
  open,
  onOpenChange,
  initial,
  users,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: EmployeeDTO | null;
  users: UserListItemDTO[];
  onSaved?: () => void;
}) {
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [position, setPosition] = React.useState("");
  const [isTechnician, setIsTechnician] = React.useState(true);
  const [userId, setUserId] = React.useState("");
  const [remark, setRemark] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setPhone(initial?.phone ?? "");
    setPosition(initial?.position ?? "");
    setIsTechnician(initial?.isTechnician ?? true);
    setUserId(initial?.userId ?? "");
    setRemark(initial?.remark ?? "");
  }, [open, initial]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={initial ? "编辑技师" : "新增技师"}
        description="技师可不绑定登录账号，仅用于工单指派"
        footer={
          <Button
            size="lg"
            block
            loading={submitting}
            onClick={async () => {
              if (!name.trim()) {
                toast.error("请填写姓名。");
                return;
              }
              setSubmitting(true);
              const result = await saveEmployeeAction({
                id: initial?.id,
                name: name.trim(),
                phone: phone.trim(),
                position: position.trim(),
                isTechnician,
                userId: userId || undefined,
                remark: remark.trim(),
              });
              setSubmitting(false);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success(initial ? "技师信息已更新" : "技师已添加");
              onOpenChange(false);
              onSaved?.();
            }}
          >
            保存
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="姓名" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="联系电话">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            </Field>
          </div>

          <Field label="岗位">
            <Input
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="机修 / 钣金 / 喷漆 / 前台"
            />
          </Field>

          <Field label="绑定登录账号" hint="用于统计其开单与收款情况">
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="rounded-control border-input bg-card focus-visible:border-brand h-11 w-full border px-3 text-[16px] outline-none"
            >
              <option value="">不绑定</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}（{user.username}）
                </option>
              ))}
            </select>
          </Field>

          <label className="rounded-control border-border bg-muted/40 flex items-center gap-2.5 border p-3">
            <input
              type="checkbox"
              checked={isTechnician}
              onChange={(e) => setIsTechnician(e.target.checked)}
              className="size-5 accent-[var(--color-brand)]"
            />
            <span className="text-foreground text-sm">是维修技师（可在工单中指派）</span>
          </label>

          <Field label="备注">
            <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ServiceItemFormSheet({
  open,
  onOpenChange,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Array<{ id: string; name: string }>;
  onSaved?: () => void;
}) {
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<"SERVICE" | "LABOR">("SERVICE");
  const [unit, setUnit] = React.useState("项");
  const [defaultPrice, setDefaultPrice] = React.useState("0.00");
  const [costPrice, setCostPrice] = React.useState("0.00");
  const [categoryId, setCategoryId] = React.useState("");
  const [remark, setRemark] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setKind("SERVICE");
    setUnit("项");
    setDefaultPrice("0.00");
    setCostPrice("0.00");
    setCategoryId("");
    setRemark("");
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="新增维修项目"
        description="用于开单时快速选择，减少手工输入"
        footer={
          <Button
            size="lg"
            block
            loading={submitting}
            onClick={async () => {
              if (!name.trim()) {
                toast.error("请填写项目名称。");
                return;
              }
              setSubmitting(true);
              const result = await createServiceItemAction({
                name: name.trim(),
                kind,
                unit: unit.trim() || "项",
                defaultPrice,
                costPrice,
                categoryId: categoryId || undefined,
                sortOrder: 0,
                remark: remark.trim(),
              });
              setSubmitting(false);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("项目已添加");
              onOpenChange(false);
              onSaved?.();
            }}
          >
            保存
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="项目名称" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：更换机油机滤"
            />
          </Field>

          <Field label="类型">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: "SERVICE", label: "维修项目" },
                  { value: "LABOR", label: "工时" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setKind(option.value)}
                  className={cn(
                    "rounded-control h-11 border text-sm font-medium transition-colors",
                    kind === option.value
                      ? "border-brand bg-brand-soft text-brand-strong"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="默认价格" required>
              <MoneyInput value={defaultPrice} onValueChange={setDefaultPrice} />
            </Field>
            <Field label="人工成本" hint="用于毛利计算">
              <MoneyInput value={costPrice} onValueChange={setCostPrice} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="单位">
              <Input
                list="service-unit-options"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
              <datalist id="service-unit-options">
                {UNIT_OPTIONS.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </Field>
            <Field label="分类">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
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
          </div>

          <Field label="备注">
            <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  );
}
