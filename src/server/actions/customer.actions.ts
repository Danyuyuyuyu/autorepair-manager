"use server";

import { customerSchema } from "@/lib/validation/customer";
import { requireUserAction } from "@/server/auth/guard";
import { safeAction } from "@/server/errors";
import {
  createCustomer,
  deleteCustomer,
  findCustomerByPhone,
  updateCustomer,
} from "@/server/services/customer.service";
import { parseOrThrow } from "@/server/validate";
import { revalidateBusiness } from "@/server/actions/revalidate";
import type { ActionResult } from "@/types";

export async function createCustomerAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(customerSchema, input);
    const created = await createCustomer(data, user);
    revalidateBusiness();
    return { id: created.id };
  });
}

export async function updateCustomerAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(customerSchema, input);
    await updateCustomer(id, data, user);
    revalidateBusiness(`/customers/${id}`);
    return { id };
  });
}

export async function deleteCustomerAction(id: string): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    await deleteCustomer(id, user);
    revalidateBusiness();
    return { id };
  });
}

/** 按手机号查客户（新建工单第一步） */
export async function lookupCustomerByPhoneAction(
  phone: string,
): Promise<ActionResult<Awaited<ReturnType<typeof findCustomerByPhone>>>> {
  return safeAction(async () => {
    await requireUserAction();
    return findCustomerByPhone(phone);
  });
}
