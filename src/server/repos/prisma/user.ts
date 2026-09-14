import type { UserRepository } from "@/domain/repositories";

import type { RepoClient } from "./client";

/** 账号 / 员工档案的 Prisma 实现 */

export function createUserRepository(client: RepoClient): UserRepository {
  return {
    async list() {
      const rows = await client.user.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          username: true,
          name: true,
          phone: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          _count: { select: { createdWorkOrders: true, payments: true } },
        },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      });

      return rows.map((row) => ({
        id: row.id,
        username: row.username,
        name: row.name,
        phone: row.phone,
        role: row.role,
        isActive: row.isActive,
        lastLoginAt: row.lastLoginAt,
        createdAt: row.createdAt,
        workOrderCount: row._count.createdWorkOrders,
        paymentCount: row._count.payments,
      }));
    },

    async findByUsernameAny(username) {
      return client.user.findFirst({
        where: { username },
        select: { id: true, deletedAt: true },
      });
    },

    async findForLogin(username) {
      return client.user.findFirst({
        where: { username, deletedAt: null },
        select: { id: true, name: true, passwordHash: true, role: true, isActive: true },
      });
    },

    async create(data) {
      return client.user.create({
        data: {
          username: data.username,
          name: data.name,
          phone: data.phone,
          passwordHash: data.passwordHash,
          role: data.role,
        },
        select: { id: true, name: true, username: true },
      });
    },

    async findForEdit(id) {
      return client.user.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, role: true, isActive: true },
      });
    },

    async update(id, patch) {
      await client.user.update({
        where: { id },
        data: {
          name: patch.name,
          phone: patch.phone,
          role: patch.role,
          isActive: patch.isActive,
        },
      });
    },

    async countActiveAdmins() {
      return client.user.count({ where: { role: "ADMIN", isActive: true, deletedAt: null } });
    },

    async findBrief(id) {
      return client.user.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true },
      });
    },

    async findWithPassword(id) {
      return client.user.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, passwordHash: true },
      });
    },

    async findOwnProfile(id) {
      return client.user.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, phone: true },
      });
    },

    async updatePassword(id, passwordHash) {
      await client.user.update({ where: { id }, data: { passwordHash } });
    },

    async recordLogin(id) {
      await client.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
    },

    async updateProfile(id, patch) {
      await client.user.update({
        where: { id },
        data: { name: patch.name, phone: patch.phone },
      });
    },

    async softDelete(id) {
      await client.user.update({
        where: { id },
        data: { isActive: false, deletedAt: new Date() },
      });
    },

    async listEmployees(onlyActive) {
      const rows = await client.employee.findMany({
        where: { deletedAt: null, ...(onlyActive ? { isActive: true } : {}) },
        select: {
          id: true,
          name: true,
          phone: true,
          position: true,
          isTechnician: true,
          isActive: true,
          userId: true,
          remark: true,
          _count: { select: { workOrders: true } },
        },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      });

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        position: row.position,
        isTechnician: row.isTechnician,
        isActive: row.isActive,
        userId: row.userId,
        remark: row.remark,
        workOrderCount: row._count.workOrders,
      }));
    },

    async saveEmployee(data) {
      const payload = {
        name: data.name,
        phone: data.phone,
        position: data.position,
        isTechnician: data.isTechnician,
        userId: data.userId,
        remark: data.remark,
      };

      if (data.id) {
        return client.employee.update({
          where: { id: data.id },
          data: payload,
          select: { id: true, name: true },
        });
      }
      return client.employee.create({ data: payload, select: { id: true, name: true } });
    },
  };
}
