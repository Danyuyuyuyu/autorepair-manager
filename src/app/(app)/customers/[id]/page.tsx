import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Car, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { CustomerDetailActions } from "@/features/customers/components/customer-detail-actions";
import { WorkOrderCard } from "@/features/work-orders/components/work-order-card";
import { formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth/guard";
import { NotFoundError } from "@/server/errors";
import { getCustomerDetail } from "@/server/services/customer.service";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const customer = await getCustomerDetail(id);
    return { title: `${customer.name} · 客户` };
  } catch {
    return { title: "客户详情" };
  }
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  let customer;
  try {
    customer = await getCustomerDetail(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground truncate text-lg font-semibold">{customer.name}</h2>
          <p className="tabular text-muted-foreground mt-0.5 text-sm">{customer.phone}</p>
        </div>
        <CustomerDetailActions customer={customer} />
      </div>

      {/* 客户经营数据 */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="名下车辆" value={customer.vehicleCount} unit="台" />
        <StatCard label="累计维修" value={customer.workOrderCount} unit="次" />
        <StatCard
          label="历史消费"
          value={formatMoney(customer.totalSpent, { withSymbol: false })}
          unit="元"
        />
        <StatCard
          label="当前欠款"
          value={formatMoney(customer.outstandingAmount, { withSymbol: false })}
          unit="元"
          tone={Number(customer.outstandingAmount) > 0 ? "danger" : "success"}
        />
      </div>

      {/* 基本资料 */}
      <Card>
        <CardContent className="space-y-2.5 pt-4">
          <p className="text-foreground text-sm font-semibold">基本资料</p>
          <dl className="space-y-2 text-sm">
            <Row label="微信备注" value={customer.wechat ?? "-"} />
            <Row label="地址" value={customer.address ?? "-"} />
            <Row label="备注" value={customer.remark ?? "-"} />
          </dl>
        </CardContent>
      </Card>

      {/* 名下车辆 */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-foreground text-sm font-semibold">名下车辆</h3>
          <Button variant="outline" size="sm" asChild>
            <Link href="/vehicles?action=new">
              <Plus />
              添加车辆
            </Link>
          </Button>
        </div>

        {customer.vehicles.length === 0 ? (
          <EmptyState title="还没有登记车辆" description="添加车辆后即可开单维修。" />
        ) : (
          <div className="grid gap-2.5 lg:grid-cols-2">
            {customer.vehicles.map((vehicle) => (
              <Link
                key={vehicle.id}
                href={`/vehicles/${vehicle.id}`}
                className="rounded-card border-border bg-card shadow-card active:bg-muted flex items-center gap-3 border p-3.5 transition-colors"
              >
                <span className="rounded-control bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center">
                  <Car className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-[16px] font-semibold tracking-wide">
                    {vehicle.plateNumber}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "未填写车型"}
                    {vehicle.currentMileage ? ` · ${vehicle.currentMileage} km` : ""}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 历史维修记录 */}
      <section className="space-y-2.5">
        <h3 className="text-foreground text-sm font-semibold">历史维修记录</h3>
        {customer.recentWorkOrders.length === 0 ? (
          <EmptyState title="暂无维修记录" description="开第一张工单后就会显示在这里。" />
        ) : (
          <div className="space-y-2.5">
            {customer.recentWorkOrders.map((order) => (
              <WorkOrderCard key={order.id} order={order} showCustomer={false} />
            ))}
          </div>
        )}
      </section>
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
