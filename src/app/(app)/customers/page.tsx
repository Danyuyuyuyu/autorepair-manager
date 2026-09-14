import type { Metadata } from "next";

import { CustomerListView } from "@/features/customers/components/customer-list-view";
import { Pagination } from "@/components/shared/pagination";
import { requireUser } from "@/server/auth/guard";
import { listCustomers } from "@/server/services/customer.service";

export const metadata: Metadata = { title: "客户" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const page = typeof params.page === "string" ? Number(params.page) || 1 : 1;
  const q = typeof params.q === "string" ? params.q : undefined;

  const result = await listCustomers({ q, page, pageSize: 24 });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-foreground text-lg font-semibold">客户管理</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          支持按姓名、手机号搜索；一位客户可拥有多台车辆。
        </p>
      </div>

      <CustomerListView customers={result.items} total={result.total} canDelete={user.isAdmin} />

      <Pagination page={result.page} totalPages={result.totalPages} total={result.total} />
    </div>
  );
}
