import type { Prisma } from "@prisma/client";

import type { FinanceRepository } from "@/domain/repositories";
import { D } from "@/lib/money";
import { expenseSelect, paymentSelect } from "@/server/selects";

import type { RepoClient } from "./client";

/** 财务（收款 / 支出）的 Prisma 实现 */

export function createFinanceRepository(client: RepoClient): FinanceRepository {
  return {
    async voidPaymentsByWorkOrder(workOrderId, reason) {
      const result = await client.payment.updateMany({
        where: { workOrderId, deletedAt: null },
        data: { deletedAt: new Date(), remark: `工单取消失败收款作废：${reason}` },
      });
      return result.count;
    },

    async createPayment(data) {
      return client.payment.create({
        data: {
          workOrderId: data.workOrderId ?? null,
          customerId: data.customerId ?? null,
          source: data.source,
          category: data.category,
          amount: data.amount,
          method: data.method,
          occurredAt: data.occurredAt,
          operatorId: data.operatorId,
          remark: data.remark ?? null,
        },
        select: { id: true },
      });
    },

    async sumPaymentsByWorkOrder(workOrderId) {
      const sum = await client.payment.aggregate({
        where: { workOrderId, deletedAt: null },
        _sum: { amount: true },
      });
      // 无收款行时 Prisma 返回 null，金额归零由金额中枢负责
      return D(sum._sum.amount ?? 0);
    },

    async findPaymentForVoid(id) {
      return client.payment.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, amount: true, workOrderId: true, remark: true },
      });
    },

    async voidPayment(id, remark) {
      await client.payment.update({ where: { id }, data: { deletedAt: new Date(), remark } });
    },

    async listPayments(filter, paging) {
      // 注意：`mode: "insensitive"` 是 PostgreSQL 特性，SQLite 实现需去掉。
      const where: Prisma.PaymentWhereInput = {
        deletedAt: null,
        occurredAt: { gte: filter.from, lte: filter.to },
      };
      if (filter.keyword) {
        where.OR = [
          { workOrder: { orderNo: { contains: filter.keyword, mode: "insensitive" } } },
          { customer: { name: { contains: filter.keyword, mode: "insensitive" } } },
          { remark: { contains: filter.keyword, mode: "insensitive" } },
        ];
      }

      const [rows, total] = await Promise.all([
        client.payment.findMany({
          where,
          select: paymentSelect,
          orderBy: { occurredAt: "desc" },
          skip: paging.skip,
          take: paging.take,
        }),
        client.payment.count({ where }),
      ]);
      return { rows, total };
    },

    async groupPaymentsByCategory(from, to) {
      const groups = await client.payment.groupBy({
        by: ["category"],
        where: { deletedAt: null, occurredAt: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      });
      return groups.map((g) => ({ category: g.category, amount: g._sum.amount, count: g._count }));
    },

    async groupPaymentsByMethod(from, to) {
      const groups = await client.payment.groupBy({
        by: ["method"],
        where: { deletedAt: null, occurredAt: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      });
      return groups.map((g) => ({ method: g.method, amount: g._sum.amount, count: g._count }));
    },

    async createExpense(data) {
      return client.expense.create({
        data: {
          category: data.category,
          amount: data.amount,
          method: data.method,
          occurredAt: data.occurredAt,
          supplierId: data.supplierId ?? null,
          workOrderId: data.workOrderId ?? null,
          operatorId: data.operatorId,
          remark: data.remark ?? null,
        },
        select: { id: true },
      });
    },

    async findExpenseForEdit(id) {
      return client.expense.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          category: true,
          amount: true,
          method: true,
          occurredAt: true,
          remark: true,
        },
      });
    },

    async updateExpense(id, patch) {
      await client.expense.update({
        where: { id },
        data: {
          category: patch.category,
          amount: patch.amount,
          method: patch.method,
          occurredAt: patch.occurredAt,
          supplierId: patch.supplierId,
          workOrderId: patch.workOrderId,
          remark: patch.remark,
        },
      });
    },

    async findExpenseForDelete(id) {
      return client.expense.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, category: true, amount: true, remark: true },
      });
    },

    async softDeleteExpense(id) {
      await client.expense.update({ where: { id }, data: { deletedAt: new Date() } });
    },

    async listExpenses(filter, paging) {
      const where: Prisma.ExpenseWhereInput = {
        deletedAt: null,
        occurredAt: { gte: filter.from, lte: filter.to },
      };
      if (filter.keyword) {
        where.OR = [
          { remark: { contains: filter.keyword, mode: "insensitive" } },
          { supplier: { name: { contains: filter.keyword, mode: "insensitive" } } },
        ];
      }

      const [rows, total] = await Promise.all([
        client.expense.findMany({
          where,
          select: expenseSelect,
          orderBy: { occurredAt: "desc" },
          skip: paging.skip,
          take: paging.take,
        }),
        client.expense.count({ where }),
      ]);
      return { rows, total };
    },

    async sumPaymentsInRange(from, to) {
      const sum = await client.payment.aggregate({
        where: { deletedAt: null, occurredAt: { gte: from, lte: to } },
        _sum: { amount: true },
      });
      return D(sum._sum.amount ?? 0);
    },

    async sumExpensesInRange(from, to) {
      const sum = await client.expense.aggregate({
        where: { deletedAt: null, occurredAt: { gte: from, lte: to } },
        _sum: { amount: true },
      });
      return D(sum._sum.amount ?? 0);
    },

    async listPaymentEntries(from, to) {
      return client.payment.findMany({
        where: { deletedAt: null, occurredAt: { gte: from, lte: to } },
        select: { amount: true, occurredAt: true },
      });
    },

    async listExpenseEntries(from, to) {
      return client.expense.findMany({
        where: { deletedAt: null, occurredAt: { gte: from, lte: to } },
        select: { amount: true, occurredAt: true },
      });
    },

    async groupExpensesByCategory(from, to) {
      const groups = await client.expense.groupBy({
        by: ["category"],
        where: { deletedAt: null, occurredAt: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      });
      return groups.map((g) => ({ category: g.category, amount: g._sum.amount, count: g._count }));
    },
  };
}
