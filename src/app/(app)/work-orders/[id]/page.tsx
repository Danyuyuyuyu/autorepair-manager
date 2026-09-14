import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkOrderDetailView } from "@/features/work-orders/components/work-order-detail-view";
import { requireUser } from "@/server/auth/guard";
import { NotFoundError } from "@/server/errors";
import { listServiceItems } from "@/server/services/inventory.service";
import { listEmployees } from "@/server/services/user.service";
import { getWorkOrderDetail } from "@/server/services/work-order.service";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const order = await getWorkOrderDetail(id);
    return { title: `${order.plateNumber} · ${order.orderNo}` };
  } catch {
    return { title: "工单详情" };
  }
}

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  let order;
  try {
    order = await getWorkOrderDetail(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [serviceItems, employees] = await Promise.all([
    listServiceItems({ limit: 300 }),
    listEmployees(true),
  ]);

  const technicians = employees
    .filter((employee) => employee.isTechnician)
    .map((employee) => ({ id: employee.id, name: employee.name, position: employee.position }));

  return (
    <WorkOrderDetailView
      order={order}
      technicians={technicians}
      serviceItems={serviceItems}
      isAdmin={user.isAdmin}
    />
  );
}
