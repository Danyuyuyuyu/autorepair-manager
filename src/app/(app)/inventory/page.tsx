import type { Metadata } from "next";
import { History } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/shared/pagination";
import { InventoryListView } from "@/features/inventory/components/inventory-list-view";
import { requireUser } from "@/server/auth/guard";
import {
  countActiveParts,
  countLowStockParts,
  getStockValue,
  listCategories,
  listParts,
  listSuppliers,
} from "@/server/services/inventory.service";

export const metadata: Metadata = { title: "配件库存" };
export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : undefined;
  const stock = (typeof params.stock === "string" ? params.stock : "all") as "all" | "low" | "zero";
  const categoryId = typeof params.categoryId === "string" ? params.categoryId : undefined;
  const page = typeof params.page === "string" ? Number(params.page) || 1 : 1;

  const [result, categories, suppliers, stockValue, lowStockCount, partsCount] = await Promise.all([
    listParts({ q, stock, categoryId, page, pageSize: 30 }),
    listCategories("PART"),
    listSuppliers(),
    getStockValue(),
    countLowStockParts(),
    countActiveParts(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-foreground text-lg font-semibold">配件库存</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            工单添加配件时自动出库，所有变动都留流水。
          </p>
        </div>
        <Button variant="outline" size="sm" asChild className="shrink-0">
          <Link href="/inventory/transactions">
            <History />
            出入库流水
          </Link>
        </Button>
      </div>

      <InventoryListView
        parts={result.items}
        total={result.total}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        summary={{ stockValue, lowStockCount, partsCount }}
        canDelete={user.isAdmin}
      />

      <Pagination page={result.page} totalPages={result.totalPages} total={result.total} />
    </div>
  );
}
