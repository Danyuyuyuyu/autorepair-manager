"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PAYMENT_METHOD_LABELS } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import type { PaymentMethod } from "@prisma/client";
import type { ReportChartsDTO } from "@/types";

/** 图表统一使用设计令牌中的色值（与 Tailwind 主题一致） */
const COLORS = {
  revenue: "#2563eb",
  expense: "#dc2626",
  profit: "#16a34a",
  grid: "#e6e8ec",
  axis: "#94a3b8",
};

const PIE_COLORS = ["#2563eb", "#0ea5e9", "#16a34a", "#f59e0b", "#8b5cf6", "#64748b"];

function shortDate(key: string) {
  const parts = key.split("-");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

/**
 * 移动端图表原则：只保留最必要的维度，去掉网格噪音与旋转标签。
 */
export function RevenueTrendChart({ data }: { data: ReportChartsDTO["trend"] }) {
  const chartData = React.useMemo(
    () =>
      data.map((point) => ({
        date: shortDate(point.date),
        revenue: Number(point.revenue),
        expense: Number(point.expense),
      })),
    [data],
  );

  return (
    <div className="h-56 w-full lg:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.revenue} stopOpacity={0.22} />
              <stop offset="100%" stopColor={COLORS.revenue} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.expense} stopOpacity={0.16} />
              <stop offset="100%" stopColor={COLORS.expense} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: COLORS.axis }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 11, fill: COLORS.axis }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={(value: number) =>
              value >= 10000 ? `${value / 10000}万` : String(value)
            }
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: "1px solid #e6e8ec",
              boxShadow: "0 4px 12px -2px rgb(15 23 42 / 0.08)",
              fontSize: 12,
            }}
            formatter={(value: number, name) => [
              formatMoney(value),
              name === "revenue" ? "营业额" : "支出",
            ]}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke={COLORS.revenue}
            strokeWidth={2}
            fill="url(#revenueFill)"
            name="营业额"
          />
          <Area
            type="monotone"
            dataKey="expense"
            stroke={COLORS.expense}
            strokeWidth={2}
            fill="url(#expenseFill)"
            name="支出"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PaymentMethodChart({ data }: { data: ReportChartsDTO["paymentMethodStats"] }) {
  const chartData = React.useMemo(
    () =>
      data.map((item) => ({
        name: PAYMENT_METHOD_LABELS[item.method as PaymentMethod] ?? item.method,
        value: Number(item.amount),
      })),
    [data],
  );

  if (chartData.length === 0) {
    return <p className="text-muted-foreground py-10 text-center text-sm">本月暂无收款记录</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius="52%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="none"
          >
            {chartData.map((entry, index) => (
              <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: "1px solid #e6e8ec",
              fontSize: 12,
            }}
            formatter={(value: number) => formatMoney(value)}
          />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            iconSize={8}
            formatter={(value) => <span style={{ fontSize: 12, color: "#64748b" }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OrderCountChart({ data }: { data: ReportChartsDTO["trend"] }) {
  const chartData = React.useMemo(
    () => data.map((point) => ({ date: shortDate(point.date), count: point.orderCount })),
    [data],
  );

  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -26 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: COLORS.axis }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 11, fill: COLORS.axis }}
            axisLine={false}
            tickLine={false}
            width={42}
          />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: "1px solid #e6e8ec", fontSize: 12 }}
            formatter={(value: number) => [`${value} 张`, "工单数"]}
          />
          <Bar dataKey="count" fill={COLORS.revenue} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 排行榜用纯 CSS 条形，移动端比图表更易读 */
export function RankingBarList({
  items,
  tone = "brand",
}: {
  items: Array<{ name: string; amount: string; quantity: string }>;
  tone?: "brand" | "success";
}) {
  if (items.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">该区间暂无数据</p>;
  }

  const max = Math.max(...items.map((item) => Number(item.amount)), 1);

  return (
    <ul className="space-y-3">
      {items.map((item, index) => (
        <li key={item.name}>
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold ${
                  index < 3 ? "bg-brand-soft text-brand-strong" : "bg-muted text-muted-foreground"
                }`}
              >
                {index + 1}
              </span>
              <span className="text-foreground truncate text-sm">{item.name}</span>
            </span>
            <span className="tabular text-foreground shrink-0 text-sm font-medium">
              {formatMoney(item.amount, { withSymbol: false })}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
              <div
                className={`h-full rounded-full ${tone === "brand" ? "bg-brand" : "bg-success"}`}
                style={{ width: `${Math.max(2, (Number(item.amount) / max) * 100)}%` }}
              />
            </div>
            <span className="tabular text-subtle-foreground shrink-0 text-[11px]">
              ×{item.quantity}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
