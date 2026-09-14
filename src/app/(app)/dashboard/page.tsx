import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Car,
  ClipboardList,
  PackageSearch,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { Icon } from "@/components/shared/icon";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle, CardList } from "@/components/ui/card";
import { QuickActions } from "@/features/dashboard/components/quick-actions";
import { WorkOrderCard, WorkOrderRow } from "@/features/work-orders/components/work-order-card";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/guard";
import {
  getDashboardStats,
  getPendingTasks,
  getRecentWorkOrders,
  getTodayWorkOrders,
} from "@/server/services/dashboard.service";
import { businessDateKey } from "@/utils/date";

export const metadata: Metadata = { title: "工作台" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();

  const [stats, tasks, recentOrders, todayOrders] = await Promise.all([
    getDashboardStats(user),
    getPendingTasks(),
    getRecentWorkOrders(5),
    getTodayWorkOrders(6),
  ]);

  const today = new Date();
  const greeting = today.getHours() < 12 ? "上午好" : today.getHours() < 18 ? "下午好" : "晚上好";

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* 问候 + 日期 */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-foreground text-lg font-semibold">
            {greeting}，{user.name}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {formatDate(today)} · {businessDateKey(today)}
          </p>
        </div>
        {user.isAdmin ? (
          <Button variant="ghost" size="sm" asChild className="-mr-2 shrink-0">
            <Link href="/reports">
              看报表
              <ArrowRight />
            </Link>
          </Button>
        ) : null}
      </div>

      {/* 快捷操作（手机端优先展示：拇指区域） */}
      <QuickActions canViewFinance={user.isAdmin} />

      {/* 经营数据 */}
      {stats.financeVisible ? (
        <section className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatCard
              label="今日营业额"
              value={formatMoney(stats.todayRevenue, { withSymbol: false })}
              unit="元"
              icon={TrendingUp}
              tone="brand"
            />
            <StatCard
              label="今日支出"
              value={formatMoney(stats.todayExpense, { withSymbol: false })}
              unit="元"
              icon={Wallet}
              tone="danger"
            />
            <StatCard
              label="今日利润"
              value={formatMoney(stats.todayProfit, { withSymbol: false })}
              unit="元"
              tone={Number(stats.todayProfit) >= 0 ? "success" : "danger"}
              hint="营业额 − 支出"
            />
            <StatCard
              label="今日工单"
              value={stats.todayOrderCount}
              unit="张"
              icon={ClipboardList}
              hint={`已完工 ${stats.todayCompletedCount} 张`}
            />
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <Link href="/work-orders?status=UNPAID" className="block">
              <StatCard
                label="待收款"
                value={stats.pendingPaymentCount}
                unit="单"
                tone={stats.pendingPaymentCount > 0 ? "danger" : "default"}
                hint={`¥${formatMoney(stats.pendingPaymentAmount, { withSymbol: false })}`}
                className="h-full"
              />
            </Link>
            <Link href="/work-orders?status=PENDING_PAYMENT" className="block">
              <StatCard
                label="待交车"
                value={stats.pendingDeliveryCount}
                unit="台"
                tone={stats.pendingDeliveryCount > 0 ? "warning" : "default"}
                hint="质检 / 待付款"
                className="h-full"
              />
            </Link>
            <Link href="/inventory?stock=low" className="block">
              <StatCard
                label="库存预警"
                value={stats.lowStockCount}
                unit="项"
                tone={stats.lowStockCount > 0 ? "warning" : "default"}
                icon={stats.lowStockCount > 0 ? AlertTriangle : undefined}
                hint="低于安全库存"
                className="h-full"
              />
            </Link>
          </div>
        </section>
      ) : (
        <section className="grid grid-cols-3 gap-2.5">
          <StatCard label="今日工单" value={stats.todayOrderCount} unit="张" icon={ClipboardList} />
          <StatCard
            label="待收款"
            value={stats.pendingPaymentCount}
            unit="单"
            tone={stats.pendingPaymentCount > 0 ? "danger" : "default"}
          />
          <StatCard
            label="库存预警"
            value={stats.lowStockCount}
            unit="项"
            tone={stats.lowStockCount > 0 ? "warning" : "default"}
          />
        </section>
      )}

      {/* 主体两栏：PC 端左内容右待办 */}
      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="space-y-4 lg:col-span-2">
          {/* 最近工单 */}
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle>最近工单</CardTitle>
              <Button variant="ghost" size="sm" asChild className="-mr-2">
                <Link href="/work-orders">
                  全部
                  <ArrowRight />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {recentOrders.length === 0 ? (
                <div className="px-4 pb-4">
                  <EmptyState
                    title="还没有工单"
                    description="点击上方「新建维修工单」开始第一单"
                    icon={<Icon name="ClipboardList" className="size-6" />}
                  />
                </div>
              ) : (
                <CardList>
                  {recentOrders.map((order) => (
                    <WorkOrderRow key={order.id} order={order} />
                  ))}
                </CardList>
              )}
            </CardContent>
          </Card>

          {/* 手机端：今日维修记录卡片流 */}
          <section className="space-y-2.5 lg:hidden">
            <h3 className="text-foreground text-sm font-semibold">今日维修记录</h3>
            {todayOrders.length === 0 ? (
              <EmptyState title="今日暂无维修记录" description="新建工单后会显示在这里" />
            ) : (
              <div className="space-y-2.5">
                {todayOrders.map((order) => (
                  <WorkOrderCard key={order.id} order={order} />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          {/* 待处理事项 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>待处理事项</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {tasks.length === 0 ? (
                <p className="text-muted-foreground px-4 pb-4 text-sm">
                  暂时没有待处理事项，一切正常。
                </p>
              ) : (
                <ul className="divide-border divide-y">
                  {tasks.map((task, index) => (
                    <li key={`${task.type}-${index}`}>
                      <Link
                        href={task.href}
                        className="active:bg-muted flex items-center gap-3 px-4 py-3 transition-colors"
                      >
                        <span
                          className={cn(
                            "grid size-9 shrink-0 place-items-center rounded-lg",
                            task.type === "PAYMENT" && "bg-danger-soft text-danger-strong",
                            task.type === "LOW_STOCK" && "bg-warning-soft text-warning-strong",
                            task.type === "DELIVERY" && "bg-info-soft text-info-strong",
                            task.type === "SERVICE_DUE" && "bg-brand-soft text-brand-strong",
                          )}
                        >
                          {task.type === "PAYMENT" ? (
                            <Wallet className="size-[18px]" />
                          ) : task.type === "LOW_STOCK" ? (
                            <PackageSearch className="size-[18px]" />
                          ) : (
                            <Car className="size-[18px]" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground truncate text-[15px] font-medium">
                            {task.title}
                          </p>
                          <p className="text-muted-foreground truncate text-xs">
                            {task.description}
                          </p>
                        </div>
                        <Icon
                          name="ChevronRight"
                          className="text-subtle-foreground size-4 shrink-0"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* PC 端：今日维修记录 */}
          <Card className="hidden lg:block">
            <CardHeader className="pb-2">
              <CardTitle>今日维修记录</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {todayOrders.length === 0 ? (
                <p className="text-muted-foreground px-4 pb-4 text-sm">今日暂无维修记录。</p>
              ) : (
                <CardList>
                  {todayOrders.map((order) => (
                    <WorkOrderRow key={order.id} order={order} />
                  ))}
                </CardList>
              )}
            </CardContent>
          </Card>

          {/* 本月概况（管理员） */}
          {stats.financeVisible ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>本月概况</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <SummaryRow label="本月营业额" value={formatMoney(stats.monthRevenue)} />
                <SummaryRow
                  label="本月支出"
                  value={formatMoney(stats.monthExpense)}
                  tone="expense"
                />
                <SummaryRow
                  label="本月利润"
                  value={formatMoney(stats.monthProfit)}
                  tone={Number(stats.monthProfit) >= 0 ? "income" : "expense"}
                />
                <div className="border-border border-t pt-2.5">
                  <SummaryRow
                    label="未收欠款"
                    value={formatMoney(stats.outstandingAmount)}
                    tone="expense"
                  />
                  <SummaryRow label="库存金额" value={formatMoney(stats.stockValue)} />
                  <SummaryRow label="客户总数" value={`${stats.customerCount} 位`} />
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "income" | "expense";
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span
        className={cn(
          "tabular text-sm font-semibold",
          tone === "income" && "text-success-strong",
          tone === "expense" && "text-danger-strong",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
