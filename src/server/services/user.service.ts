import "server-only";

import type { Repositories } from "@/domain/repositories";
import type { Role } from "@/domain/enums";
import { writeAuditLog } from "@/server/auth/audit";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/server/auth/password";
import { destroyAllSessions } from "@/server/auth/session";
import { repos as defaultRepos } from "@/server/context";
import { AppError, BusinessRuleError, ForbiddenError, NotFoundError } from "@/server/errors";
import type { CurrentUser } from "@/types";

/**
 * 账号 / 员工服务
 * ---------------------------------------------------------------------------
 * 【改造说明】取数与落库全部改为通过 `Repositories`，本文件不再 import Prisma。
 *
 * 保留原样的业务规则：
 *   - 账号名被停用过的用户占用时，提示「请联系管理员恢复」而不是「已存在」；
 *   - 不允许把自己降级 / 停用；
 *   - 系统至少保留一名启用状态的管理员；
 *   - 停用账号 / 改密码后吊销该账号全部会话。
 *
 * 登录会话本身（`sessions` 表）不属本服务，仍由 `server/auth/session.ts` 负责 ——
 * 它属于鉴权基础设施，手机端将改用设备令牌方案。
 */

// ---------------------------------------------------------------------------
// 账号
// ---------------------------------------------------------------------------

export async function listUsers(repos: Repositories = defaultRepos) {
  const rows = await repos.user.list();

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    name: row.name,
    phone: row.phone,
    role: row.role,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    workOrderCount: row.workOrderCount,
    paymentCount: row.paymentCount,
  }));
}

export async function createUser(
  input: { username: string; name: string; phone?: string; password: string; role: Role },
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const strength = validatePasswordStrength(input.password);
  if (strength) throw new AppError(strength, "WEAK_PASSWORD");

  const existing = await repos.user.findByUsernameAny(input.username);
  if (existing) {
    if (existing.deletedAt) {
      throw new BusinessRuleError("该账号曾被停用，请更换账号名或联系管理员恢复。");
    }
    throw new BusinessRuleError("账号已存在，请更换。");
  }

  const created = await repos.user.create({
    username: input.username,
    name: input.name,
    phone: input.phone || null,
    passwordHash: await hashPassword(input.password),
    role: input.role,
  });

  await writeAuditLog({
    user,
    action: "USER_CREATE",
    entity: "user",
    entityId: created.id,
    summary: `新增员工账号「${created.name}」( ${created.username} / ${input.role} )`,
  });

  return created;
}

export async function updateUser(
  input: { id: string; name: string; phone?: string; role: Role; isActive: boolean },
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const existing = await repos.user.findForEdit(input.id);
  if (!existing) throw new NotFoundError("账号不存在。");

  // 不允许把自己降级或停用，避免把最后一个管理员锁死
  if (existing.id === user.id && (input.role !== "ADMIN" || !input.isActive)) {
    throw new BusinessRuleError("不能修改自己的角色或停用自己的账号。");
  }

  if (existing.role === "ADMIN" && (!input.isActive || input.role !== "ADMIN")) {
    const adminCount = await repos.user.countActiveAdmins();
    if (adminCount <= 1) throw new BusinessRuleError("系统至少需要保留一名启用状态的管理员。");
  }

  await repos.user.update(input.id, {
    name: input.name,
    phone: input.phone || null,
    role: input.role,
    isActive: input.isActive,
  });

  if (!input.isActive) {
    await destroyAllSessions(input.id);
  }

  await writeAuditLog({
    user,
    action: "USER_UPDATE",
    entity: "user",
    entityId: input.id,
    summary: `修改账号「${input.name}」角色=${input.role} 启用=${input.isActive}`,
    before: existing,
    after: input,
  });

  return { id: input.id };
}

export async function resetPassword(
  id: string,
  password: string,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const strength = validatePasswordStrength(password);
  if (strength) throw new AppError(strength, "WEAK_PASSWORD");

  const existing = await repos.user.findBrief(id);
  if (!existing) throw new NotFoundError("账号不存在。");

  await repos.user.updatePassword(id, await hashPassword(password));

  await destroyAllSessions(id);

  await writeAuditLog({
    user,
    action: "USER_UPDATE",
    entity: "user",
    entityId: id,
    summary: `重置「${existing.name}」的登录密码`,
  });

  return { id };
}

export async function deleteUser(
  id: string,
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  if (!user.isAdmin) throw new ForbiddenError("只有管理员可以停用账号。");
  if (id === user.id) throw new BusinessRuleError("不能停用自己的账号。");

  const existing = await repos.user.findForEdit(id);
  if (!existing) throw new NotFoundError("账号不存在。");

  if (existing.role === "ADMIN") {
    const adminCount = await repos.user.countActiveAdmins();
    if (adminCount <= 1) throw new BusinessRuleError("系统至少需要保留一名管理员。");
  }

  await repos.user.softDelete(id);
  await destroyAllSessions(id);

  await writeAuditLog({
    user,
    action: "USER_DELETE",
    entity: "user",
    entityId: id,
    summary: `停用账号「${existing.name}」`,
    before: existing,
  });

  return { id };
}

// ---------------------------------------------------------------------------
// 个人设置
// ---------------------------------------------------------------------------

export async function changeOwnPassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  repos: Repositories = defaultRepos,
) {
  const account = await repos.user.findWithPassword(userId);
  if (!account) throw new NotFoundError("账号不存在。");

  const ok = await verifyPassword(input.currentPassword, account.passwordHash);
  if (!ok) throw new AppError("当前密码不正确。", "INVALID_PASSWORD");

  const strength = validatePasswordStrength(input.newPassword);
  if (strength) throw new AppError(strength, "WEAK_PASSWORD");

  await repos.user.updatePassword(userId, await hashPassword(input.newPassword));

  await destroyAllSessions(userId);
  await writeAuditLog({
    user: { id: userId, name: account.name },
    action: "USER_UPDATE",
    entity: "user",
    entityId: userId,
    summary: "修改自己的登录密码",
  });

  return { id: userId };
}

export async function updateOwnProfile(
  userId: string,
  input: { name: string; phone?: string },
  repos: Repositories = defaultRepos,
) {
  const account = await repos.user.findOwnProfile(userId);
  if (!account) throw new NotFoundError("账号不存在。");

  await repos.user.updateProfile(userId, { name: input.name, phone: input.phone || null });

  await writeAuditLog({
    user: { id: userId, name: input.name },
    action: "USER_UPDATE",
    entity: "user",
    entityId: userId,
    summary: "修改个人资料",
    before: account,
    after: input,
  });

  return { id: userId };
}

// ---------------------------------------------------------------------------
// 员工档案（技师）
// ---------------------------------------------------------------------------

export async function listEmployees(onlyActive = true, repos: Repositories = defaultRepos) {
  return repos.user.listEmployees(onlyActive);
}

export async function saveEmployee(
  input: {
    id?: string;
    name: string;
    phone?: string;
    position?: string;
    isTechnician: boolean;
    userId?: string;
    remark?: string;
  },
  user: CurrentUser,
  repos: Repositories = defaultRepos,
) {
  const data = {
    id: input.id,
    name: input.name,
    phone: input.phone || null,
    position: input.position || null,
    isTechnician: input.isTechnician,
    userId: input.userId || null,
    remark: input.remark || null,
  };

  const saved = await repos.user.saveEmployee(data);

  await writeAuditLog({
    user,
    action: "USER_UPDATE",
    entity: "employee",
    entityId: saved.id,
    summary: `${input.id ? "修改" : "新增"}员工「${saved.name}」`,
    after: data,
  });

  return saved;
}
