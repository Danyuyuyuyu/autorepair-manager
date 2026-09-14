"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, Pencil, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AdjustStockSheet,
  PartFormSheet,
  PurchaseInSheet,
} from "@/features/inventory/components/inventory-list-view";
import type { PartListItemDTO } from "@/types";

interface Option {
  id: string;
  name: string;
}

type PartDetail = PartListItemDTO & {
  supplierId: string | null;
  location: string | null;
  remark: string | null;
};

export function PartDetailActions({
  part,
  categories,
  suppliers,
}: {
  part: PartDetail;
  categories: Option[];
  suppliers: Option[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [purchaseOpen, setPurchaseOpen] = React.useState(false);
  const [adjustOpen, setAdjustOpen] = React.useState(false);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setPurchaseOpen(true)}>
        <ArrowDownToLine />
        入库
      </Button>
      <Button variant="outline" size="sm" onClick={() => setAdjustOpen(true)}>
        <SlidersHorizontal />
        调整
      </Button>
      <Button variant="outline" size="icon" onClick={() => setEditOpen(true)} aria-label="编辑配件">
        <Pencil />
      </Button>

      <PartFormSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        categories={categories}
        suppliers={suppliers}
        initial={{
          id: part.id,
          code: part.code ?? "",
          name: part.name,
          spec: part.spec ?? "",
          brand: part.brand ?? "",
          unit: part.unit,
          categoryId: part.categoryId ?? "",
          supplierId: part.supplierId ?? "",
          costPrice: part.costPrice,
          salePrice: part.salePrice,
          safeQuantity: part.safeQuantity,
          location: part.location ?? "",
          remark: part.remark ?? "",
          initialQuantity: "0",
        }}
        onSaved={() => router.refresh()}
      />

      <PurchaseInSheet
        part={purchaseOpen ? part : null}
        onOpenChange={(open) => setPurchaseOpen(open)}
        suppliers={suppliers}
        onSaved={() => router.refresh()}
      />

      <AdjustStockSheet
        part={adjustOpen ? part : null}
        onOpenChange={(open) => setAdjustOpen(open)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
