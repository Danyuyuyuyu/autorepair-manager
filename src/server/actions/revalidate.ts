import "server-only";

import { revalidatePath } from "next/cache";

/** 业务数据变动后需要刷新的路径集合（集中管理，避免漏刷） */
const BUSINESS_PATHS = [
  "/dashboard",
  "/work-orders",
  "/customers",
  "/vehicles",
  "/inventory",
  "/finance",
  "/reports",
  "/me",
];

export function revalidateBusiness(...extra: string[]) {
  for (const path of BUSINESS_PATHS) revalidatePath(path);
  for (const path of extra) revalidatePath(path);
}

export function revalidateWorkOrder(id?: string) {
  revalidateBusiness();
  revalidatePath("/work-orders");
  if (id) revalidatePath(`/work-orders/${id}`);
}

export function revalidateInventory() {
  revalidateBusiness();
  revalidatePath("/inventory");
}

export function revalidateFinance() {
  revalidatePath("/dashboard");
  revalidatePath("/finance");
  revalidatePath("/reports");
}
