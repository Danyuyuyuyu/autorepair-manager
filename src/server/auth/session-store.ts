import type { Role } from "@/domain/enums";

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  isActive: boolean;
  deletedAt: Date | null;
}

export interface StoredSession {
  expiresAt: Date;
  user: SessionUser;
}

export interface SessionCreateInput {
  id: string;
  userId: string;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
}

/** Session 是认证基础设施，不属于业务 Repository 契约。 */
export interface SessionStore {
  create(input: SessionCreateInput): Promise<void>;
  findValid(id: string, now: Date): Promise<StoredSession | null>;
  revoke(id: string): Promise<void>;
  revokeAll(userId: string): Promise<void>;
  pruneExpired(now: Date): Promise<number>;
}
