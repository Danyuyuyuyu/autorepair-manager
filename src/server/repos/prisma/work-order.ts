import type { Prisma } from "@prisma/client";

import type {
  WorkOrderRepository,
  WorkOrderItemRepository,
  WorkOrderListFilter,
  WorkOrderCreateData,
} from "@/domain/repositories";
import { workOrderDetailSelect, workOrderListSelect } from "@/server/selects";

import type { RepoClient } from "./client";

/**
 * 工单 / 工单项的 Prisma 实现。
 * 这里是唯一允许出现 Prisma 查询语法的地方 —— 业务层只看到领域参数与领域行。
 */

/** 列表查询条件 -> Prisma where（后端特有语法集中在此） */
function buildListWhere(filter: WorkOrderListFilter): Prisma.WorkOrderWhereInput {
  const { keyword, status = "ALL", customerId, vehicleId, restrictToCreatorId } = filter;
  const where: Prisma.WorkOrderWhereInput = { deletedAt: null };

  if (status === "UNPAID") {
    where.status = { in: ["PENDING_PAYMENT", "IN_PROGRESS", "PENDING_QC", "PENDING_INTAKE"] };
  } else if (status !== "ALL") {
    where.status = status;
  }

  if (customerId) where.customerId = customerId;
  if (vehicleId) where.vehicleId = vehicleId;
  if (restrictToCreatorId) where.createdBy = restrictToCreatorId;

  if (keyword) {
    where.OR = [
      { orderNo: { contains: keyword, mode: "insensitive" } },
      { customer: { name: { contains: keyword, mode: "insensitive" } } },
      { customer: { phone: { contains: keyword } } },
      { vehicle: { plateNumber: { contains: keyword.toUpperCase(), mode: "insensitive" } } },
    ];
  }

  return where;
}

export function createWorkOrderRepository(client: RepoClient): WorkOrderRepository {
  return {
    async findLatestOrderNo(prefix) {
      const last = await client.workOrder.findFirst({
        where: { orderNo: { startsWith: prefix } },
        orderBy: { orderNo: "desc" },
        select: { orderNo: true },
      });
      return last?.orderNo ?? null;
    },

    async list(filter, paging) {
      const where = buildListWhere(filter);
      const [rows, total] = await Promise.all([
        client.workOrder.findMany({
          where,
          select: workOrderListSelect,
          orderBy: { createdAt: "desc" },
          skip: paging.skip,
          take: paging.take,
        }),
        client.workOrder.count({ where }),
      ]);
      return { rows, total };
    },

    async listRecentByCustomer(customerId, take) {
      return client.workOrder.findMany({
        where: { customerId, deletedAt: null },
        select: workOrderListSelect,
        orderBy: { createdAt: "desc" },
        take,
      });
    },

    async listRecentByVehicle(vehicleId, take) {
      return client.workOrder.findMany({
        where: { vehicleId, deletedAt: null },
        select: workOrderListSelect,
        orderBy: { createdAt: "desc" },
        take,
      });
    },

    async listBriefByVehicle(vehicleId, take) {
      return client.workOrder.findMany({
        where: { vehicleId, deletedAt: null },
        select: { id: true, orderNo: true, createdAt: true, mileage: true, totalAmount: true },
        orderBy: { createdAt: "desc" },
        take,
      });
    },

    async listUnsettled(take) {
      return client.workOrder.findMany({
        where: { deletedAt: null, status: { not: "CANCELLED" } },
        select: {
          id: true,
          orderNo: true,
          status: true,
          totalAmount: true,
          paidAmount: true,
          createdAt: true,
          customer: { select: { id: true, name: true, phone: true } },
          vehicle: { select: { plateNumber: true } },
        },
        orderBy: { createdAt: "asc" },
        take,
      });
    },

    async findDetailById(id) {
      return client.workOrder.findFirst({
        where: { id, deletedAt: null },
        select: workOrderDetailSelect,
      });
    },

    async findForMutation(id) {
      return client.workOrder.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          orderNo: true,
          status: true,
          createdBy: true,
          customerId: true,
          vehicleId: true,
          discountAmount: true,
          totalAmount: true,
          paidAmount: true,
          mileage: true,
          vehicle: { select: { plateNumber: true } },
          customer: { select: { name: true } },
        },
      });
    },

    async findTotalsSource(id) {
      return client.workOrder.findUnique({
        where: { id },
        select: {
          discountAmount: true,
          items: { select: { type: true, quantity: true, unitPrice: true, costPrice: true } },
        },
      });
    },

    async create(data: WorkOrderCreateData) {
      return client.workOrder.create({
        data: {
          orderNo: data.orderNo,
          status: "PENDING_INTAKE",
          customerId: data.customerId,
          vehicleId: data.vehicleId,
          mileage: data.mileage ?? null,
          faultDescription: data.faultDescription ?? null,
          remark: data.remark ?? null,
          technicianId: data.technicianId ?? null,
          createdBy: data.createdBy,
          discountAmount: data.discountAmount,
        },
      });
    },

    async updateInfo(id, patch) {
      await client.workOrder.update({
        where: { id },
        data: {
          mileage: patch.mileage ?? null,
          faultDescription: patch.faultDescription || null,
          remark: patch.remark || null,
          technicianId: patch.technicianId || null,
          ...(patch.discountAmount !== undefined ? { discountAmount: patch.discountAmount } : {}),
        },
      });
    },

    async applyTotals(id, totals) {
      await client.workOrder.update({
        where: { id },
        data: {
          serviceAmount: totals.serviceAmount,
          partsAmount: totals.partsAmount,
          laborAmount: totals.laborAmount,
          otherAmount: totals.otherAmount,
          discountAmount: totals.discountAmount,
          totalAmount: totals.totalAmount,
          partsCost: totals.partsCost,
        },
      });
    },

    async changeStatus(id, patch) {
      await client.workOrder.update({
        where: { id },
        data: {
          status: patch.status,
          ...(patch.mileage !== undefined ? { mileage: patch.mileage } : {}),
          ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
          ...(patch.cancelledAt !== undefined ? { cancelledAt: patch.cancelledAt } : {}),
          ...(patch.cancelReason !== undefined ? { cancelReason: patch.cancelReason } : {}),
        },
      });
    },

    async setPaidAmount(id, paidAmount) {
      await client.workOrder.update({ where: { id }, data: { paidAmount } });
    },

    async findTotalAmount(id) {
      const row = await client.workOrder.findUnique({
        where: { id },
        select: { totalAmount: true },
      });
      return row?.totalAmount ?? null;
    },

    async findForPayment(id) {
      return client.workOrder.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, orderNo: true, status: true, totalAmount: true, customerId: true },
      });
    },

    async findBalance(id) {
      const row = await client.workOrder.findFirst({
        where: { id, deletedAt: null },
        select: { totalAmount: true, paidAmount: true },
      });
      if (!row) return null;
      return { totalAmount: row.totalAmount, paidAmount: row.paidAmount };
    },

    async listOpenOrderBalances() {
      return client.workOrder.findMany({
        where: { deletedAt: null, status: { not: "CANCELLED" } },
        select: { status: true, totalAmount: true, paidAmount: true, customerId: true },
      });
    },

    async countCreatedBetween(from, to, options) {
      return client.workOrder.count({
        where: {
          deletedAt: null,
          createdAt: { gte: from, lte: to },
          ...(options?.excludeCancelled ? { status: { not: "CANCELLED" } } : {}),
        },
      });
    },

    async listCreatedDates(from, to) {
      return client.workOrder.findMany({
        where: { deletedAt: null, status: { not: "CANCELLED" }, createdAt: { gte: from, lte: to } },
        select: { createdAt: true },
      });
    },

    async findCompletedBetween(from, to) {
      const result = await client.workOrder.aggregate({
        where: { deletedAt: null, status: "COMPLETED", completedAt: { gte: from, lte: to } },
        _sum: { totalAmount: true, partsCost: true },
        _count: true,
      });
      return {
        count: result._count,
        totalAmount: result._sum.totalAmount,
        partsCost: result._sum.partsCost,
      };
    },

    async listCreatedBetween(from, to) {
      return client.workOrder.findMany({
        where: { deletedAt: null, createdAt: { gte: from, lte: to } },
        select: { status: true },
      });
    },

    async listRecent(take) {
      return client.workOrder.findMany({
        where: { deletedAt: null },
        select: workOrderListSelect,
        orderBy: { createdAt: "desc" },
        take,
      });
    },

    async searchForGlobal(keyword, limit) {
      const upper = keyword.toUpperCase();
      const rows = await client.workOrder.findMany({
        where: {
          deletedAt: null,
          OR: [
            { orderNo: { contains: upper, mode: "insensitive" } },
            { vehicle: { plateNumber: { contains: upper, mode: "insensitive" } } },
            { customer: { name: { contains: keyword, mode: "insensitive" } } },
            { customer: { phone: { contains: keyword } } },
          ],
        },
        select: {
          id: true,
          orderNo: true,
          status: true,
          totalAmount: true,
          vehicle: { select: { plateNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows.map((w) => ({
        id: w.id,
        orderNo: w.orderNo,
        status: w.status,
        totalAmount: w.totalAmount,
        plateNumber: w.vehicle.plateNumber,
      }));
    },

    async listTouchedBetween(from, to, take) {
      return client.workOrder.findMany({
        where: {
          deletedAt: null,
          OR: [{ createdAt: { gte: from, lte: to } }, { updatedAt: { gte: from, lte: to } }],
        },
        select: workOrderListSelect,
        orderBy: { updatedAt: "desc" },
        take,
      });
    },

    async aggregateCreatedOrders(from, to) {
      const result = await client.workOrder.aggregate({
        where: { deletedAt: null, status: { not: "CANCELLED" }, createdAt: { gte: from, lte: to } },
        _count: true,
        _sum: { partsCost: true },
      });
      return { orderCount: result._count, partsCost: result._sum.partsCost };
    },

    async findSnapshot(id) {
      return client.workOrder.findUnique({
        where: { id },
        select: {
          orderNo: true,
          status: true,
          totalAmount: true,
          customer: { select: { name: true } },
          vehicle: { select: { plateNumber: true } },
        },
      });
    },

    async hardDelete(id) {
      await client.workOrder.delete({ where: { id } });
    },
  };
}

export function createWorkOrderItemRepository(client: RepoClient): WorkOrderItemRepository {
  return {
    async create(data) {
      return client.workOrderItem.create({
        data: {
          workOrderId: data.workOrderId,
          type: data.type,
          itemRefId: data.itemRefId ?? null,
          name: data.name,
          spec: data.spec ?? null,
          unit: data.unit ?? null,
          quantity: data.quantity,
          unitPrice: data.unitPrice,
          costPrice: data.costPrice,
          amount: data.amount,
          remark: data.remark ?? null,
          sortOrder: data.sortOrder,
        },
      });
    },

    async findByIdWithOrder(id) {
      return client.workOrderItem.findUnique({
        where: { id },
        select: {
          id: true,
          workOrderId: true,
          type: true,
          itemRefId: true,
          name: true,
          quantity: true,
          unitPrice: true,
          amount: true,
          workOrder: {
            select: { id: true, orderNo: true, createdBy: true, status: true },
          },
        },
      });
    },

    async update(id, patch) {
      await client.workOrderItem.update({
        where: { id },
        data: {
          ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
          ...(patch.unitPrice !== undefined ? { unitPrice: patch.unitPrice } : {}),
          ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
          ...(patch.remark !== undefined ? { remark: patch.remark || null } : {}),
        },
      });
    },

    async hardDelete(id) {
      await client.workOrderItem.delete({ where: { id } });
    },

    async countByOrder(workOrderId) {
      return client.workOrderItem.count({ where: { workOrderId } });
    },

    async listPartItems(workOrderId) {
      return client.workOrderItem.findMany({
        where: { workOrderId, type: "PART" },
        select: { id: true, itemRefId: true, name: true, quantity: true },
      });
    },

    async listVehicleItemHistory(vehicleId) {
      return client.workOrderItem.findMany({
        where: {
          workOrder: { vehicleId, deletedAt: null, status: { not: "CANCELLED" } },
        },
        select: { type: true, name: true, quantity: true, amount: true },
      });
    },

    async sumAmountByType(from, to) {
      const groups = await client.workOrderItem.groupBy({
        by: ["type"],
        where: {
          workOrder: {
            deletedAt: null,
            status: { not: "CANCELLED" },
            createdAt: { gte: from, lte: to },
          },
        },
        _sum: { amount: true },
      });
      return groups.map((g) => ({ type: g.type, amount: g._sum.amount }));
    },

    async groupByName(type, from, to, limit) {
      const rows = await client.workOrderItem.groupBy({
        by: ["name"],
        where: {
          type,
          workOrder: {
            deletedAt: null,
            status: { not: "CANCELLED" },
            createdAt: { gte: from, lte: to },
          },
        },
        _sum: { quantity: true, amount: true },
        _count: true,
        orderBy: { _sum: { amount: "desc" } },
        take: limit,
      });
      return rows.map((row) => ({
        name: row.name,
        quantity: row._sum.quantity,
        amount: row._sum.amount,
        count: row._count,
      }));
    },

    async aggregatePartSales(partId) {
      const result = await client.workOrderItem.aggregate({
        where: {
          type: "PART",
          itemRefId: partId,
          workOrder: { deletedAt: null, status: { not: "CANCELLED" } },
        },
        _sum: { quantity: true, amount: true },
        _count: true,
      });
      return {
        totalQuantity: result._sum.quantity,
        totalAmount: result._sum.amount,
        orderCount: result._count,
      };
    },
  };
}
