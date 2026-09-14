import type { AuditLog } from "@/domain/entities";
import type { AuditRepository } from "@/domain/repositories";

import type { Prisma } from "@prisma/client";

import type { RepoClient } from "./client";

export function createAuditRepository(client: RepoClient): AuditRepository {
  return {
    async append(data) {
      await client.auditLog.create({
        data: {
          userId: data.userId,
          userName: data.userName,
          action: data.action,
          entity: data.entity,
          entityId: data.entityId,
          summary: data.summary ?? null,
          before: data.before === undefined ? undefined : JSON.parse(JSON.stringify(data.before)),
          after: data.after === undefined ? undefined : JSON.parse(JSON.stringify(data.after)),
          ip: data.ip ?? null,
          userAgent: data.userAgent ?? null,
        },
      });
    },

    async list(filter, paging) {
      const where: Prisma.AuditLogWhereInput = {
        ...(filter.userId !== undefined ? { userId: filter.userId } : {}),
        ...(filter.action !== undefined ? { action: filter.action } : {}),
        ...(filter.entity !== undefined ? { entity: filter.entity } : {}),
        ...(filter.entityId !== undefined ? { entityId: filter.entityId } : {}),
        ...(filter.from !== undefined || filter.to !== undefined
          ? {
              createdAt: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lte: filter.to } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        client.auditLog.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: paging.skip,
          take: paging.take,
        }),
        client.auditLog.count({ where }),
      ]);
      return {
        rows: rows.map((row): AuditLog => ({
          id: row.id,
          userId: row.userId,
          userName: row.userName,
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          summary: row.summary,
          before: row.before,
          after: row.after,
          ip: row.ip,
          userAgent: row.userAgent,
          createdAt: row.createdAt,
        })),
        total,
      };
    },

    async findById(id) {
      const row = await client.auditLog.findUnique({ where: { id } });
      if (!row) return null;
      return {
        id: row.id,
        userId: row.userId,
        userName: row.userName,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        summary: row.summary,
        before: row.before,
        after: row.after,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
      };
    },
  };
}
