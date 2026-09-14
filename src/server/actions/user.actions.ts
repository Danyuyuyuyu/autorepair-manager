"use server";

import {
  changeOwnPasswordSchema,
  createUserSchema,
  employeeSchema,
  resetPasswordSchema,
  updateUserSchema,
} from "@/lib/validation/auth";
import { ForbiddenError, safeAction } from "@/server/errors";
import { requireAdminAction, requireUserAction } from "@/server/auth/guard";
import {
  changeOwnPassword,
  createUser,
  deleteUser,
  resetPassword,
  saveEmployee,
  updateOwnProfile,
  updateUser,
} from "@/server/services/user.service";
import { parseOrThrow } from "@/server/validate";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/types";

export async function createUserAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireAdminAction();
    const data = parseOrThrow(createUserSchema, input);
    const created = await createUser(data, user);
    revalidatePath("/settings/users");
    return { id: created.id };
  });
}

export async function updateUserAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireAdminAction();
    const data = parseOrThrow(updateUserSchema, input);
    await updateUser(data, user);
    revalidatePath("/settings/users");
    return { id: data.id };
  });
}

export async function resetPasswordAction(
  id: string,
  password: string,
): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireAdminAction();
    const data = parseOrThrow(resetPasswordSchema, { id, password });
    await resetPassword(data.id, data.password, user);
    revalidatePath("/settings/users");
    return { id };
  });
}

export async function deleteUserAction(id: string): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireAdminAction();
    await deleteUser(id, user);
    revalidatePath("/settings/users");
    return { id };
  });
}

export async function changeOwnPasswordAction(
  input: unknown,
): Promise<ActionResult<{ changed: true }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    const data = parseOrThrow(changeOwnPasswordSchema, input);
    await changeOwnPassword(user.id, data);
    return { changed: true };
  });
}

export async function updateOwnProfileAction(input: {
  name: string;
  phone?: string;
}): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireUserAction();
    if (!input.name.trim()) throw new ForbiddenError("请填写姓名。");
    await updateOwnProfile(user.id, { name: input.name.trim(), phone: input.phone });
    revalidatePath("/me");
    return { id: user.id };
  });
}

export async function saveEmployeeAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const user = await requireAdminAction();
    const data = parseOrThrow(employeeSchema, input);
    const saved = await saveEmployee(data, user);
    revalidatePath("/settings/employees");
    return { id: saved.id };
  });
}
