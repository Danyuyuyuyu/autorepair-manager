"use server";

import { serviceRecordSchema, vehicleWithCustomerSchema } from "@/lib/validation/customer";
import { customerSchema } from "@/lib/validation/customer";
import { requireUserAction } from "@/server/auth/guard";
import { BusinessRuleError, safeAction } from "@/server/errors";
import { createCustomer, findCustomerIdByPhone } from "@/server/services/customer.service";
import {
  createServiceRecord,
  createVehicle,
  deleteVehicle,
  findVehicleByPlate,
  updateVehicle,
} from "@/server/services/vehicle.service";
import { parseOrThrow } from "@/server/validate";
import { revalidateBusiness } from "@/server/actions/revalidate";
import type { ActionResult } from "@/types";

/** 按车牌查车辆（新建工单最高频入口） */
export async function lookupVehicleByPlateAction(
  plate: string,
): Promise<ActionResult<Awaited<ReturnType<typeof findVehicleByPlate>>>> {
  return safeAction(async () => {
    await requireUserAction();
    return findVehicleByPlate(plate);
  });
}

export async function createVehicleAction(
  input: unknown,
): Promise<ActionResult<{ id: string; customerId: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(vehicleWithCustomerSchema, input);

    // 支持「现场新建客户 + 车辆」一步完成
    let customerId = data.customerId;
    if (!customerId) {
      if (!data.newCustomerName || !data.newCustomerPhone) {
        throw new BusinessRuleError("请选择已有客户，或填写新客户姓名与手机号。");
      }
      const existing = await findCustomerIdByPhone(data.newCustomerPhone);
      customerId = existing
        ? existing.id
        : (
            await createCustomer(
              parseOrThrow(customerSchema, {
                name: data.newCustomerName,
                phone: data.newCustomerPhone,
              }),
              user,
            )
          ).id;
    }

    const created = await createVehicle(
      {
        customerId,
        plateNumber: data.plateNumber,
        brand: data.brand,
        model: data.model,
        year: data.year,
        vin: data.vin,
        engineNo: data.engineNo,
        currentMileage: data.currentMileage,
        lastServiceAt: data.lastServiceAt,
        nextServiceAt: data.nextServiceAt,
        remark: data.remark,
      },
      user,
    );

    revalidateBusiness();
    return { id: created.id, customerId };
  });
}

export async function updateVehicleAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(vehicleWithCustomerSchema, input);
    if (!data.customerId) throw new BusinessRuleError("请选择所属客户。");

    await updateVehicle(
      id,
      {
        customerId: data.customerId,
        plateNumber: data.plateNumber,
        brand: data.brand,
        model: data.model,
        year: data.year,
        vin: data.vin,
        engineNo: data.engineNo,
        currentMileage: data.currentMileage,
        lastServiceAt: data.lastServiceAt,
        nextServiceAt: data.nextServiceAt,
        remark: data.remark,
      },
      user,
    );

    revalidateBusiness(`/vehicles/${id}`);
    return { id };
  });
}

export async function deleteVehicleAction(id: string): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    await deleteVehicle(id, user);
    revalidateBusiness();
    return { id };
  });
}

export async function createServiceRecordAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(serviceRecordSchema, input);
    const created = await createServiceRecord(data, user);
    revalidateBusiness(`/vehicles/${data.vehicleId}`);
    return { id: created.id };
  });
}
