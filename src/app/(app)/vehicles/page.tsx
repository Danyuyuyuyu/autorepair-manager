import type { Metadata } from "next";

import { Pagination } from "@/components/shared/pagination";
import { VehicleListView } from "@/features/vehicles/components/vehicle-list-view";
import { requireUser } from "@/server/auth/guard";
import { listCustomerOptions } from "@/server/services/customer.service";
import { listVehicles } from "@/server/services/vehicle.service";

export const metadata: Metadata = { title: "车辆" };
export const dynamic = "force-dynamic";

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const page = typeof params.page === "string" ? Number(params.page) || 1 : 1;
  const q = typeof params.q === "string" ? params.q : undefined;

  const [result, customers] = await Promise.all([
    listVehicles({ q, page, pageSize: 24 }),
    listCustomerOptions(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-foreground text-lg font-semibold">车辆档案</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          按车牌号、VIN、品牌或客户查询车辆与保养记录。
        </p>
      </div>

      <VehicleListView
        vehicles={result.items}
        total={result.total}
        customers={customers}
        canDelete={user.isAdmin}
      />

      <Pagination page={result.page} totalPages={result.totalPages} total={result.total} />
    </div>
  );
}
