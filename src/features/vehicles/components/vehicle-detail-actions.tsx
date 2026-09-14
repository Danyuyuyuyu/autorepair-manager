"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  VehicleFormSheet,
  type CustomerOption,
} from "@/features/vehicles/components/vehicle-list-view";
import { createServiceRecordAction } from "@/server/actions/vehicle.actions";
import type { VehicleDetailDTO } from "@/types";

export function VehicleDetailActions({
  vehicle,
  customers,
}: {
  vehicle: VehicleDetailDTO;
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [recordOpen, setRecordOpen] = React.useState(false);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={() => setRecordOpen(true)}
        aria-label="添加保养记录"
      >
        <CalendarPlus />
      </Button>
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        <Pencil />
        编辑
      </Button>

      <VehicleFormSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        customers={customers}
        initial={{
          id: vehicle.id,
          customerId: vehicle.customerId,
          newCustomerName: "",
          newCustomerPhone: "",
          plateNumber: vehicle.plateNumber,
          brand: vehicle.brand ?? "",
          model: vehicle.model ?? "",
          year: vehicle.year ? String(vehicle.year) : "",
          vin: vehicle.vin ?? "",
          engineNo: vehicle.engineNo ?? "",
          currentMileage: vehicle.currentMileage ? String(vehicle.currentMileage) : "",
          nextServiceAt: vehicle.nextServiceAt ? vehicle.nextServiceAt.slice(0, 10) : "",
          remark: vehicle.remark ?? "",
        }}
        onSaved={() => router.refresh()}
      />

      <ServiceRecordSheet
        open={recordOpen}
        onOpenChange={setRecordOpen}
        vehicleId={vehicle.id}
        plateNumber={vehicle.plateNumber}
        currentMileage={vehicle.currentMileage}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

function ServiceRecordSheet({
  open,
  onOpenChange,
  vehicleId,
  plateNumber,
  currentMileage,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  plateNumber: string;
  currentMileage: number | null;
  onSaved: () => void;
}) {
  const [description, setDescription] = React.useState("");
  const [mileage, setMileage] = React.useState(currentMileage ? String(currentMileage) : "");
  const [nextServiceAt, setNextServiceAt] = React.useState("");
  const [nextServiceMileage, setNextServiceMileage] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setDescription("");
    setMileage(currentMileage ? String(currentMileage) : "");
    setNextServiceAt("");
    setNextServiceMileage("");
  }, [open, currentMileage]);

  const submit = async () => {
    if (!description.trim()) {
      toast.error("请填写保养内容。");
      return;
    }

    setSubmitting(true);
    const result = await createServiceRecordAction({
      vehicleId,
      servicedAt: new Date().toISOString(),
      mileage: mileage ? Number(mileage) : undefined,
      description: description.trim(),
      nextServiceAt: nextServiceAt || undefined,
      nextServiceMileage: nextServiceMileage ? Number(nextServiceMileage) : undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success("保养记录已登记");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="登记保养记录"
        description={plateNumber}
        footer={
          <Button size="lg" block loading={submitting} onClick={() => void submit()}>
            保存记录
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="保养内容" required>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例如：更换机油机滤、空调滤芯、四轮定位"
            />
          </Field>

          <Field label="本次里程">
            <Input
              value={mileage}
              onChange={(e) => setMileage(e.target.value.replace(/\D/g, ""))}
              placeholder="km"
              inputMode="numeric"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="下次保养日期">
              <Input
                type="date"
                value={nextServiceAt}
                onChange={(e) => setNextServiceAt(e.target.value)}
              />
            </Field>
            <Field label="下次保养里程">
              <Input
                value={nextServiceMileage}
                onChange={(e) => setNextServiceMileage(e.target.value.replace(/\D/g, ""))}
                placeholder="km"
                inputMode="numeric"
              />
            </Field>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
