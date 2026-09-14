import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { InventoryTxBadge } from "@/components/shared/status-badge";
import { PartDetailActions } from "@/features/inventory/components/part-detail-actions";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { requireUser } from "@/server/auth/guard";
import { NotFoundError } from "@/server/errors";
import { getPartDetail, listCategories, listSuppliers } from "@/server/services/inventory.service";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const part = await getPartDetail(id);
    return { title: `${part.name} · 配件` };
  } catch {
    return { title: "配件详情" };
  }
}

export default async function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  let part;
  try {
    part = await getPartDetail(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [categories, suppliers] = await Promise.all([listCategories("PART"), listSuppliers()]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" asChild className="-ml-2 lg:hidden">
              <Link href="/inventory" aria-label="返回">
                <ArrowLeft />
              </Link>
            </Button>
            <h2 className="text-foreground flex items-center gap-2 truncate text-lg font-semibold">
              <Package className="text-brand size-5 shrink-0" />
              {part.name}
            </h2>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-sm">
            {[part.spec, part.brand, part.categoryName].filter(Boolean).join(" · ") || "无规格"}
          </p>
        </div>

        <PartDetailActions
          part={part}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="当前库存"
          value={formatQuantity(part.quantity)}
          unit={part.unit}
          tone={part.isLowStock ? "danger" : "default"}
          hint={
            part.isLowStock ? `低于安全库存 ${part.safeQuantity}` : `安全库存 ${part.safeQuantity}`
          }
        />
        <StatCard
          label="库存金额"
          value={formatMoney(part.stockValue, { withSymbol: false })}
          unit="元"
          tone="brand"
          hint={`均价 ¥${part.avgCost}`}
        />
        <StatCard
          label="进货价"
          value={formatMoney(part.costPrice, { withSymbol: false })}
          unit="元"
        />
        <StatCard
          label="销售价"
          value={formatMoney(part.salePrice, { withSymbol: false })}
          unit="元"
        />
      </div>

      <Card>
        <CardContent className="space-y-2.5 pt-4">
          <p className="text-foreground text-sm font-semibold">销售统计</p>
          <dl className="space-y-2 text-sm">
            <Row label="累计售出数量" value={formatQuantity(part.soldQuantity, part.unit)} />
            <Row label="累计销售金额" value={formatMoney(part.soldAmount)} />
            <Row label="涉及工单数" value={`${part.soldCount} 张`} />
            <Row label="货架位置" value={part.location ?? "-"} />
            <Row label="默认供应商" value={part.supplierName ?? "-"} />
            <Row label="配件编码" value={part.code ?? "-"} />
            <Row label="备注" value={part.remark ?? "-"} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-foreground text-sm font-semibold">库存流水</p>

          {part.transactions.length === 0 ? (
            <EmptyState title="暂无库存变动" description="入库或工单出库后会产生流水记录。" />
          ) : (
            <ul className="divide-border rounded-control border-border divide-y overflow-hidden border">
              {part.transactions.map((tx) => (
                <li key={tx.id} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <InventoryTxBadge type={tx.type} size="sm" />
                      <span className="tabular text-foreground text-sm font-medium">
                        {tx.qtyBefore} → {tx.qtyAfter}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 truncate text-xs">
                      {formatDateTime(tx.createdAt)}
                      {tx.workOrderNo ? ` · ${tx.workOrderNo}` : ""}
                      {tx.operatorName ? ` · ${tx.operatorName}` : ""}
                      {tx.remark ? ` · ${tx.remark}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-foreground text-sm font-semibold">{tx.quantity}</p>
                    {tx.amount ? (
                      <p className="tabular text-muted-foreground text-xs">
                        {formatMoney(tx.amount, { withSymbol: false })}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-foreground min-w-0 text-right font-medium break-words">{value}</dd>
    </div>
  );
}
