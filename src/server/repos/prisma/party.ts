import type { Prisma } from "@prisma/client";

import type { CustomerRepository, VehicleRepository } from "@/domain/repositories";
import type { VehicleSuggestionRow } from "@/domain/rows";
import { plateMatchKeyword } from "@/lib/plate";
import { customerListSelect, vehicleListSelect } from "@/server/selects";

import type { RepoClient } from "./client";

/** 客户 / 车辆的 Prisma 实现 */

export function createCustomerRepository(client: RepoClient): CustomerRepository {
  return {
    async findByPhone(phone, excludeId) {
      return client.customer.findFirst({
        where: {
          phone,
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true, name: true },
      });
    },

    async searchForGlobal(keyword, limit) {
      const rows = await client.customer.findMany({
        where: {
          deletedAt: null,
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { phone: { contains: keyword } },
            { wechat: { contains: keyword, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, phone: true, _count: { select: { vehicles: true } } },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        vehicleCount: c._count.vehicles,
      }));
    },

    async suggest(keyword, limit) {
      return client.customer.findMany({
        where: {
          deletedAt: null,
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { phone: { contains: keyword } },
          ],
        },
        select: { id: true, name: true, phone: true },
        take: limit,
      });
    },

    async existsActive(id) {
      const found = await client.customer.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      return found !== null;
    },

    async countActive() {
      return client.customer.count({ where: { deletedAt: null } });
    },

    async countCreatedBetween(from, to) {
      return client.customer.count({
        where: { deletedAt: null, createdAt: { gte: from, lte: to } },
      });
    },

    async list(filter, paging) {
      // 关键字命中：姓名 / 手机 / 微信 / 名下车辆车牌
      // 注意：`mode: "insensitive"` 是 PostgreSQL 特性，SQLite 实现里需要去掉
      // （SQLite 的 LIKE 对 ASCII 本就不区分大小写），已记入阶段 2 的兼容性风险清单。
      const where: Prisma.CustomerWhereInput = { deletedAt: null };
      if (filter.keyword) {
        const q = filter.keyword;
        where.OR = [
          { name: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
          { wechat: { contains: q, mode: "insensitive" } },
          { vehicles: { some: { plateNumber: { contains: q.toUpperCase() } } } },
        ];
      }

      const [rows, total] = await Promise.all([
        client.customer.findMany({
          where,
          select: customerListSelect,
          orderBy: { createdAt: "desc" },
          skip: paging.skip,
          take: paging.take,
        }),
        client.customer.count({ where }),
      ]);
      return { rows, total };
    },

    async findListView(id) {
      return client.customer.findFirst({
        where: { id, deletedAt: null },
        select: customerListSelect,
      });
    },

    async listOptions(limit) {
      return client.customer.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, phone: true },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });
    },

    async findByPhoneWithVehicles(phone) {
      return client.customer.findFirst({
        where: { phone, deletedAt: null },
        select: {
          id: true,
          name: true,
          phone: true,
          vehicles: {
            where: { deletedAt: null },
            select: { id: true, plateNumber: true },
          },
        },
      });
    },

    async aggregateOrderStats(customerIds) {
      if (customerIds.length === 0) return [];

      const grouped = await client.workOrder.groupBy({
        by: ["customerId"],
        where: { customerId: { in: customerIds }, deletedAt: null, status: { not: "CANCELLED" } },
        _sum: { totalAmount: true, paidAmount: true },
        _max: { createdAt: true },
      });

      return grouped.map((row) => ({
        customerId: row.customerId,
        totalAmount: row._sum.totalAmount,
        paidAmount: row._sum.paidAmount,
        lastOrderAt: row._max.createdAt ?? null,
      }));
    },

    async create(data) {
      return client.customer.create({
        data: { name: data.name, phone: data.phone, createdBy: data.createdBy },
        select: { id: true, name: true },
      });
    },

    async findForEdit(id) {
      return client.customer.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, phone: true, wechat: true, address: true, remark: true },
      });
    },

    async update(id, patch) {
      await client.customer.update({
        where: { id },
        data: {
          name: patch.name,
          phone: patch.phone,
          wechat: patch.wechat,
          address: patch.address,
          remark: patch.remark,
        },
      });
    },

    async findForDelete(id) {
      const row = await client.customer.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          name: true,
          phone: true,
          _count: { select: { workOrders: true, vehicles: true } },
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        workOrderCount: row._count.workOrders,
        vehicleCount: row._count.vehicles,
      };
    },

    async softDelete(id) {
      await client.customer.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  };
}

export function createVehicleRepository(client: RepoClient): VehicleRepository {
  return {
    async findIdByPlate(plateNumber) {
      return client.vehicle.findFirst({
        where: { plateNumber, deletedAt: null },
        select: { id: true, customerId: true },
      });
    },

    async list(filter, paging) {
      const where: Prisma.VehicleWhereInput = { deletedAt: null };
      if (filter.customerId) where.customerId = filter.customerId;
      if (filter.dueServiceBefore) {
        where.nextServiceAt = { not: null, lte: filter.dueServiceBefore };
      }
      if (filter.keyword) {
        const q = filter.keyword;
        const upper = q.toUpperCase();
        where.OR = [
          { plateNumber: { contains: upper, mode: "insensitive" } },
          { vin: { contains: upper, mode: "insensitive" } },
          { brand: { contains: q, mode: "insensitive" } },
          { model: { contains: q, mode: "insensitive" } },
          { customer: { name: { contains: q, mode: "insensitive" } } },
          { customer: { phone: { contains: q } } },
        ];
      }

      const [rows, total] = await Promise.all([
        client.vehicle.findMany({
          where,
          select: vehicleListSelect,
          orderBy: { updatedAt: "desc" },
          skip: paging.skip,
          take: paging.take,
        }),
        client.vehicle.count({ where }),
      ]);
      return { rows, total };
    },

    async findDetailBaseById(id) {
      return client.vehicle.findFirst({
        where: { id, deletedAt: null },
        select: { ...vehicleListSelect, engineNo: true, remark: true },
      });
    },

    async findDetailBaseByPlate(plateNumber, excludeId) {
      return client.vehicle.findFirst({
        where: {
          plateNumber,
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { ...vehicleListSelect, engineNo: true, remark: true },
      });
    },

    async create(data) {
      return client.vehicle.create({
        data: {
          customerId: data.customerId,
          plateNumber: data.plateNumber,
          brand: data.brand ?? null,
          model: data.model ?? null,
          year: data.year ?? null,
          vin: data.vin ?? null,
          engineNo: data.engineNo ?? null,
          currentMileage: data.currentMileage ?? null,
          lastServiceAt: data.lastServiceAt ?? null,
          nextServiceAt: data.nextServiceAt ?? null,
          remark: data.remark ?? null,
        },
        select: { id: true, plateNumber: true },
      });
    },

    async reassignToCustomer(id, customerId) {
      await client.vehicle.update({ where: { id }, data: { customerId } });
    },

    async searchForGlobal(keyword, limit) {
      const upper = keyword.toUpperCase();
      const rows = await client.vehicle.findMany({
        where: {
          deletedAt: null,
          OR: [
            { plateNumber: { contains: upper, mode: "insensitive" } },
            { vin: { contains: upper, mode: "insensitive" } },
            { brand: { contains: keyword, mode: "insensitive" } },
            { model: { contains: keyword, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          plateNumber: true,
          brand: true,
          model: true,
          customer: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });
      return rows.map((v) => ({
        id: v.id,
        plateNumber: v.plateNumber,
        brand: v.brand,
        model: v.model,
        customerName: v.customer.name,
      }));
    },

    async suggestByPlate(keyword, limit) {
      // 通配符在 SQLite 侧用 ESCAPE 处理、Prisma 侧无法附加 ESCAPE 子句，
      // 所以两边统一先用 plateMatchKeyword 摘掉通配符（ADR-017）。
      // 注意不能在这里"空关键字直接返回空"：SQLite 侧空关键字是
      // 「匹配全部、只受 limit 约束」，两边必须保持一致。
      const safe = plateMatchKeyword(keyword);

      const rows = await client.vehicle.findMany({
        where: {
          deletedAt: null,
          plateNumber: { contains: safe, mode: "insensitive" },
        },
        select: {
          id: true,
          plateNumber: true,
          brand: true,
          model: true,
          vin: true,
          updatedAt: true,
          customer: { select: { name: true } },
          // 最近一次进厂 = 未删除工单里最新的 createdAt
          workOrders: {
            where: { deletedAt: null },
            select: { createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          _count: { select: { workOrders: { where: { deletedAt: null } } } },
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });

      return rows.map((v): VehicleSuggestionRow => ({
        id: v.id,
        plateNumber: v.plateNumber,
        brand: v.brand,
        model: v.model,
        vin: v.vin,
        customerName: v.customer.name,
        lastVisitAt: v.workOrders[0]?.createdAt ?? null,
        workOrderCount: v._count.workOrders,
        updatedAt: v.updatedAt,
      }));
    },

    async findForEdit(id) {
      return client.vehicle.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, plateNumber: true, customerId: true },
      });
    },

    async update(id, patch) {
      await client.vehicle.update({
        where: { id },
        data: {
          customerId: patch.customerId,
          plateNumber: patch.plateNumber,
          brand: patch.brand,
          model: patch.model,
          year: patch.year,
          vin: patch.vin,
          engineNo: patch.engineNo,
          currentMileage: patch.currentMileage,
          lastServiceAt: patch.lastServiceAt,
          nextServiceAt: patch.nextServiceAt,
          remark: patch.remark,
        },
      });
    },

    async findForDelete(id) {
      const row = await client.vehicle.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, plateNumber: true, _count: { select: { workOrders: true } } },
      });
      if (!row) return null;
      return {
        id: row.id,
        plateNumber: row.plateNumber,
        workOrderCount: row._count.workOrders,
      };
    },

    async softDelete(id) {
      await client.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });
    },

    async listByCustomer(customerId) {
      return client.vehicle.findMany({
        where: { customerId, deletedAt: null },
        select: vehicleListSelect,
        orderBy: { createdAt: "desc" },
      });
    },

    async softDeleteByCustomer(customerId) {
      await client.vehicle.updateMany({
        where: { customerId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    },

    async listServiceRecords(vehicleId, take) {
      return client.vehicleServiceRecord.findMany({
        where: { vehicleId },
        select: {
          id: true,
          vehicleId: true,
          workOrderId: true,
          servicedAt: true,
          mileage: true,
          description: true,
          nextServiceAt: true,
          nextServiceMileage: true,
          createdBy: true,
          createdAt: true,
          workOrder: { select: { orderNo: true } },
        },
        orderBy: { servicedAt: "desc" },
        take,
      });
    },

    async listDueService(before, limit) {
      return client.vehicle.findMany({
        where: { deletedAt: null, nextServiceAt: { not: null, lte: before } },
        select: {
          id: true,
          plateNumber: true,
          nextServiceAt: true,
          currentMileage: true,
          customer: { select: { name: true, phone: true } },
        },
        orderBy: { nextServiceAt: "asc" },
        take: limit,
      });
    },

    async updateServiceInfo(id, patch) {
      await client.vehicle.update({
        where: { id },
        data: {
          ...(patch.currentMileage !== undefined ? { currentMileage: patch.currentMileage } : {}),
          lastServiceAt: patch.lastServiceAt,
          ...(patch.nextServiceAt !== undefined ? { nextServiceAt: patch.nextServiceAt } : {}),
        },
      });
    },

    async createServiceRecord(data) {
      return client.vehicleServiceRecord.create({
        data: {
          vehicleId: data.vehicleId,
          workOrderId: data.workOrderId ?? null,
          servicedAt: data.servicedAt,
          mileage: data.mileage ?? null,
          description: data.description,
          nextServiceAt: data.nextServiceAt ?? null,
          nextServiceMileage: data.nextServiceMileage ?? null,
          createdBy: data.createdBy,
        },
      });
    },

    async detachServiceRecordsFromWorkOrder(workOrderId) {
      await client.vehicleServiceRecord.updateMany({
        where: { workOrderId },
        data: { workOrderId: null },
      });
    },
  };
}
