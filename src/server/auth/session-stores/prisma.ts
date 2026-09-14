import type { PrismaClient } from "@prisma/client";

import type { SessionStore, StoredSession } from "@/server/auth/session-store";

type SessionClient = Pick<PrismaClient, "session">;

export function createPrismaSessionStore(client: SessionClient): SessionStore {
  return {
    async create(input) {
      await client.session.create({
        data: {
          id: input.id,
          userId: input.userId,
          expiresAt: input.expiresAt,
          userAgent: input.userAgent,
          ip: input.ip,
        },
      });
    },

    async findValid(id, now): Promise<StoredSession | null> {
      const session = await client.session.findUnique({
        where: { id },
        select: {
          expiresAt: true,
          user: {
            select: {
              id: true,
              username: true,
              name: true,
              role: true,
              isActive: true,
              deletedAt: true,
            },
          },
        },
      });
      if (!session) return null;
      if (session.expiresAt.getTime() < now.getTime()) {
        await client.session.deleteMany({ where: { id } });
        return null;
      }
      return session;
    },

    async revoke(id) {
      await client.session.deleteMany({ where: { id } });
    },

    async revokeAll(userId) {
      await client.session.deleteMany({ where: { userId } });
    },

    async pruneExpired(now) {
      const result = await client.session.deleteMany({ where: { expiresAt: { lt: now } } });
      return result.count;
    },
  };
}
