import type { Metadata } from "next";

import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import {
  OrderCountChart,
  PaymentMethodChart,
  RankingBarList,
  RevenueTrendChart,
} from "@/features/reports/components/report-charts";
import { formatMoney, formatPercent } from "@/lib/format";
import { requireAdminPage } from "@/server/auth/guard";
import {
  getItemRanking,
  getOutstandingSummary,
  getReportCharts,
  getReportOverview,
} from "@/server/services/report.service";

export const metadata: Metadata = { title: "报表" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requireAdminPage();

  const [overview, charts, serviceRanking, partRanking, outstanding] = await Promise.all([
    getReportOverview(),
    getReportCharts(14),
    getItemRanking("SERVICE", { limit: 8 }),
    getItemRanking("PART", { limit: 8 }),
    getOutstandingSummary(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-foreground text-lg font-semibold">经营报表</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">数据口径：工单与收支流水实时汇总</p>
      </div>

      {/* 核心指标 */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="今日营业额"
          value={formatMoney(overview.todayRevenue, { withSymbol: false })}
          unit="元"
          tone="brand"
        />
        <StatCard
          label="本月营业额"
          value={formatMoney(overview.monthRevenue, { withSymbol: false })}
          unit="元"
          tone="brand"
        />
        <StatCard
          label="本月支出"
          value={formatMoney(overview.monthExpense, { withSymbol: false })}
          unit="元"
          tone="danger"
        />
        <StatCard
          label="本月利润"
          value={formatMoney(overview.monthProfit, { withSymbol: false })}
          unit="元"
          tone={Number(overview.monthProfit) >= 0 ? "success" : "danger"}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="本月工单" value={overview.monthOrderCount} unit="张" />
        <StatCard label="客户总数" value={overview.customerCount} unit="位" />
        <StatCard
          label="配件库存金额"
          value={formatMoney(overview.stockValue, { withSymbol: false })}
          unit="元"
        />
        <StatCard
          label="欠款金额"
          value={formatMoney(overview.outstandingAmount, { withSymbol: false })}
          unit="元"
          tone={Number(overview.outstandingAmount) > 0 ? "danger" : "success"}
          hint={`${outstanding.orderCount} 张工单未结清`}
        />
      </div>

      {/* 利润结构 */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-foreground text-sm font-semibold">本月利润结构</p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="维修项目收入" value={overview.monthServiceRevenue} />
            <Metric label="配件收入" value={overview.monthPartsRevenue} />
            <Metric label="工时收入" value={overview.monthLaborRevenue} />
            <Metric label="配件成本" value={overview.monthPartsCost} tone="expense" />
          </div>

          <div className="border-border grid grid-cols-2 gap-3 border-t pt-3">
            <Metric label="毛利润" value={overview.grossProfit} tone="income" />
            <Metric
              label="毛利率"
              value={formatPercent(overview.grossMarginRate)}
              tone="income"
              isRaw
            />
          </div>

          <p className="text-muted-foreground text-xs leading-relaxed">
            毛利润 = 营业收入 −
            配件成本，用于衡量定价与采购是否健康；经营利润还需扣除房租、工资等固定支出。
          </p>
        </CardContent>
      </Card>

      {/* 趋势图 */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-foreground text-sm font-semibold">近 14 天营业额趋势</p>
            <span className="text-muted-foreground text-xs">含支出对比</span>
          </div>
          <RevenueTrendChart data={charts.trend} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-foreground text-sm font-semibold">每日工单量</p>
            <OrderCountChart data={charts.trend} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-foreground text-sm font-semibold">支付方式统计</p>
            <PaymentMethodChart data={charts.paymentMethodStats} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-foreground text-sm font-semibold">维修项目排行（本月）</p>
            <RankingBarList items={serviceRanking} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-foreground text-sm font-semibold">配件销售排行（本月）</p>
            <RankingBarList items={partRanking} tone="success" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
  isRaw,
}: {
  label: string;
  value: string;
  tone?: "default" | "income" | "expense";
  isRaw?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={`tabular mt-0.5 text-[17px] font-semibold ${
          tone === "income"
            ? "text-success-strong"
            : tone === "expense"
              ? "text-danger-strong"
              : "text-foreground"
        }`}
      >
        {isRaw ? value : formatMoney(value)}
      </p>
    </div>
  );
}
