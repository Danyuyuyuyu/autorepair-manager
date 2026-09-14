import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Package, Settings as SettingsIcon, ShieldCheck, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ActionTile } from "@/features/dashboard/components/quick-actions";
import { ProfileForms } from "@/features/settings/components/profile-forms";
import { LogoutButton } from "@/features/settings/components/logout-button";
import { PwaHint } from "@/features/settings/components/pwa-hint";
import { ROLE_LABELS } from "@/lib/constants";
import { requireUser } from "@/server/auth/guard";

export const metadata: Metadata = { title: "我的" };
export const dynamic = "force-dynamic";

export default async function MePage() {
  const user = await requireUser();

  return (
    <div className="space-y-4">
      {/* 账号卡片 */}
      <Card>
        <CardContent className="flex items-center gap-4 pt-4">
          <span className="bg-brand-soft text-brand-strong grid size-14 shrink-0 place-items-center rounded-full text-xl font-semibold">
            {user.name.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-foreground truncate text-[17px] font-semibold">{user.name}</p>
              <Badge tone={user.isAdmin ? "brand" : "neutral"} size="sm">
                {ROLE_LABELS[user.role]}
              </Badge>
            </div>
            <p className="tabular text-muted-foreground mt-0.5 truncate text-sm">
              登录账号：{user.username}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 个人资料与密码 */}
      <ProfileForms user={{ name: user.name }} />

      {/* 管理员快捷入口 */}
      {user.isAdmin ? (
        <section className="space-y-2.5">
          <h3 className="text-foreground text-sm font-semibold">管理入口</h3>
          <div className="grid gap-2.5 lg:grid-cols-2">
            <ActionTile
              href="/settings"
              label="员工账号与权限"
              icon={Users}
              description="新增员工、重置密码、停用账号"
            />
            <ActionTile
              href="/settings?tab=audit"
              label="操作日志"
              icon={ShieldCheck}
              description="删单、改价、库存调整留痕"
            />
            <ActionTile
              href="/finance"
              label="财务记账"
              icon={Package}
              description="收入支出与利润"
            />
            <ActionTile
              href="/reports"
              label="经营报表"
              icon={BarChart3}
              description="趋势与排行"
            />
          </div>
        </section>
      ) : null}

      {/* PWA 安装提示 */}
      <PwaHint />

      {/* 系统信息 */}
      <Card>
        <CardContent className="space-y-2 pt-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">应用名称</span>
            <span className="text-foreground font-medium">汽车维修店管理系统</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">应用简称</span>
            <span className="text-foreground font-medium">汽修管家</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">数据存储</span>
            <span className="text-foreground font-medium">服务器统一数据库</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">移动端支持</span>
            <span className="text-foreground font-medium">可添加到手机桌面（PWA）</span>
          </div>
        </CardContent>
      </Card>

      {user.isAdmin ? (
        <Link
          href="/settings"
          className="rounded-card border-border bg-card text-foreground shadow-soft active:bg-muted flex items-center justify-center gap-2 border px-4 py-3.5 text-sm font-medium transition-colors"
        >
          <SettingsIcon className="size-4" />
          系统设置
        </Link>
      ) : null}

      <LogoutButton />
    </div>
  );
}
