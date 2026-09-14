import type { Metadata } from "next";

import { CreateWorkOrderForm } from "@/features/work-orders/components/create-work-order-form";
import { requireUser } from "@/server/auth/guard";
import { listServiceItems } from "@/server/services/inventory.service";
import { listEmployees } from "@/server/services/user.service";

export const metadata: Metadata = { title: "新建维修工单" };
export const dynamic = "force-dynamic";

export default async function NewWorkOrderPage() {
  await requireUser();

  const [serviceItems, employees] = await Promise.all([
    listServiceItems({ limit: 300 }),
    listEmployees(true),
  ]);

  const technicians = employees
    .filter((employee) => employee.isTechnician)
    .map((employee) => ({ id: employee.id, name: employee.name, position: employee.position }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-foreground text-lg font-semibold">新建维修工单</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          输入车牌即可带出客户与历史记录，未建档的车牌会自动新建。
        </p>
      </div>

      <CreateWorkOrderForm serviceItems={serviceItems} technicians={technicians} />
    </div>
  );
}
