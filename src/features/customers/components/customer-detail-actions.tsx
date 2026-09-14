"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CustomerFormSheet } from "@/features/customers/components/customer-list-view";
import type { CustomerDetailDTO } from "@/types";

/** 客户详情页右上角操作（编辑资料 / 拨打电话） */
export function CustomerDetailActions({ customer }: { customer: CustomerDetailDTO }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button variant="outline" size="icon" asChild aria-label="拨打电话">
        <a href={`tel:${customer.phone}`}>
          <Phone />
        </a>
      </Button>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil />
        编辑
      </Button>

      <CustomerFormSheet
        open={open}
        onOpenChange={setOpen}
        initial={{
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          wechat: customer.wechat ?? "",
          address: customer.address ?? "",
          remark: customer.remark ?? "",
        }}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
