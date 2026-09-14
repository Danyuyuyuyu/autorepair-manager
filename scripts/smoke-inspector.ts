/**
 * 冒烟测试的「数据库检查器」—— 共享 smoke 的存储专属部分
 * ---------------------------------------------------------------------------
 * scripts/smoke-test.ts 的 135 条断言全部走 service 层（本来就与存储无关），
 * 但它还需要少量**直接看库**的交叉核对（库存到底有没有扣、车辆有没有级联软删、
 * 残留账号有没有清掉……）。这些访问此前直连 Prisma，只能在 PostgreSQL 上跑。
 *
 * 本模块把「直接看库」收敛成一组小小的检查器接口，两套实现：
 *   - createPrismaSmokeInspector → PostgreSQL（行为与改造前逐字一致）
 *   - createSqliteSmokeInspector → SQLite（node:sqlite 直查，snake_case 列）
 * 返回值统一成领域友好形状（Decimal / Date / boolean），因此 smoke 的断言
 * 一个字都不用改，也就不会在改造中悄悄放松验收标准。
 *
 * 这就是「shared smoke → postgres / sqlite，数据库特有基础设施单独放」里的
 * 那一层基础设施。
 */
import type { PrismaClient } from "@prisma/client";
import type { DatabaseSync } from "node:sqlite";

import type { Role } from "@/domain/enums";
import { D } from "@/lib/money";
import type { Decimal } from "decimal.js";
import { createPrismaSessionStore } from "@/server/auth/session-stores/prisma";
import { createSqliteSessionStore } from "@/server/auth/session-stores/sqlite";
import { storageKind } from "@/server/context";
import { newId } from "@/server/repos/sqlite/id";

export interface SmokeInspector {
  readonly kind: string;

  findAdmin(): Promise<{ id: string; username: string; name: string; role: Role }>;
  /** 基线配件（名称含「机油滤清器」）：建单要卖它 */
  findBaselinePart(): Promise<{ id: string; name: string; salePrice: Decimal; quantity: Decimal }>;
  /** 基线维修项目（kind = SERVICE） */
  findBaselineServiceItem(): Promise<{ id: string; name: string; defaultPrice: Decimal }>;
  /** 某配件的库存行（不存在则抛错，等价 findUniqueOrThrow） */
  inventoryOf(
    partId: string,
  ): Promise<{ quantity: Decimal; safeQuantity: Decimal; avgCost: Decimal }>;
  /** 车辆完工回写结果 + 保养记录条数 */
  vehicleSummary(id: string): Promise<{
    currentMileage: number | null;
    lastServiceAt: Date | null;
    serviceRecordCount: number;
  }>;
  /** 是否已存在包含关键字备注的支出（采购入库自动记账） */
  expenseExistsByRemark(keyword: string): Promise<boolean>;
  /** 幂等清理：按手机号软删除历史遗留客户 */
  softDeleteCustomerByPhone(phone: string): Promise<number>;
  /** 直接建车（测试夹具，只填外键与车牌） */
  createVehicle(data: { customerId: string; plateNumber: string }): Promise<{ id: string }>;
  findActiveCustomerByPhone(phone: string): Promise<{ id: string; name: string }>;
  findAnyActiveCustomer(): Promise<{ id: string; name: string }>;
  /** 车辆的 deletedAt（未软删 → null） */
  vehicleDeletedAt(id: string): Promise<Date | null>;
  softDeleteVehicleByPlate(plateNumber: string): Promise<number>;
  softDeletePartByCode(code: string): Promise<number>;
  partFlags(id: string): Promise<{ deletedAt: Date | null; isActive: boolean } | null>;
  findUserByUsername(username: string): Promise<{ id: string } | null>;
  deleteSessionsForUser(userId: string): Promise<void>;
  hardDeleteUser(id: string): Promise<void>;
  /** 未取消且未删除工单的应收 / 已收（首页最大欠款交叉核对） */
  openOrderBalances(): Promise<Array<{ totalAmount: Decimal; paidAmount: Decimal }>>;
  dispose(): Promise<void>;
}

function decimal(value: unknown): Decimal {
  return D(String(value ?? "0"));
}

// ---------------------------------------------------------------------------
// PostgreSQL 实现（与改造前的 Prisma 调用逐字对应）
// ---------------------------------------------------------------------------

export function createPrismaSmokeInspector(prisma: PrismaClient): SmokeInspector {
  const sessions = createPrismaSessionStore(prisma);
  return {
    kind: "prisma-postgresql",

    async findAdmin() {
      return prisma.user.findFirstOrThrow({
        where: { role: "ADMIN", deletedAt: null },
        select: { id: true, username: true, name: true, role: true },
      });
    },

    async findBaselinePart() {
      const row = await prisma.part.findFirstOrThrow({
        where: { deletedAt: null, name: { contains: "机油滤清器" } },
        select: {
          id: true,
          name: true,
          salePrice: true,
          inventory: { select: { quantity: true } },
        },
      });
      return {
        id: row.id,
        name: row.name,
        salePrice: decimal(row.salePrice),
        quantity: decimal(row.inventory?.quantity ?? 0),
      };
    },

    async findBaselineServiceItem() {
      const row = await prisma.serviceItem.findFirstOrThrow({
        where: { deletedAt: null, kind: "SERVICE" },
        select: { id: true, name: true, defaultPrice: true },
      });
      return { id: row.id, name: row.name, defaultPrice: decimal(row.defaultPrice) };
    },

    async inventoryOf(partId) {
      const row = await prisma.inventory.findUniqueOrThrow({
        where: { partId },
        select: { quantity: true, safeQuantity: true, avgCost: true },
      });
      return {
        quantity: decimal(row.quantity),
        safeQuantity: decimal(row.safeQuantity),
        avgCost: decimal(row.avgCost),
      };
    },

    async vehicleSummary(id) {
      const row = await prisma.vehicle.findUniqueOrThrow({
        where: { id },
        select: {
          currentMileage: true,
          lastServiceAt: true,
          _count: { select: { serviceRecords: true } },
        },
      });
      return {
        currentMileage: row.currentMileage,
        lastServiceAt: row.lastServiceAt,
        serviceRecordCount: row._count.serviceRecords,
      };
    },

    async expenseExistsByRemark(keyword) {
      const row = await prisma.expense.findFirst({ where: { remark: { contains: keyword } } });
      return row !== null;
    },

    async softDeleteCustomerByPhone(phone) {
      const result = await prisma.customer.updateMany({
        where: { phone },
        data: { deletedAt: new Date() },
      });
      return result.count;
    },

    async createVehicle(data) {
      const row = await prisma.vehicle.create({
        data: { customerId: data.customerId, plateNumber: data.plateNumber },
        select: { id: true },
      });
      return { id: row.id };
    },

    async findActiveCustomerByPhone(phone) {
      return prisma.customer.findFirstOrThrow({
        where: { phone, deletedAt: null },
        select: { id: true, name: true },
      });
    },

    async findAnyActiveCustomer() {
      return prisma.customer.findFirstOrThrow({
        where: { deletedAt: null },
        select: { id: true, name: true },
      });
    },

    async vehicleDeletedAt(id) {
      const row = await prisma.vehicle.findUnique({ where: { id }, select: { deletedAt: true } });
      return row?.deletedAt ?? null;
    },

    async softDeleteVehicleByPlate(plateNumber) {
      const result = await prisma.vehicle.updateMany({
        where: { plateNumber },
        data: { deletedAt: new Date() },
      });
      return result.count;
    },

    async softDeletePartByCode(code) {
      const result = await prisma.part.updateMany({
        where: { code },
        data: { deletedAt: new Date(), isActive: false },
      });
      return result.count;
    },

    async partFlags(id) {
      return prisma.part.findUnique({
        where: { id },
        select: { deletedAt: true, isActive: true },
      });
    },

    async findUserByUsername(username) {
      return prisma.user.findFirst({ where: { username }, select: { id: true } });
    },

    async deleteSessionsForUser(userId) {
      await sessions.revokeAll(userId);
    },

    async hardDeleteUser(id) {
      await prisma.user.delete({ where: { id } });
    },

    async openOrderBalances() {
      const rows = await prisma.workOrder.findMany({
        where: { deletedAt: null, status: { not: "CANCELLED" } },
        select: { totalAmount: true, paidAmount: true },
      });
      return rows.map((row) => ({
        totalAmount: decimal(row.totalAmount),
        paidAmount: decimal(row.paidAmount),
      }));
    },

    async dispose() {
      await prisma.$disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// SQLite 实现（node:sqlite 直查；列名 = SQLite migration 里的 snake_case）
// ---------------------------------------------------------------------------

interface SqlRow {
  [key: string]: unknown;
}

export function createSqliteSmokeInspector(db: DatabaseSync): SmokeInspector {
  const sessions = createSqliteSessionStore(db);

  const one = (sql: string, ...params: Array<string | number | null>): SqlRow | undefined =>
    db.prepare(sql).get(...params) as SqlRow | undefined;
  const require = (row: SqlRow | undefined, what: string): SqlRow => {
    if (!row) throw new Error(`SQLite 检查器：找不到${what}`);
    return row;
  };
  const toDate = (value: unknown): Date | null =>
    value === null || value === undefined ? null : new Date(String(value));

  return {
    kind: "node-sqlite",

    async findAdmin() {
      const row = require(one(
        "SELECT id, username, name, role FROM users WHERE role = 'ADMIN' AND deleted_at IS NULL LIMIT 1",
      ), "管理员账号");
      return {
        id: String(row.id),
        username: String(row.username),
        name: String(row.name),
        role: String(row.role) as Role,
      };
    },

    async findBaselinePart() {
      const row = require(one(
        `SELECT p.id AS id, p.name AS name, p.sale_price AS sale_price, i.quantity AS quantity
           FROM parts p LEFT JOIN inventories i ON i.part_id = p.id
           WHERE p.deleted_at IS NULL AND p.name LIKE ? LIMIT 1`,
        "%机油滤清器%",
      ), "基线配件（机油滤清器）");
      return {
        id: String(row.id),
        name: String(row.name),
        salePrice: decimal(row.sale_price),
        quantity: decimal(row.quantity ?? 0),
      };
    },

    async findBaselineServiceItem() {
      const row = require(one(
        "SELECT id, name, default_price FROM service_items WHERE deleted_at IS NULL AND kind = 'SERVICE' LIMIT 1",
      ), "基线维修项目（SERVICE）");
      return {
        id: String(row.id),
        name: String(row.name),
        defaultPrice: decimal(row.default_price),
      };
    },

    async inventoryOf(partId) {
      const row = require(one(
        "SELECT quantity, safe_quantity, avg_cost FROM inventories WHERE part_id = ? LIMIT 1",
        partId,
      ), `配件 ${partId} 的库存行`);
      return {
        quantity: decimal(row.quantity),
        safeQuantity: decimal(row.safe_quantity),
        avgCost: decimal(row.avg_cost),
      };
    },

    async vehicleSummary(id) {
      const row = require(one(
        "SELECT current_mileage, last_service_at FROM vehicles WHERE id = ? LIMIT 1",
        id,
      ), `车辆 ${id}`);
      const count = one(
        "SELECT count(*) AS c FROM vehicle_service_records WHERE vehicle_id = ?",
        id,
      );
      return {
        currentMileage:
          row.current_mileage === null || row.current_mileage === undefined
            ? null
            : Number(row.current_mileage),
        lastServiceAt: toDate(row.last_service_at),
        serviceRecordCount: Number(count?.c ?? 0),
      };
    },

    async expenseExistsByRemark(keyword) {
      return (
        one("SELECT 1 AS hit FROM expenses WHERE remark LIKE ? LIMIT 1", `%${keyword}%`) !==
        undefined
      );
    },

    async softDeleteCustomerByPhone(phone) {
      const now = new Date().toISOString();
      return Number(
        db
          .prepare("UPDATE customers SET deleted_at = ?, updated_at = ? WHERE phone = ?")
          .run(now, now, phone).changes,
      );
    },

    async createVehicle(data) {
      const now = new Date().toISOString();
      const id = newId();
      db.prepare(
        `INSERT INTO vehicles (id, customer_id, plate_number, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, data.customerId, data.plateNumber, now, now);
      return { id };
    },

    async findActiveCustomerByPhone(phone) {
      const row = require(one(
        "SELECT id, name FROM customers WHERE phone = ? AND deleted_at IS NULL LIMIT 1",
        phone,
      ), `手机号 ${phone} 的在册客户`);
      return { id: String(row.id), name: String(row.name) };
    },

    async findAnyActiveCustomer() {
      const row = require(one(
        "SELECT id, name FROM customers WHERE deleted_at IS NULL LIMIT 1",
      ), "任何在册客户");
      return { id: String(row.id), name: String(row.name) };
    },

    async vehicleDeletedAt(id) {
      const row = one("SELECT deleted_at FROM vehicles WHERE id = ? LIMIT 1", id);
      return row ? toDate(row.deleted_at) : null;
    },

    async softDeleteVehicleByPlate(plateNumber) {
      const now = new Date().toISOString();
      return Number(
        db
          .prepare("UPDATE vehicles SET deleted_at = ?, updated_at = ? WHERE plate_number = ?")
          .run(now, now, plateNumber).changes,
      );
    },

    async softDeletePartByCode(code) {
      const now = new Date().toISOString();
      return Number(
        db
          .prepare("UPDATE parts SET deleted_at = ?, is_active = 0, updated_at = ? WHERE code = ?")
          .run(now, now, code).changes,
      );
    },

    async partFlags(id) {
      const row = one("SELECT deleted_at, is_active FROM parts WHERE id = ? LIMIT 1", id);
      if (!row) return null;
      return { deletedAt: toDate(row.deleted_at), isActive: Number(row.is_active) === 1 };
    },

    async findUserByUsername(username) {
      const row = one("SELECT id FROM users WHERE username = ? LIMIT 1", username);
      return row ? { id: String(row.id) } : null;
    },

    async deleteSessionsForUser(userId) {
      await sessions.revokeAll(userId);
    },

    async hardDeleteUser(id) {
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
    },

    async openOrderBalances() {
      const rows = db
        .prepare(
          "SELECT total_amount, paid_amount FROM work_orders WHERE deleted_at IS NULL AND status <> 'CANCELLED'",
        )
        .all() as SqlRow[];
      return rows.map((row) => ({
        totalAmount: decimal(row.total_amount),
        paidAmount: decimal(row.paid_amount),
      }));
    },

    async dispose() {
      const { closeSqliteDb } = await import("@/server/repos/sqlite/client");
      closeSqliteDb();
    },
  };
}

/** 按当前 APP_STORAGE 选择实现（PG → Prisma / sqlite → node:sqlite） */
export async function createSmokeInspector(): Promise<SmokeInspector> {
  if (storageKind === "sqlite") {
    const { getSqliteDb } = await import("@/server/repos/sqlite/client");
    return createSqliteSmokeInspector(getSqliteDb());
  }
  const { PrismaClient } = await import("@prisma/client");
  return createPrismaSmokeInspector(new PrismaClient());
}
