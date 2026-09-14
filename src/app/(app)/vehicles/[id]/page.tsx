import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Car, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { WorkOrderCard } from "@/features/work-orders/components/work-order-card";
import { VehicleDetailActions } from "@/features/vehicles/components/vehicle-detail-actions";
import { formatDate, formatMoney, formatQuantity } from "@/lib/format";
import { requireUser } from "@/server/auth/guard";
import { NotFoundError } from "@/server/errors";
import { listCustomerOptions } from "@/server/services/customer.service";
import { getVehicleDetail } from "@/server/services/vehicle.service";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const vehicle = await getVehicleDetail(id);
    return { title: `${vehicle.plateNumber} · 车辆` };
  } catch {
    return { title: "车辆详情" };
  }
}

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  let vehicle;
  try {
    vehicle = await getVehicleDetail(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const customers = await listCustomerOptions();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground flex items-center gap-2 text-lg font-semibold">
            <Car className="text-brand size-5" />
            <span className="tracking-wide">{vehicle.plateNumber}</span>
          </h2>
          <p className="text-muted-foreground mt-0.5 truncate text-sm">
            {[vehicle.brand, vehicle.model, vehicle.year ? `${vehicle.year}款` : null]
              .filter(Boolean)
              .join(" ") || "未填写车型"}
          </p>
        </div>
        <VehicleDetailActions vehicle={vehicle} customers={customers} />
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="当前里程"
          value={vehicle.currentMileage ?? "-"}
          unit={vehicle.currentMileage ? "km" : undefined}
        />
        <StatCard label="维修次数" value={vehicle.workOrders.length} unit="次" />
        <StatCard
          label="累计消费"
          value={formatMoney(vehicle.totalSpent, { withSymbol: false })}
          unit="元"
        />
        <StatCard
          label="下次保养"
          value={vehicle.nextServiceAt ? formatDate(vehicle.nextServiceAt) : "未设置"}
          tone={
            vehicle.nextServiceAt &&
            new Date(vehicle.nextServiceAt).getTime() <= Date.now() + 30 * 86400000
              ? "warning"
              : "default"
          }
        />
      </div>

      <div className="flex gap-2">
        <Button asChild className="flex-1">
          <Link href="/work-orders/new">
            <Plus />
            为该车开单
          </Link>
        </Button>
        <Button asChild variant="outline" className="flex-1">
          <Link href={`/customers/${vehicle.customerId}`}>查看车主</Link>
        </Button>
      </div>

      {/* 基本信息 */}
      <Card>
        <CardContent className="space-y-2.5 pt-4">
          <p className="text-foreground text-sm font-semibold">基本信息</p>
          <dl className="space-y-2 text-sm">
            <Row label="车主" value={`${vehicle.customerName} · ${vehicle.customerPhone}`} />
            <Row label="VIN 车架号" value={vehicle.vin ?? "-"} />
            <Row label="发动机号" value={vehicle.engineNo ?? "-"} />
            <Row
              label="上次保养"
              value={vehicle.lastServiceAt ? formatDate(vehicle.lastServiceAt) : "-"}
            />
            <Row label="备注" value={vehicle.remark ?? "-"} />
          </dl>
        </CardContent>
      </Card>

      {/* 保养记录 */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
            <CalendarClock className="text-brand size-4" />
            保养记录
          </p>

          {vehicle.serviceRecords.length === 0 ? (
            <p className="rounded-control border-border text-muted-foreground border border-dashed py-5 text-center text-sm">
              暂无保养记录，工单完工时可勾选自动生成
            </p>
          ) : (
            <ol className="border-border relative space-y-4 border-l pl-4">
              {vehicle.serviceRecords.map((record) => (
                <li key={record.id} className="relative">
                  <span className="border-card bg-brand absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2" />
                  <p className="text-foreground text-sm font-medium">{record.description}</p>
                  <p className="tabular text-muted-foreground mt-0.5 text-xs">
                    {formatDate(record.servicedAt)}
                    {record.mileage ? ` · ${record.mileage} km` : ""}
                    {record.nextServiceAt ? ` · 下次 ${formatDate(record.nextServiceAt)}` : ""}
                  </p>
                  {record.workOrderNo && record.workOrderId ? (
                    <Link
                      href={`/work-orders/${record.workOrderId}`}
                      className="tabular text-brand mt-0.5 inline-block text-xs hover:underline"
                    >
                      {record.workOrderNo}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* 历史项目与配件 */}
      {(vehicle.topServices.length > 0 || vehicle.topParts.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {vehicle.topServices.length > 0 ? (
            <Card>
              <CardContent className="space-y-3 pt-4">
                <p className="text-foreground text-sm font-semibold">历史维修项目</p>
                <ul className="space-y-2">
                  {vehicle.topServices.map((item) => (
                    <li key={item.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-foreground truncate">{item.name}</span>
                      <span className="tabular text-muted-foreground shrink-0">
                        {formatQuantity(item.quantity)} 次 ·{" "}
                        {formatMoney(item.amount, { withSymbol: false })}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {vehicle.topParts.length > 0 ? (
            <Card>
              <CardContent className="space-y-3 pt-4">
                <p className="text-foreground text-sm font-semibold">历史更换配件</p>
                <ul className="space-y-2">
                  {vehicle.topParts.map((item) => (
                    <li key={item.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-foreground truncate">{item.name}</span>
                      <span className="tabular text-muted-foreground shrink-0">
                        {formatQuantity(item.quantity)} ·{" "}
                        {formatMoney(item.amount, { withSymbol: false })}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {/* 历史工单 */}
      <section className="space-y-2.5">
        <h3 className="text-foreground text-sm font-semibold">历史工单</h3>
        {vehicle.workOrders.length === 0 ? (
          <EmptyState title="暂无维修工单" description="为该车开一张工单后会显示在这里。" />
        ) : (
          <div className="space-y-2.5">
            {vehicle.workOrders.map((order) => (
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
