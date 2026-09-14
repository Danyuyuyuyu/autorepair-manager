import type { Prisma } from "@prisma/client";

import type { CatalogRepository, PartRepository } from "@/domain/repositories";
import { partListSelect } from "@/server/selects";

import type { RepoClient } from "./client";

/** 配件档案的 Prisma 实现 */

export function createPartRepository(client: RepoClient): PartRepository {
  return {
    async findSnapshot(partId) {
      const part = await client.part.findFirst({
        where: { id: partId, deletedAt: null },
        select: {
          name: true,
          spec: true,
          unit: true,
          costPrice: true,
          inventory: { select: { avgCost: true } },
        },
      });
      if (!part) return null;
      return {
        name: part.name,
        spec: part.spec,
        unit: part.unit,
        costPrice: part.costPrice,
        avgCost: part.inventory?.avgCost ?? null,
      };
    },

    async findUnitCost(partId) {
      const part = await client.part.findFirst({
        where: { id: partId, deletedAt: null },
        select: { costPrice: true, inventory: { select: { avgCost: true } } },
      });
      if (!part) return null;
      return { costPrice: part.costPrice, avgCost: part.inventory?.avgCost ?? null };
    },

    async findBrief(id) {
      return client.part.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true },
      });
    },

    async findStockLevel(id) {
      const part = await client.part.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, inventory: { select: { quantity: true } } },
      });
      if (!part) return null;
      return { id: part.id, name: part.name, quantity: part.inventory?.quantity ?? null };
    },

    async listStockLevels(ids) {
      const rows = await client.part.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, name: true, inventory: { select: { quantity: true } } },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        quantity: row.inventory?.quantity ?? null,
      }));
    },

    async list(filter, paging) {
      // 注意：`mode: "insensitive"` 是 PostgreSQL 特性，SQLite 实现需去掉。
      const where: Prisma.PartWhereInput = { deletedAt: null };
      if (!filter.includeInactive) where.isActive = true;
      if (filter.categoryId) where.categoryId = filter.categoryId;
      if (filter.keyword) {
        const q = filter.keyword;
        where.OR = [
          { name: { contains: q, mode: "insensitive" } },
          { spec: { contains: q, mode: "insensitive" } },
          { brand: { contains: q, mode: "insensitive" } },
          { code: { contains: q, mode: "insensitive" } },
        ];
      }
      if (filter.zeroStockOnly) {
        where.inventory = { quantity: { lte: 0 } };
      } else if (filter.hasInventoryRowOnly) {
        where.inventory = { isNot: null };
      }

      const [rows, total] = await Promise.all([
        client.part.findMany({
          where,
          select: partListSelect,
          orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
          skip: paging.skip,
          take: paging.take,
        }),
        client.part.count({ where }),
      ]);
      return { rows, total };
    },

    async listLowStockCandidates() {
      return client.part.findMany({
        where: { deletedAt: null, isActive: true, inventory: { isNot: null } },
        select: partListSelect,
        orderBy: { name: "asc" },
      });
    },

    async findDetail(id) {
      return client.part.findFirst({
        where: { id, deletedAt: null },
        select: {
          ...partListSelect,
          supplierId: true,
          remark: true,
          supplier: { select: { name: true } },
          inventory: {
            select: { quantity: true, safeQuantity: true, avgCost: true, location: true },
          },
        },
      });
    },

    async findForEdit(id) {
      const part = await client.part.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          code: true,
          name: true,
          spec: true,
          brand: true,
          unit: true,
          categoryId: true,
          supplierId: true,
          remark: true,
          inventory: { select: { safeQuantity: true, location: true } },
        },
      });
      if (!part) return null;
      return {
        id: part.id,
        code: part.code,
        name: part.name,
        spec: part.spec,
        brand: part.brand,
        unit: part.unit,
        categoryId: part.categoryId,
        supplierId: part.supplierId,
        remark: part.remark,
        safeQuantity: part.inventory?.safeQuantity ?? null,
        location: part.inventory?.location ?? null,
      };
    },

    async createWithInventory(data, inventory) {
      const part = await client.part.create({
        data: {
          code: data.code,
          name: data.name,
          spec: data.spec,
          brand: data.brand,
          unit: data.unit,
          categoryId: data.categoryId,
          supplierId: data.supplierId,
          costPrice: data.costPrice,
          salePrice: data.salePrice,
          remark: data.remark,
        },
        select: { id: true, name: true },
      });

      // 库存行从 0 开始；期初数量通过统一入口写入，保证流水完整可对账
      await client.inventory.create({
        data: {
          partId: part.id,
          quantity: 0,
          safeQuantity: inventory.safeQuantity,
          avgCost: data.costPrice,
          location: inventory.location,
        },
      });

      return part;
    },

    async updateWithInventory(id, data, inventory) {
      await client.part.update({
        where: { id },
        data: {
          code: data.code,
          name: data.name,
          spec: data.spec,
          brand: data.brand,
          unit: data.unit,
          categoryId: data.categoryId,
          supplierId: data.supplierId,
          costPrice: data.costPrice,
          salePrice: data.salePrice,
          remark: data.remark,
        },
      });

      await client.inventory.update({
        where: { partId: id },
        data: { safeQuantity: inventory.safeQuantity, location: inventory.location },
      });
    },

    async findForDelete(id) {
      const part = await client.part.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, inventory: { select: { quantity: true } } },
      });
      if (!part) return null;
      return { id: part.id, name: part.name, quantity: part.inventory?.quantity ?? null };
    },

    async softDelete(id) {
      await client.part.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
    },

    async updateCostAndSupplier(id, patch) {
      await client.part.update({
        where: { id },
        data: {
          costPrice: patch.costPrice,
          supplierId: patch.supplierId === null ? null : (patch.supplierId ?? undefined),
        },
      });
    },

    async searchForPicker(keyword, limit) {
      const rows = await client.part.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          ...(keyword
            ? {
                OR: [
                  { name: { contains: keyword, mode: "insensitive" } },
                  { spec: { contains: keyword, mode: "insensitive" } },
                  { code: { contains: keyword, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          spec: true,
          unit: true,
          salePrice: true,
          inventory: { select: { quantity: true, avgCost: true } },
        },
        orderBy: { name: "asc" },
        take: limit,
      });

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        spec: row.spec,
        unit: row.unit,
        salePrice: row.salePrice,
        avgCost: row.inventory?.avgCost ?? null,
        stockQuantity: row.inventory?.quantity ?? null,
      }));
    },

    async countActive() {
      return client.part.count({ where: { deletedAt: null, isActive: true } });
    },

    async searchForGlobal(keyword, limit) {
      const rows = await client.part.findMany({
        where: {
          deletedAt: null,
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { spec: { contains: keyword, mode: "insensitive" } },
            { code: { contains: keyword, mode: "insensitive" } },
            { brand: { contains: keyword, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          name: true,
          spec: true,
          inventory: { select: { quantity: true, safeQuantity: true } },
        },
        orderBy: { name: "asc" },
        take: limit,
      });
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        spec: p.spec,
        quantity: p.inventory?.quantity ?? null,
        safeQuantity: p.inventory?.safeQuantity ?? null,
      }));
    },
  };
}

/** 基础资料（分类 / 供应商 / 维修项目）的 Prisma 实现 */
export function createCatalogRepository(client: RepoClient): CatalogRepository {
  return {
    async findServiceItemCost(id) {
      const service = await client.serviceItem.findFirst({
        where: { id, deletedAt: null },
        select: { costPrice: true },
      });
      return service?.costPrice ?? null;
    },

    async listServiceItems(params) {
      const where: Prisma.ServiceItemWhereInput = { deletedAt: null, isActive: true };
      if (params.kind) where.kind = params.kind;
      if (params.keyword) {
        where.OR = [
          { name: { contains: params.keyword, mode: "insensitive" } },
          { code: { contains: params.keyword, mode: "insensitive" } },
        ];
      }

      const rows = await client.serviceItem.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        take: params.limit,
        select: {
          id: true,
          code: true,
          name: true,
          kind: true,
          unit: true,
          defaultPrice: true,
          costPrice: true,
          category: { select: { name: true } },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        kind: row.kind === "LABOR" ? ("LABOR" as const) : ("SERVICE" as const),
        unit: row.unit,
        defaultPrice: row.defaultPrice,
        costPrice: row.costPrice,
        categoryName: row.category?.name ?? null,
      }));
    },

    async createServiceItem(data) {
      return client.serviceItem.create({
        data: {
          code: data.code,
          name: data.name,
          kind: data.kind,
          categoryId: data.categoryId,
          unit: data.unit,
          defaultPrice: data.defaultPrice,
          defaultHours: data.defaultHours,
          costPrice: data.costPrice,
          sortOrder: data.sortOrder,
          remark: data.remark,
          isActive: true,
        },
        select: { id: true, name: true },
      });
    },

    async listCategories(kind) {
      return client.category.findMany({
        where: { isActive: true, ...(kind ? { kind } : {}) },
        orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, kind: true, sortOrder: true },
      });
    },

    async findCategoryByName(kind, name) {
      return client.category.findFirst({ where: { kind, name }, select: { id: true } });
    },

    async createCategory(data) {
      return client.category.create({
        data: { name: data.name, kind: data.kind, sortOrder: data.sortOrder },
        select: { id: true, name: true, kind: true, sortOrder: true },
      });
    },

    async listSuppliers() {
      return client.supplier.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, contact: true, phone: true },
      });
    },

    async createSupplier(data) {
      return client.supplier.create({
        data: {
          name: data.name,
          contact: data.contact,
          phone: data.phone,
          address: data.address,
          remark: data.remark,
        },
        select: { id: true, name: true },
      });
    },
  };
}
