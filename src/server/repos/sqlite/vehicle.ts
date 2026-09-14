import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { VehicleRepository } from "@/domain/repositories";
import type { VehicleServiceRecord } from "@/domain/entities";
import type {
  DueServiceVehicleRow,
  VehicleDetailBaseRow,
  VehicleListRow,
  VehicleServiceRecordRow,
  VehicleSuggestionRow,
  SearchVehicleRow,
} from "@/domain/rows";
import { escapeLikePattern, plateMatchKeyword } from "@/lib/plate";
import { NotFoundError } from "@/server/errors";

import { newId } from "./id";

type SqlRow = Record<string, unknown>;

const text = (value: unknown): string | null => (value == null ? null : String(value));
const date = (value: unknown): Date | null => (value == null ? null : new Date(String(value)));
const requiredDate = (value: unknown): Date => new Date(String(value));

function rows<T extends SqlRow>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

function one<T extends SqlRow>(
  db: DatabaseSync,
  sql: string,
  ...params: SQLInputValue[]
): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

function execute(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}

const vehicleProjection = `
  SELECT v.id, v.plate_number, v.brand, v.model, v.year, v.vin,
         v.current_mileage, v.last_service_at, v.next_service_at, v.customer_id,
         c.name AS customer_name, c.phone AS customer_phone
  FROM vehicles v
  JOIN customers c ON c.id = v.customer_id
`;

function mapVehicleListRow(row: SqlRow): VehicleListRow {
  return {
    id: String(row.id),
    plateNumber: String(row.plate_number),
    brand: text(row.brand),
    model: text(row.model),
    year: row.year == null ? null : Number(row.year),
    vin: text(row.vin),
    currentMileage: row.current_mileage == null ? null : Number(row.current_mileage),
    lastServiceAt: date(row.last_service_at),
    nextServiceAt: date(row.next_service_at),
    customerId: String(row.customer_id),
    customer: { name: String(row.customer_name), phone: String(row.customer_phone) },
  };
}

function mapVehicleDetailRow(row: SqlRow): VehicleDetailBaseRow {
  return {
    ...mapVehicleListRow(row),
    engineNo: text(row.engine_no),
    remark: text(row.remark),
  };
}

function keywordClause(keyword: string): { sql: string; params: SQLInputValue[] } {
  const upper = keyword.toUpperCase();
  return {
    sql: `(
      LOWER(v.plate_number) LIKE LOWER('%' || ? || '%')
      OR LOWER(v.vin) LIKE LOWER('%' || ? || '%')
      OR LOWER(v.brand) LIKE LOWER('%' || ? || '%')
      OR LOWER(v.model) LIKE LOWER('%' || ? || '%')
      OR LOWER(c.name) LIKE LOWER('%' || ? || '%')
      OR c.phone LIKE '%' || ? || '%'
    )`,
    params: [upper, upper, keyword, keyword, keyword, keyword],
  };
}

function mapServiceRecord(row: SqlRow): VehicleServiceRecordRow {
  return {
    id: String(row.id),
    vehicleId: String(row.vehicle_id),
    workOrderId: text(row.work_order_id),
    servicedAt: requiredDate(row.serviced_at),
    mileage: row.mileage == null ? null : Number(row.mileage),
    description: String(row.description),
    nextServiceAt: date(row.next_service_at),
    nextServiceMileage: row.next_service_mileage == null ? null : Number(row.next_service_mileage),
    createdBy: text(row.created_by),
    createdAt: requiredDate(row.created_at),
    workOrder: row.order_no == null ? null : { orderNo: String(row.order_no) },
  };
}

export function createSqliteVehicleRepository(db: DatabaseSync): VehicleRepository {
  return {
    async findIdByPlate(plateNumber) {
      const row = one(
        db,
        `SELECT id, customer_id FROM vehicles
         WHERE plate_number = ? AND deleted_at IS NULL LIMIT 1`,
        plateNumber,
      );
      return row ? { id: String(row.id), customerId: String(row.customer_id) } : null;
    },

    async list(filter, paging) {
      const where = ["v.deleted_at IS NULL"];
      const params: SQLInputValue[] = [];
      if (filter.customerId) {
        where.push("v.customer_id = ?");
        params.push(filter.customerId);
      }
      if (filter.dueServiceBefore) {
        where.push("v.next_service_at IS NOT NULL AND v.next_service_at <= ?");
        params.push(filter.dueServiceBefore.toISOString());
      }
      if (filter.keyword) {
        const keyword = keywordClause(filter.keyword);
        where.push(keyword.sql);
        params.push(...keyword.params);
      }
      const clause = where.join(" AND ");
      const resultRows = rows(
        db,
        `${vehicleProjection}
         WHERE ${clause}
         ORDER BY v.updated_at DESC
         LIMIT ? OFFSET ?`,
        ...params,
        paging.take,
        paging.skip,
      ).map(mapVehicleListRow);
      const total = Number(
        one(
          db,
          `SELECT COUNT(*) AS count
           FROM vehicles v JOIN customers c ON c.id = v.customer_id
           WHERE ${clause}`,
          ...params,
        )?.count ?? 0,
      );
      return { rows: resultRows, total };
    },

    async findDetailBaseById(id) {
      const row = one(
        db,
        `${vehicleProjection.replace(
          "v.current_mileage, v.last_service_at, v.next_service_at, v.customer_id,",
          "v.current_mileage, v.last_service_at, v.next_service_at, v.customer_id, v.engine_no, v.remark,",
        )}
         WHERE v.id = ? AND v.deleted_at IS NULL`,
        id,
      );
      return row ? mapVehicleDetailRow(row) : null;
    },

    async findDetailBaseByPlate(plateNumber, excludeId) {
      const row = one(
        db,
        `${vehicleProjection.replace(
          "v.current_mileage, v.last_service_at, v.next_service_at, v.customer_id,",
          "v.current_mileage, v.last_service_at, v.next_service_at, v.customer_id, v.engine_no, v.remark,",
        )}
         WHERE v.plate_number = ? AND v.deleted_at IS NULL${excludeId ? " AND v.id <> ?" : ""}
         LIMIT 1`,
        ...([plateNumber, ...(excludeId ? [excludeId] : [])] as SQLInputValue[]),
      );
      return row ? mapVehicleDetailRow(row) : null;
    },

    async create(data) {
      const id = newId();
      const now = new Date().toISOString();
      execute(
        db,
        `INSERT INTO vehicles
           (id, customer_id, plate_number, brand, model, year, vin, engine_no,
            current_mileage, last_service_at, next_service_at, remark, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.customerId,
        data.plateNumber,
        data.brand ?? null,
        data.model ?? null,
        data.year ?? null,
        data.vin ?? null,
        data.engineNo ?? null,
        data.currentMileage ?? null,
        data.lastServiceAt?.toISOString() ?? null,
        data.nextServiceAt?.toISOString() ?? null,
        data.remark ?? null,
        now,
        now,
      );
      return { id, plateNumber: data.plateNumber };
    },

    async reassignToCustomer(id, customerId) {
      const changed = execute(
        db,
        "UPDATE vehicles SET customer_id = ?, updated_at = ? WHERE id = ?",
        customerId,
        new Date().toISOString(),
        id,
      );
      if (changed === 0) throw new NotFoundError();
    },

    async searchForGlobal(keyword, limit) {
      const upper = keyword.toUpperCase();
      return rows(
        db,
        `SELECT v.id, v.plate_number, v.brand, v.model, c.name AS customer_name
         FROM vehicles v JOIN customers c ON c.id = v.customer_id
         WHERE v.deleted_at IS NULL
           AND (
             LOWER(v.plate_number) LIKE LOWER('%' || ? || '%')
             OR LOWER(v.vin) LIKE LOWER('%' || ? || '%')
             OR LOWER(v.brand) LIKE LOWER('%' || ? || '%')
             OR LOWER(v.model) LIKE LOWER('%' || ? || '%')
           )
         ORDER BY v.updated_at DESC
         LIMIT ?`,
        upper,
        upper,
        keyword,
        keyword,
        limit,
      ).map((row): SearchVehicleRow => ({
        id: String(row.id),
        plateNumber: String(row.plate_number),
        brand: text(row.brand),
        model: text(row.model),
        customerName: String(row.customer_name),
      }));
    },

    async suggestByPlate(keyword, limit) {
      // LIKE 通配符必须转义（配合 ESCAPE '\'）：
      // 不转义的话用户在车牌框里打一个 % 就会命中全库。
      return rows(
        db,
        `SELECT v.id, v.plate_number, v.brand, v.model, v.vin, v.updated_at,
                c.name AS customer_name,
                (SELECT MAX(w.created_at) FROM work_orders w
                  WHERE w.vehicle_id = v.id AND w.deleted_at IS NULL) AS last_visit_at,
                (SELECT COUNT(*) FROM work_orders w
                  WHERE w.vehicle_id = v.id AND w.deleted_at IS NULL) AS work_order_count
         FROM vehicles v
         JOIN customers c ON c.id = v.customer_id
         WHERE v.deleted_at IS NULL
           AND UPPER(v.plate_number) LIKE UPPER('%' || ? || '%') ESCAPE '\\'
         ORDER BY v.updated_at DESC
         LIMIT ?`,
        escapeLikePattern(plateMatchKeyword(keyword)),
        limit,
      ).map((row): VehicleSuggestionRow => ({
        id: String(row.id),
        plateNumber: String(row.plate_number),
        brand: text(row.brand),
        model: text(row.model),
        vin: text(row.vin),
        customerName: String(row.customer_name),
        lastVisitAt: date(row.last_visit_at),
        workOrderCount: Number(row.work_order_count ?? 0),
        updatedAt: requiredDate(row.updated_at),
      }));
    },

    async findForEdit(id) {
      const row = one(
        db,
        `SELECT id, plate_number, customer_id FROM vehicles
         WHERE id = ? AND deleted_at IS NULL`,
        id,
      );
      return row
        ? {
            id: String(row.id),
            plateNumber: String(row.plate_number),
            customerId: String(row.customer_id),
          }
        : null;
    },

    async update(id, patch) {
      const changed = execute(
        db,
        `UPDATE vehicles
         SET customer_id=?, plate_number=?, brand=?, model=?, year=?, vin=?, engine_no=?,
             current_mileage=?, last_service_at=?, next_service_at=?, remark=?, updated_at=?
         WHERE id=?`,
        patch.customerId,
        patch.plateNumber,
        patch.brand,
        patch.model,
        patch.year,
        patch.vin,
        patch.engineNo,
        patch.currentMileage,
        patch.lastServiceAt?.toISOString() ?? null,
        patch.nextServiceAt?.toISOString() ?? null,
        patch.remark,
        new Date().toISOString(),
        id,
      );
      if (changed === 0) throw new NotFoundError();
    },

    async findForDelete(id) {
      const row = one(
        db,
        `SELECT v.id, v.plate_number,
                (SELECT COUNT(*) FROM work_orders w WHERE w.vehicle_id = v.id) AS work_order_count
         FROM vehicles v
         WHERE v.id = ? AND v.deleted_at IS NULL`,
        id,
      );
      return row
        ? {
            id: String(row.id),
            plateNumber: String(row.plate_number),
            workOrderCount: Number(row.work_order_count),
          }
        : null;
    },

    async softDelete(id) {
      const now = new Date().toISOString();
      const changed = execute(
        db,
        "UPDATE vehicles SET deleted_at = ?, updated_at = ? WHERE id = ?",
        now,
        now,
        id,
      );
      if (changed === 0) throw new NotFoundError();
    },

    async listByCustomer(customerId) {
      return rows(
        db,
        `${vehicleProjection}
         WHERE v.customer_id = ? AND v.deleted_at IS NULL
         ORDER BY v.created_at DESC`,
        customerId,
      ).map(mapVehicleListRow);
    },

    async softDeleteByCustomer(customerId) {
      const now = new Date().toISOString();
      execute(
        db,
        "UPDATE vehicles SET deleted_at = ?, updated_at = ? WHERE customer_id = ? AND deleted_at IS NULL",
        now,
        now,
        customerId,
      );
    },

    async listServiceRecords(vehicleId, take) {
      return rows(
        db,
        `SELECT r.*, w.order_no
         FROM vehicle_service_records r
         LEFT JOIN work_orders w ON w.id = r.work_order_id
         WHERE r.vehicle_id = ?
         ORDER BY r.serviced_at DESC
         LIMIT ?`,
        vehicleId,
        take,
      ).map(mapServiceRecord);
    },

    async listDueService(before, limit) {
      return rows(
        db,
        `SELECT v.id, v.plate_number, v.next_service_at, v.current_mileage,
                c.name AS customer_name, c.phone AS customer_phone
         FROM vehicles v JOIN customers c ON c.id = v.customer_id
         WHERE v.deleted_at IS NULL AND v.next_service_at IS NOT NULL AND v.next_service_at <= ?
         ORDER BY v.next_service_at ASC
         LIMIT ?`,
        before.toISOString(),
        limit,
      ).map((row): DueServiceVehicleRow => ({
        id: String(row.id),
        plateNumber: String(row.plate_number),
        nextServiceAt: requiredDate(row.next_service_at),
        currentMileage: row.current_mileage == null ? null : Number(row.current_mileage),
        customer: { name: String(row.customer_name), phone: String(row.customer_phone) },
      }));
    },

    async updateServiceInfo(id, patch) {
      const fields = ["last_service_at = ?", "updated_at = ?"];
      const params: SQLInputValue[] = [patch.lastServiceAt.toISOString(), new Date().toISOString()];
      if (patch.currentMileage !== undefined) {
        fields.push("current_mileage = ?");
        params.push(patch.currentMileage);
      }
      if (patch.nextServiceAt !== undefined) {
        fields.push("next_service_at = ?");
        params.push(patch.nextServiceAt?.toISOString() ?? null);
      }
      params.push(id);
      const changed = execute(
        db,
        `UPDATE vehicles SET ${fields.join(", ")} WHERE id = ?`,
        ...params,
      );
      if (changed === 0) throw new NotFoundError();
    },

    async createServiceRecord(data) {
      const id = newId();
      const now = new Date().toISOString();
      execute(
        db,
        `INSERT INTO vehicle_service_records
           (id, vehicle_id, work_order_id, serviced_at, mileage, description,
            next_service_at, next_service_mileage, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.vehicleId,
        data.workOrderId ?? null,
        data.servicedAt.toISOString(),
        data.mileage ?? null,
        data.description,
        data.nextServiceAt?.toISOString() ?? null,
        data.nextServiceMileage ?? null,
        data.createdBy,
        now,
      );
      const row = one(
        db,
        `SELECT r.*, w.order_no
         FROM vehicle_service_records r
         LEFT JOIN work_orders w ON w.id = r.work_order_id
         WHERE r.id = ?`,
        id,
      );
      return {
        id: String(row!.id),
        vehicleId: String(row!.vehicle_id),
        workOrderId: text(row!.work_order_id),
        servicedAt: requiredDate(row!.serviced_at),
        mileage: row!.mileage == null ? null : Number(row!.mileage),
        description: String(row!.description),
        nextServiceAt: date(row!.next_service_at),
        nextServiceMileage:
          row!.next_service_mileage == null ? null : Number(row!.next_service_mileage),
        createdBy: text(row!.created_by),
        createdAt: requiredDate(row!.created_at),
      } satisfies VehicleServiceRecord;
    },

    async detachServiceRecordsFromWorkOrder(workOrderId) {
      execute(
        db,
        "UPDATE vehicle_service_records SET work_order_id = NULL WHERE work_order_id = ?",
        workOrderId,
      );
    },
  };
}
