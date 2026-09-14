import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { WorkOrder, WorkOrderItem } from "@/domain/entities";
import type { IncomeCategory, IncomeSource, InventoryTxType, PaymentMethod } from "@/domain/enums";
import type {
  WorkOrderCreateData,
  WorkOrderInfoPatch,
  WorkOrderItemCreateData,
  WorkOrderItemPatch,
  WorkOrderListFilter,
  WorkOrderRepository,
  WorkOrderTotalsPatch,
  WorkOrderItemRepository,
} from "@/domain/repositories";
import type {
  WorkOrderDetailRow,
  WorkOrderInventoryTxRow,
  WorkOrderListRow,
  WorkOrderPaymentRow,
} from "@/domain/rows";
import { D } from "@/lib/money";

import { fromDbDecimal, fromDbDecimalOrZero, toDbDecimalOrZero } from "./decimal";
import { newId } from "./id";

type SqlRow = Record<string, unknown>;

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);
const date = (value: unknown): Date | null => (typeof value === "string" ? new Date(value) : null);
const requiredDate = (value: unknown): Date => new Date(String(value));
const text = (value: unknown): string | null => (value == null ? null : String(value));

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

function run(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): void {
  db.prepare(sql).run(...params);
}

function sum(values: Array<string | null | undefined>) {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total.plus(D(value ?? "0")), D(0));
}

const statusOf = (value: unknown): WorkOrder["status"] => value as WorkOrder["status"];
const itemTypeOf = (value: unknown): WorkOrderItem["type"] => value as WorkOrderItem["type"];
const paymentMethodOf = (value: unknown): PaymentMethod => value as PaymentMethod;
const incomeCategoryOf = (value: unknown): IncomeCategory => value as IncomeCategory;
const incomeSourceOf = (value: unknown): IncomeSource => value as IncomeSource;
const inventoryTxTypeOf = (value: unknown): InventoryTxType => value as InventoryTxType;

function mapWorkOrder(row: SqlRow): WorkOrder {
  return {
    id: String(row.id),
    orderNo: String(row.order_no),
    status: row.status as WorkOrder["status"],
    customerId: String(row.customer_id),
    vehicleId: String(row.vehicle_id),
    mileage: (row.mileage as number | null) ?? null,
    faultDescription: text(row.fault_description),
    remark: text(row.remark),
    technicianId: text(row.technician_id),
    createdBy: text(row.created_by),
    serviceAmount: fromDbDecimalOrZero(text(row.service_amount)),
    partsAmount: fromDbDecimalOrZero(text(row.parts_amount)),
    laborAmount: fromDbDecimalOrZero(text(row.labor_amount)),
    otherAmount: fromDbDecimalOrZero(text(row.other_amount)),
    discountAmount: fromDbDecimalOrZero(text(row.discount_amount)),
    totalAmount: fromDbDecimalOrZero(text(row.total_amount)),
    paidAmount: fromDbDecimalOrZero(text(row.paid_amount)),
    partsCost: fromDbDecimalOrZero(text(row.parts_cost)),
    completedAt: date(row.completed_at),
    cancelledAt: date(row.cancelled_at),
    cancelReason: text(row.cancel_reason),
    createdAt: requiredDate(row.created_at),
    updatedAt: requiredDate(row.updated_at),
    deletedAt: date(row.deleted_at),
  };
}

function mapItem(row: SqlRow): WorkOrderItem {
  return {
    id: String(row.id),
    workOrderId: String(row.work_order_id),
    type: row.type as WorkOrderItem["type"],
    itemRefId: text(row.item_ref_id),
    name: String(row.name),
    spec: text(row.spec),
    unit: text(row.unit),
    quantity: fromDbDecimalOrZero(text(row.quantity)),
    unitPrice: fromDbDecimalOrZero(text(row.unit_price)),
    costPrice: fromDbDecimalOrZero(text(row.cost_price)),
    amount: fromDbDecimalOrZero(text(row.amount)),
    remark: text(row.remark),
    sortOrder: Number(row.sort_order),
    createdAt: requiredDate(row.created_at),
    updatedAt: requiredDate(row.updated_at),
  };
}

const baseWorkOrder = `
  SELECT w.*, c.name AS customer_name, c.phone AS customer_phone,
         v.plate_number, v.brand, v.model, v.year, v.vin, t.name AS technician_name,
         (SELECT COUNT(*) FROM work_order_items i WHERE i.work_order_id = w.id) AS item_count
  FROM work_orders w
  JOIN customers c ON c.id = w.customer_id
  JOIN vehicles v ON v.id = w.vehicle_id
  LEFT JOIN employees t ON t.id = w.technician_id
`;

function mapListRow(row: SqlRow): WorkOrderListRow {
  return {
    id: String(row.id),
    orderNo: String(row.order_no),
    status: statusOf(row.status),
    customerId: String(row.customer_id),
    vehicleId: String(row.vehicle_id),
    totalAmount: fromDbDecimalOrZero(text(row.total_amount)),
    paidAmount: fromDbDecimalOrZero(text(row.paid_amount)),
    createdAt: requiredDate(row.created_at),
    completedAt: date(row.completed_at),
    faultDescription: text(row.fault_description),
    customer: { name: String(row.customer_name), phone: String(row.customer_phone) },
    vehicle: {
      plateNumber: String(row.plate_number),
      brand: text(row.brand),
      model: text(row.model),
    },
    technician: row.technician_name == null ? null : { name: String(row.technician_name) },
    _count: { items: Number(row.item_count) },
  };
}

export function createSqliteWorkOrderRepository(db: DatabaseSync): WorkOrderRepository {
  return {
    async findLatestOrderNo(prefix) {
      return (
        (one(
          db,
          "SELECT order_no FROM work_orders WHERE order_no LIKE ? || '%' ORDER BY order_no DESC LIMIT 1",
          prefix,
        )?.order_no as string | undefined) ?? null
      );
    },

    async list(filter: WorkOrderListFilter, paging) {
      const where = ["w.deleted_at IS NULL"];
      const params: SQLInputValue[] = [];
      if (filter.status === "UNPAID") {
        where.push("w.status IN ('PENDING_PAYMENT','IN_PROGRESS','PENDING_QC','PENDING_INTAKE')");
      } else if (filter.status && filter.status !== "ALL") {
        where.push("w.status = ?");
        params.push(filter.status);
      }
      if (filter.customerId) {
        where.push("w.customer_id = ?");
        params.push(filter.customerId);
      }
      if (filter.vehicleId) {
        where.push("w.vehicle_id = ?");
        params.push(filter.vehicleId);
      }
      if (filter.restrictToCreatorId) {
        where.push("w.created_by = ?");
        params.push(filter.restrictToCreatorId);
      }
      if (filter.keyword) {
        where.push(
          "(LOWER(w.order_no) LIKE LOWER(?) OR LOWER(c.name) LIKE LOWER(?) OR c.phone LIKE ? OR LOWER(v.plate_number) LIKE LOWER(?))",
        );
        const upper = filter.keyword.toUpperCase();
        params.push(
          `%${filter.keyword}%`,
          `%${filter.keyword}%`,
          `%${filter.keyword}%`,
          `%${upper}%`,
        );
      }
      const clause = where.join(" AND ");
      const result = rows(
        db,
        `${baseWorkOrder} WHERE ${clause} ORDER BY w.created_at DESC LIMIT ? OFFSET ?`,
        ...params,
        paging.take,
        paging.skip,
      );
      const count = one(
        db,
        `SELECT COUNT(*) AS count FROM work_orders w JOIN customers c ON c.id=w.customer_id JOIN vehicles v ON v.id=w.vehicle_id WHERE ${clause}`,
        ...params,
      );
      return { rows: result.map(mapListRow), total: Number(count?.count ?? 0) };
    },

    async listRecentByCustomer(customerId, take) {
      return this.list({ customerId }, { take, skip: 0 }).then((x) => x.rows);
    },
    async listRecentByVehicle(vehicleId, take) {
      return this.list({ vehicleId }, { take, skip: 0 }).then((x) => x.rows);
    },
    async listBriefByVehicle(vehicleId, take) {
      return rows(
        db,
        "SELECT id, order_no, created_at, mileage, total_amount FROM work_orders WHERE vehicle_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?",
        vehicleId,
        take,
      ).map((r) => ({
        id: String(r.id),
        orderNo: String(r.order_no),
        createdAt: requiredDate(r.created_at),
        mileage: (r.mileage as number | null) ?? null,
        totalAmount: fromDbDecimalOrZero(text(r.total_amount)),
      }));
    },
    async listUnsettled(take) {
      return rows(
        db,
        `SELECT w.id,w.order_no,w.status,w.total_amount,w.paid_amount,w.created_at,c.id customer_id,c.name customer_name,c.phone customer_phone,v.plate_number FROM work_orders w JOIN customers c ON c.id=w.customer_id JOIN vehicles v ON v.id=w.vehicle_id WHERE w.deleted_at IS NULL AND w.status <> 'CANCELLED' ORDER BY w.created_at ASC LIMIT ?`,
        take,
      ).map((r) => ({
        id: String(r.id),
        orderNo: String(r.order_no),
        status: statusOf(r.status),
        totalAmount: fromDbDecimalOrZero(text(r.total_amount)),
        paidAmount: fromDbDecimalOrZero(text(r.paid_amount)),
        createdAt: requiredDate(r.created_at),
        customer: {
          id: String(r.customer_id),
          name: String(r.customer_name),
          phone: String(r.customer_phone),
        },
        vehicle: { plateNumber: String(r.plate_number) },
      }));
    },
    async findDetailById(id) {
      const r = one(db, `${baseWorkOrder} WHERE w.id=? AND w.deleted_at IS NULL`, id);
      if (!r) return null;
      const items = rows(
        db,
        "SELECT * FROM work_order_items WHERE work_order_id=? ORDER BY sort_order ASC, created_at ASC",
        id,
      ).map(mapItem);
      const payments: WorkOrderPaymentRow[] = rows(
        db,
        "SELECT p.*, u.name operator_name FROM payments p LEFT JOIN users u ON u.id=p.operator_id WHERE p.work_order_id=? AND p.deleted_at IS NULL ORDER BY p.occurred_at DESC",
        id,
      ).map((p) => ({
        id: String(p.id),
        amount: fromDbDecimalOrZero(text(p.amount)),
        method: paymentMethodOf(p.method),
        category: incomeCategoryOf(p.category),
        source: incomeSourceOf(p.source),
        occurredAt: requiredDate(p.occurred_at),
        remark: text(p.remark),
        workOrderId: text(p.work_order_id),
        operator: p.operator_name == null ? null : { name: String(p.operator_name) },
      }));
      const inventoryTxs: WorkOrderInventoryTxRow[] = rows(
        db,
        `SELECT x.*, p.name part_name, u.name operator_name FROM inventory_transactions x JOIN parts p ON p.id=x.part_id LEFT JOIN users u ON u.id=x.operator_id WHERE x.work_order_id=? ORDER BY x.created_at DESC`,
        id,
      ).map((x) => ({
        id: String(x.id),
        type: inventoryTxTypeOf(x.type),
        partId: String(x.part_id),
        quantity: fromDbDecimalOrZero(text(x.quantity)),
        qtyBefore: fromDbDecimalOrZero(text(x.qty_before)),
        qtyAfter: fromDbDecimalOrZero(text(x.qty_after)),
        unitCost: fromDbDecimal(text(x.unit_cost)),
        amount: fromDbDecimal(text(x.amount)),
        workOrderId: text(x.work_order_id),
        remark: text(x.remark),
        createdAt: requiredDate(x.created_at),
        part: { name: String(x.part_name) },
        operator: x.operator_name == null ? null : { name: String(x.operator_name) },
      }));
      const detail: WorkOrderDetailRow = {
        id: String(r.id),
        orderNo: String(r.order_no),
        status: statusOf(r.status),
        customerId: String(r.customer_id),
        vehicleId: String(r.vehicle_id),
        mileage: (r.mileage as number | null) ?? null,
        faultDescription: text(r.fault_description),
        remark: text(r.remark),
        serviceAmount: fromDbDecimalOrZero(text(r.service_amount)),
        partsAmount: fromDbDecimalOrZero(text(r.parts_amount)),
        laborAmount: fromDbDecimalOrZero(text(r.labor_amount)),
        otherAmount: fromDbDecimalOrZero(text(r.other_amount)),
        discountAmount: fromDbDecimalOrZero(text(r.discount_amount)),
        totalAmount: fromDbDecimalOrZero(text(r.total_amount)),
        paidAmount: fromDbDecimalOrZero(text(r.paid_amount)),
        partsCost: fromDbDecimalOrZero(text(r.parts_cost)),
        completedAt: date(r.completed_at),
        cancelledAt: date(r.cancelled_at),
        cancelReason: text(r.cancel_reason),
        createdAt: requiredDate(r.created_at),
        updatedAt: requiredDate(r.updated_at),
        customer: {
          name: String(r.customer_name),
          phone: String(r.customer_phone),
          wechat: text(
            one(db, "SELECT wechat FROM customers WHERE id=?", String(r.customer_id))?.wechat,
          ),
        },
        vehicle: {
          plateNumber: String(r.plate_number),
          brand: text(r.brand),
          model: text(r.model),
          year: (r.year as number | null) ?? null,
          vin: text(r.vin),
        },
        technician: r.technician_name == null ? null : { name: String(r.technician_name) },
        creator:
          r.created_by == null
            ? null
            : (() => {
                const u = one(db, "SELECT name FROM users WHERE id=?", String(r.created_by));
                return u ? { name: String(u.name) } : null;
              })(),
        items,
        payments,
        inventoryTxs,
      };
      return detail;
    },
    async findForMutation(id) {
      const r = one(db, `${baseWorkOrder} WHERE w.id=? AND w.deleted_at IS NULL`, id);
      return r
        ? {
            id: String(r.id),
            orderNo: String(r.order_no),
            status: statusOf(r.status),
            createdBy: text(r.created_by),
            customerId: String(r.customer_id),
            vehicleId: String(r.vehicle_id),
            discountAmount: fromDbDecimalOrZero(text(r.discount_amount)),
            totalAmount: fromDbDecimalOrZero(text(r.total_amount)),
            paidAmount: fromDbDecimalOrZero(text(r.paid_amount)),
            mileage: (r.mileage as number | null) ?? null,
            vehicle: { plateNumber: String(r.plate_number) },
            customer: { name: String(r.customer_name) },
          }
        : null;
    },
    async findTotalsSource(id) {
      const r = one(db, "SELECT discount_amount FROM work_orders WHERE id=?", id);
      if (!r) return null;
      return {
        discountAmount: fromDbDecimalOrZero(text(r.discount_amount)),
        items: rows(
          db,
          "SELECT type,quantity,unit_price,cost_price FROM work_order_items WHERE work_order_id=?",
          id,
        ).map((x) => ({
          type: itemTypeOf(x.type),
          quantity: fromDbDecimalOrZero(text(x.quantity)),
          unitPrice: fromDbDecimalOrZero(text(x.unit_price)),
          costPrice: fromDbDecimalOrZero(text(x.cost_price)),
        })),
      };
    },
    async create(data: WorkOrderCreateData) {
      const id = newId(),
        now = new Date().toISOString();
      run(
        db,
        `INSERT INTO work_orders (id,order_no,status,customer_id,vehicle_id,mileage,fault_description,remark,technician_id,created_by,discount_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?)`,
        id,
        data.orderNo,
        "PENDING_INTAKE",
        data.customerId,
        data.vehicleId,
        data.mileage ?? null,
        data.faultDescription ?? null,
        data.remark ?? null,
        data.technicianId ?? null,
        data.createdBy,
        toDbDecimalOrZero(data.discountAmount),
        now,
        now,
      );
      return mapWorkOrder(one(db, "SELECT * FROM work_orders WHERE id=?", id)!);
    },
    async updateInfo(id, patch: WorkOrderInfoPatch) {
      run(
        db,
        "UPDATE work_orders SET mileage=?,fault_description=?,remark=?,technician_id=?,discount_amount=COALESCE(?,discount_amount),updated_at=? WHERE id=?",
        patch.mileage ?? null,
        patch.faultDescription || null,
        patch.remark || null,
        patch.technicianId || null,
        patch.discountAmount === undefined ? null : toDbDecimalOrZero(patch.discountAmount),
        new Date().toISOString(),
        id,
      );
    },
    async applyTotals(id, totals: WorkOrderTotalsPatch) {
      run(
        db,
        "UPDATE work_orders SET service_amount=?,parts_amount=?,labor_amount=?,other_amount=?,discount_amount=?,total_amount=?,parts_cost=?,updated_at=? WHERE id=?",
        toDbDecimalOrZero(totals.serviceAmount),
        toDbDecimalOrZero(totals.partsAmount),
        toDbDecimalOrZero(totals.laborAmount),
        toDbDecimalOrZero(totals.otherAmount),
        toDbDecimalOrZero(totals.discountAmount),
        toDbDecimalOrZero(totals.totalAmount),
        toDbDecimalOrZero(totals.partsCost),
        new Date().toISOString(),
        id,
      );
    },
    async changeStatus(id, patch) {
      const sets = ["status=?", "updated_at=?"];
      const params: SQLInputValue[] = [patch.status, new Date().toISOString()];
      if (patch.mileage !== undefined) {
        sets.push("mileage=?");
        params.push(patch.mileage);
      }
      if (patch.completedAt !== undefined) {
        sets.push("completed_at=?");
        params.push(iso(patch.completedAt));
      }
      if (patch.cancelledAt !== undefined) {
        sets.push("cancelled_at=?");
        params.push(iso(patch.cancelledAt));
      }
      if (patch.cancelReason !== undefined) {
        sets.push("cancel_reason=?");
        params.push(patch.cancelReason);
      }
      params.push(id);
      run(db, `UPDATE work_orders SET ${sets.join(",")} WHERE id=?`, ...params);
    },
    async setPaidAmount(id, paidAmount) {
      run(
        db,
        "UPDATE work_orders SET paid_amount=?,updated_at=? WHERE id=?",
        toDbDecimalOrZero(paidAmount),
        new Date().toISOString(),
        id,
      );
    },
    async findTotalAmount(id) {
      return fromDbDecimal(
        one(db, "SELECT total_amount FROM work_orders WHERE id=?", id)?.total_amount as
          string | undefined,
      );
    },
    async findForPayment(id) {
      const r = one(
        db,
        "SELECT id,order_no,status,total_amount,customer_id FROM work_orders WHERE id=? AND deleted_at IS NULL",
        id,
      );
      return r
        ? {
            id: String(r.id),
            orderNo: String(r.order_no),
            status: statusOf(r.status),
            totalAmount: fromDbDecimalOrZero(text(r.total_amount)),
            customerId: String(r.customer_id),
          }
        : null;
    },
    async findBalance(id) {
      const r = one(
        db,
        "SELECT total_amount,paid_amount FROM work_orders WHERE id=? AND deleted_at IS NULL",
        id,
      );
      return r
        ? {
            totalAmount: fromDbDecimalOrZero(text(r.total_amount)),
            paidAmount: fromDbDecimalOrZero(text(r.paid_amount)),
          }
        : null;
    },
    async listOpenOrderBalances() {
      return rows(
        db,
        "SELECT status,total_amount,paid_amount,customer_id FROM work_orders WHERE deleted_at IS NULL AND status <> 'CANCELLED'",
      ).map((r) => ({
        status: statusOf(r.status),
        totalAmount: fromDbDecimalOrZero(text(r.total_amount)),
        paidAmount: fromDbDecimalOrZero(text(r.paid_amount)),
        customerId: String(r.customer_id),
      }));
    },
    async countCreatedBetween(from, to, options) {
      return Number(
        one(
          db,
          `SELECT COUNT(*) count FROM work_orders WHERE deleted_at IS NULL AND created_at BETWEEN ? AND ? ${options?.excludeCancelled ? "AND status <> 'CANCELLED'" : ""}`,
          iso(from),
          iso(to),
        )?.count ?? 0,
      );
    },
    async listCreatedDates(from, to) {
      return rows(
        db,
        "SELECT created_at FROM work_orders WHERE deleted_at IS NULL AND status <> 'CANCELLED' AND created_at BETWEEN ? AND ?",
        iso(from),
        iso(to),
      ).map((r) => ({ createdAt: requiredDate(r.created_at) }));
    },
    async findCompletedBetween(from, to) {
      const rs = rows(
        db,
        "SELECT total_amount,parts_cost FROM work_orders WHERE deleted_at IS NULL AND status='COMPLETED' AND completed_at BETWEEN ? AND ?",
        iso(from),
        iso(to),
      );
      return {
        count: rs.length,
        totalAmount: sum(rs.map((r) => text(r.total_amount))),
        partsCost: sum(rs.map((r) => text(r.parts_cost))),
      };
    },
    async listCreatedBetween(from, to) {
      return rows(
        db,
        "SELECT status FROM work_orders WHERE deleted_at IS NULL AND created_at BETWEEN ? AND ?",
        iso(from),
        iso(to),
      ).map((r) => ({ status: statusOf(r.status) }));
    },
    async listRecent(take) {
      return this.list({}, { take, skip: 0 }).then((x) => x.rows);
    },
    async searchForGlobal(keyword, limit) {
      return rows(
        db,
        `SELECT w.id,w.order_no,w.status,w.total_amount,v.plate_number FROM work_orders w JOIN customers c ON c.id=w.customer_id JOIN vehicles v ON v.id=w.vehicle_id WHERE w.deleted_at IS NULL AND (LOWER(w.order_no) LIKE LOWER(?) OR LOWER(v.plate_number) LIKE LOWER(?) OR LOWER(c.name) LIKE LOWER(?) OR c.phone LIKE ?) ORDER BY w.created_at DESC LIMIT ?`,
        `%${keyword}%`,
        `%${keyword.toUpperCase()}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        limit,
      ).map((r) => ({
        id: String(r.id),
        orderNo: String(r.order_no),
        status: statusOf(r.status),
        totalAmount: fromDbDecimalOrZero(text(r.total_amount)),
        plateNumber: String(r.plate_number),
      }));
    },
    async listTouchedBetween(from, to, take) {
      return rows(
        db,
        `${baseWorkOrder} WHERE w.deleted_at IS NULL AND ((w.created_at BETWEEN ? AND ?) OR (w.updated_at BETWEEN ? AND ?)) ORDER BY w.updated_at DESC LIMIT ?`,
        iso(from),
        iso(to),
        iso(from),
        iso(to),
        take,
      ).map(mapListRow);
    },
    async aggregateCreatedOrders(from, to) {
      const rs = rows(
        db,
        "SELECT parts_cost FROM work_orders WHERE deleted_at IS NULL AND status <> 'CANCELLED' AND created_at BETWEEN ? AND ?",
        iso(from),
        iso(to),
      );
      return { orderCount: rs.length, partsCost: sum(rs.map((r) => text(r.parts_cost))) };
    },
    async findSnapshot(id) {
      const r = one(
        db,
        "SELECT w.order_no,w.status,w.total_amount,c.name customer_name,v.plate_number FROM work_orders w LEFT JOIN customers c ON c.id=w.customer_id LEFT JOIN vehicles v ON v.id=w.vehicle_id WHERE w.id=?",
        id,
      );
      return r
        ? {
            orderNo: String(r.order_no),
            status: statusOf(r.status),
            totalAmount: fromDbDecimalOrZero(text(r.total_amount)),
            customer: r.customer_name == null ? null : { name: String(r.customer_name) },
            vehicle: r.plate_number == null ? null : { plateNumber: String(r.plate_number) },
          }
        : null;
    },
    async hardDelete(id) {
      run(db, "DELETE FROM work_orders WHERE id=?", id);
    },
  };
}

export function createSqliteWorkOrderItemRepository(db: DatabaseSync): WorkOrderItemRepository {
  return {
    async create(data: WorkOrderItemCreateData) {
      const id = newId(),
        now = new Date().toISOString();
      run(
        db,
        "INSERT INTO work_order_items (id,work_order_id,type,item_ref_id,name,spec,unit,quantity,unit_price,cost_price,amount,remark,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        data.workOrderId,
        data.type,
        data.itemRefId ?? null,
        data.name,
        data.spec ?? null,
        data.unit ?? null,
        toDbDecimalOrZero(data.quantity),
        toDbDecimalOrZero(data.unitPrice),
        toDbDecimalOrZero(data.costPrice),
        toDbDecimalOrZero(data.amount),
        data.remark ?? null,
        data.sortOrder,
        now,
        now,
      );
      return mapItem(one(db, "SELECT * FROM work_order_items WHERE id=?", id)!);
    },
    async findByIdWithOrder(id) {
      const r = one(
        db,
        "SELECT i.id,i.work_order_id,i.type,i.item_ref_id,i.name,i.quantity,i.unit_price,i.amount,w.order_no,w.created_by,w.status FROM work_order_items i JOIN work_orders w ON w.id=i.work_order_id WHERE i.id=?",
        id,
      );
      return r
        ? {
            id: String(r.id),
            workOrderId: String(r.work_order_id),
            type: itemTypeOf(r.type),
            itemRefId: text(r.item_ref_id),
            name: String(r.name),
            quantity: fromDbDecimalOrZero(text(r.quantity)),
            unitPrice: fromDbDecimalOrZero(text(r.unit_price)),
            amount: fromDbDecimalOrZero(text(r.amount)),
            workOrder: {
              id: String(r.work_order_id),
              orderNo: String(r.order_no),
              createdBy: text(r.created_by),
              status: statusOf(r.status),
            },
          }
        : null;
    },
    async update(id, patch: WorkOrderItemPatch) {
      const sets: string[] = [],
        params: SQLInputValue[] = [];
      if (patch.quantity !== undefined) {
        sets.push("quantity=?");
        params.push(toDbDecimalOrZero(patch.quantity));
      }
      if (patch.unitPrice !== undefined) {
        sets.push("unit_price=?");
        params.push(toDbDecimalOrZero(patch.unitPrice));
      }
      if (patch.amount !== undefined) {
        sets.push("amount=?");
        params.push(toDbDecimalOrZero(patch.amount));
      }
      if (patch.remark !== undefined) {
        sets.push("remark=?");
        params.push(patch.remark || null);
      }
      if (sets.length) {
        sets.push("updated_at=?");
        params.push(new Date().toISOString(), id);
        run(db, `UPDATE work_order_items SET ${sets.join(",")} WHERE id=?`, ...params);
      }
    },
    async hardDelete(id) {
      run(db, "DELETE FROM work_order_items WHERE id=?", id);
    },
    async countByOrder(workOrderId) {
      return Number(
        one(db, "SELECT COUNT(*) count FROM work_order_items WHERE work_order_id=?", workOrderId)
          ?.count ?? 0,
      );
    },
    async listPartItems(workOrderId) {
      return rows(
        db,
        "SELECT id,item_ref_id,name,quantity FROM work_order_items WHERE work_order_id=? AND type='PART'",
        workOrderId,
      ).map((r) => ({
        id: String(r.id),
        itemRefId: text(r.item_ref_id),
        name: String(r.name),
        quantity: fromDbDecimalOrZero(text(r.quantity)),
      }));
    },
    async listVehicleItemHistory(vehicleId) {
      return rows(
        db,
        "SELECT i.type,i.name,i.quantity,i.amount FROM work_order_items i JOIN work_orders w ON w.id=i.work_order_id WHERE w.vehicle_id=? AND w.deleted_at IS NULL AND w.status <> 'CANCELLED'",
        vehicleId,
      ).map((r) => ({
        type: itemTypeOf(r.type),
        name: String(r.name),
        quantity: fromDbDecimalOrZero(text(r.quantity)),
        amount: fromDbDecimalOrZero(text(r.amount)),
      }));
    },
    async aggregatePartSales(partId) {
      const rs = rows(
        db,
        "SELECT i.quantity,i.amount,w.id FROM work_order_items i JOIN work_orders w ON w.id=i.work_order_id WHERE i.type='PART' AND i.item_ref_id=? AND w.deleted_at IS NULL AND w.status <> 'CANCELLED'",
        partId,
      );
      return {
        totalQuantity: sum(rs.map((r) => text(r.quantity))),
        totalAmount: sum(rs.map((r) => text(r.amount))),
        orderCount: new Set(rs.map((r) => String(r.id))).size,
      };
    },
    async sumAmountByType(from, to) {
      return rows(
        db,
        "SELECT type,amount FROM work_order_items i JOIN work_orders w ON w.id=i.work_order_id WHERE w.deleted_at IS NULL AND w.status <> 'CANCELLED' AND w.created_at BETWEEN ? AND ?",
        iso(from),
        iso(to),
      ).reduce<Array<{ type: WorkOrderItem["type"]; amount: ReturnType<typeof D> | null }>>(
        (groups, r) => {
          const found = groups.find((g) => g.type === itemTypeOf(r.type));
          if (found) found.amount = found.amount!.plus(D(String(r.amount)));
          else groups.push({ type: itemTypeOf(r.type), amount: D(String(r.amount)) });
          return groups;
        },
        [],
      );
    },
    async groupByName(type, from, to, limit) {
      const rs = rows(
        db,
        "SELECT i.name,i.quantity,i.amount FROM work_order_items i JOIN work_orders w ON w.id=i.work_order_id WHERE i.type=? AND w.deleted_at IS NULL AND w.status <> 'CANCELLED' AND w.created_at BETWEEN ? AND ?",
        type,
        iso(from),
        iso(to),
      );
      const grouped = new Map<
        string,
        { quantity: ReturnType<typeof D>; amount: ReturnType<typeof D>; count: number }
      >();
      for (const r of rs) {
        const key = String(r.name),
          g = grouped.get(key) ?? { quantity: D(0), amount: D(0), count: 0 };
        g.quantity = g.quantity.plus(D(String(r.quantity)));
        g.amount = g.amount.plus(D(String(r.amount)));
        g.count += 1;
        grouped.set(key, g);
      }
      return [...grouped.entries()]
        .sort((a, b) => b[1].amount.comparedTo(a[1].amount))
        .slice(0, limit)
        .map(([name, g]) => ({ name, ...g }));
    },
  };
}
