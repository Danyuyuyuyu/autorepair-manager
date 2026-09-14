import type { Metadata } from "next";

import { FinanceView } from "@/features/finance/components/finance-view";
import { requireAdminPage } from "@/server/auth/guard";
import { getFinanceSummary, listCashFlow, listExpenses } from "@/server/services/finance.service";
import { listSuppliers } from "@/server/services/inventory.service";
import {
  endOfBusinessDay,
  endOfBusinessMonth,
  startOfBusinessDay,
  startOfBusinessMonth,
} from "@/utils/date";

export const metadata: Metadata = { title: "财务" };
export const dynamic = "force-dynamic";

function resolveRange(range: string, fromParam?: string, toParam?: string) {
  const now = new Date();

  switch (range) {
    case "today":
      return { from: startOfBusinessDay(now), to: endOfBusinessDay(now), range };
    case "week": {
      const from = startOfBusinessDay(now);
      from.setDate(from.getDate() - 6);
      return { from, to: endOfBusinessDay(now), range };
    }
    case "custom": {
      const from = fromParam ? new Date(`${fromParam}T00:00:00+08:00`) : startOfBusinessMonth(now);
      const to = toParam ? new Date(`${toParam}T23:59:59+08:00`) : endOfBusinessDay(now);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        return { from: startOfBusinessMonth(now), to: endOfBusinessMonth(now), range: "month" };
      }
      return { from, to, range };
    }
    default:
      return { from: startOfBusinessMonth(now), to: endOfBusinessMonth(now), range: "month" };
  }
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();
  const params = await searchParams;

  const range = typeof params.range === "string" ? params.range : "month";
  const fromParam = typeof params.from === "string" ? params.from : undefined;
  const toParam = typeof params.to === "string" ? params.to : undefined;

  const { from, to, range: resolvedRange } = resolveRange(range, fromParam, toParam);

  const [summary, cashFlow, expenses, suppliers] = await Promise.all([
    getFinanceSummary(from, to),
    listCashFlow({ from, to, page: 1, pageSize: 50 }),
    listExpenses({ from, to, page: 1, pageSize: 50 }),
    listSuppliers(),
  ]);

  const rangeLabel = `${from.toISOString().slice(0, 10)} ~ ${to.toISOString().slice(0, 10)}`;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-foreground text-lg font-semibold">财务记账</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">{rangeLabel}</p>
      </div>

      <FinanceView
        summary={summary}
        cashFlow={cashFlow.items}
        expenses={expenses.items}
        range={resolvedRange}
        from={from.toISOString().slice(0, 10)}
        to={to.toISOString().slice(0, 10)}
        suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
      />

      <p className="text-subtle-foreground pb-2 text-center text-xs">
        共 {cashFlow.total} 条流水 · 数据由收款与支出记录实时汇总
      </p>
    </div>
  );
}
