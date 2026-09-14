import assert from "node:assert/strict";
import type { SQLInputValue } from "node:sqlite";

import type { VehicleRepository } from "@/domain/repositories";
import { prisma } from "@/server/db";
import { createRepositories } from "@/server/repos/prisma";
import { createMemoryDb } from "@/server/repos/sqlite/client";
import { createSqliteRepositories } from "@/server/repos/sqlite/factory";
import { newId } from "@/server/repos/sqlite/id";

interface VehicleMeta {
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

interface OrderInput {
  customerId: string;
  vehicleId: string;
  orderNo: string;
  status: "PENDING_INTAKE" | "COMPLETED";
  createdAt: Date;
  deletedAt?: Date | null;
}

interface ContractHarness {
  name: "PostgreSQL" | "SQLite";
  vehicle: VehicleRepository;
  createCustomer(name: string, phone: string): Promise<string>;
  createOrder(input: OrderInput): Promise<string>;
  setVehicleMeta(id: string, meta: VehicleMeta): Promise<void>;
  cleanup(): Promise<void>;
}

interface VehicleSnapshot {
  pageNames: string[];
  listByCustomer: string[];
  detail: {
    brand: string | null;
    model: string | null;
    year: number | null;
    vin: string | null;
    engineNo: string | null;
    currentMileage: number | null;
    lastServiceAt: string | null;
    nextServiceAt: string | null;
    remark: string | null;
  };
  searchKinds: Array<string | null>;
  globalEmpty: string[];
  suggestTargetPlates: string[];
  dueTargetOrder: string[];
  serviceRecords: Array<{ description: string; orderNo: string | null }>;
  deleteRelationCount: number;
  historyVisibleAfterDelete: boolean;
  postCascadeVisible: boolean;
}

let passed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  assert.ok(condition, `${label}${detail ? `：${detail}` : ""}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function expectError(
  label: string,
  constructorName: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
    check(label, false, `应抛出 ${constructorName}`);
  } catch (error) {
    check(label, (error as object).constructor.name === constructorName);
  }
}

async function runContract(harness: ContractHarness, prefix: string): Promise<VehicleSnapshot> {
  console.log(`\n【${harness.name} vehicle contract】`);
  const dates = {
    first: new Date("2097-02-01T00:00:00.000Z"),
    second: new Date("2097-02-02T00:00:00.000Z"),
    third: new Date("2097-02-03T00:00:00.000Z"),
    fourth: new Date("2097-02-04T00:00:00.000Z"),
    fifth: new Date("2097-02-05T00:00:00.000Z"),
    serviceOne: new Date("2097-02-10T00:00:00.000Z"),
    serviceTwo: new Date("2097-02-11T00:00:00.000Z"),
  };

  try {
    const customerA = await harness.createCustomer("车辆契约甲", `${prefix}01`);
    const customerB = await harness.createCustomer("车辆契约乙", `${prefix}02`);
    const primary = await harness.vehicle.create({
      customerId: customerA,
      plateNumber: "粤V10001",
      brand: "Toyota",
      model: "Corolla",
      year: 2020,
      vin: "VIN-ALPHA",
      engineNo: "ENG-ALPHA",
      currentMileage: 12000,
      lastServiceAt: dates.first,
      nextServiceAt: new Date("2097-02-12T00:00:00.000Z"),
      remark: null,
    });
    const secondary = await harness.vehicle.create({
      customerId: customerA,
      plateNumber: "粤V10002",
      brand: "Honda",
      model: "Civic",
      vin: null,
      currentMileage: null,
      lastServiceAt: null,
      nextServiceAt: null,
      remark: "second vehicle",
    });
    const otherCustomerVehicle = await harness.vehicle.create({
      customerId: customerB,
      plateNumber: "粤V20001",
      brand: "BYD",
      model: "海豹",
      vin: "VIN-BETA",
      nextServiceAt: new Date("2097-02-10T00:00:00.000Z"),
    });
    const deleted = await harness.vehicle.create({
      customerId: customerA,
      plateNumber: "粤VDELETED",
      brand: "Deleted",
      model: "Vehicle",
    });

    await harness.setVehicleMeta(primary.id, { createdAt: dates.first, updatedAt: dates.fifth });
    await harness.setVehicleMeta(secondary.id, {
      createdAt: dates.second,
      updatedAt: dates.fourth,
    });
    await harness.setVehicleMeta(otherCustomerVehicle.id, {
      createdAt: dates.third,
      updatedAt: dates.third,
    });
    await harness.setVehicleMeta(deleted.id, {
      createdAt: dates.fourth,
      updatedAt: dates.fifth,
      deletedAt: dates.fifth,
    });

    await harness.vehicle.update(primary.id, {
      customerId: customerA,
      plateNumber: "粤V10001",
      brand: "Toyota Updated",
      model: "Corolla X",
      year: 2024,
      vin: "VIN-UPDATED",
      engineNo: "ENG-UPDATED",
      currentMileage: 12345,
      lastServiceAt: new Date("2097-02-06T00:00:00.000Z"),
      nextServiceAt: new Date("2097-02-12T00:00:00.000Z"),
      remark: "updated remark",
    });
    await harness.setVehicleMeta(primary.id, { createdAt: dates.first, updatedAt: dates.fifth });

    const activeOrderId = await harness.createOrder({
      customerId: customerA,
      vehicleId: primary.id,
      orderNo: `${prefix}-ACTIVE`,
      status: "COMPLETED",
      createdAt: dates.first,
    });
    await harness.createOrder({
      customerId: customerA,
      vehicleId: primary.id,
      orderNo: `${prefix}-DELETED-ORDER`,
      status: "PENDING_INTAKE",
      createdAt: dates.second,
      deletedAt: dates.fifth,
    });
    const record = await harness.vehicle.createServiceRecord({
      vehicleId: primary.id,
      workOrderId: activeOrderId,
      servicedAt: dates.serviceOne,
      mileage: 12345,
      description: "更换机油",
      nextServiceAt: new Date("2097-08-01T00:00:00.000Z"),
      nextServiceMileage: 18000,
      createdBy: null,
    });
    await harness.vehicle.createServiceRecord({
      vehicleId: primary.id,
      servicedAt: dates.serviceTwo,
      mileage: null,
      description: "轮胎检查",
      nextServiceAt: null,
      nextServiceMileage: null,
      createdBy: null,
    });

    check(
      `${harness.name} create 返回 ID/车牌`,
      primary.id.length > 0 && primary.plateNumber === "粤V10001",
    );
    const detail = await harness.vehicle.findDetailBaseById(primary.id);
    check(
      `${harness.name} 详情字段/nullable/Date round-trip`,
      detail?.brand === "Toyota Updated" &&
        detail.model === "Corolla X" &&
        detail.year === 2024 &&
        detail.vin === "VIN-UPDATED" &&
        detail.engineNo === "ENG-UPDATED" &&
        detail.currentMileage === 12345 &&
        detail.lastServiceAt?.toISOString() === "2097-02-06T00:00:00.000Z" &&
        detail.nextServiceAt?.toISOString() === "2097-02-12T00:00:00.000Z" &&
        detail.remark === "updated remark",
    );
    check(
      `${harness.name} 车牌精确匹配大小写敏感且支持排除自身`,
      (await harness.vehicle.findIdByPlate("粤V10001"))?.id === primary.id &&
        (await harness.vehicle.findIdByPlate("粤v10001")) === null &&
        (await harness.vehicle.findDetailBaseByPlate("粤V10001", primary.id)) === null,
    );
    check(
      `${harness.name} findForEdit 与 customer 关联`,
      (await harness.vehicle.findForEdit(primary.id))?.customerId === customerA,
    );

    await harness.vehicle.reassignToCustomer(primary.id, customerB);
    check(
      `${harness.name} reassignToCustomer 生效`,
      (await harness.vehicle.findForEdit(primary.id))?.customerId === customerB,
    );
    await harness.vehicle.reassignToCustomer(primary.id, customerA);
    await harness.setVehicleMeta(primary.id, { createdAt: dates.first, updatedAt: dates.fifth });

    const page = await harness.vehicle.list({ customerId: customerA }, { skip: 1, take: 1 });
    check(`${harness.name} 客户筛选/分页/active 总数`, page.total === 2 && page.rows.length === 1);
    check(`${harness.name} updatedAt 倒序`, page.rows[0]?.plateNumber === "粤V10002");
    check(
      `${harness.name} customer/VehicleListRow 形状`,
      page.rows[0]?.customer.name === "车辆契约甲" &&
        page.rows[0]?.customer.phone === `${prefix}01`,
    );
    check(
      `${harness.name} 已删除车辆普通列表隐藏`,
      (await harness.vehicle.list({ customerId: customerA }, { skip: 0, take: 20 })).total === 2,
    );
    check(
      `${harness.name} VIN 模糊搜索`,
      (await harness.vehicle.list({ keyword: "vin-updated" }, { skip: 0, take: 20 })).rows[0]
        ?.id === primary.id,
    );
    check(
      `${harness.name} 品牌/型号/客户姓名/手机号搜索`,
      (await harness.vehicle.list({ keyword: "TOYOTA UPDATED" }, { skip: 0, take: 20 })).rows[0]
        ?.id === primary.id &&
        (await harness.vehicle.list({ keyword: "corolla x" }, { skip: 0, take: 20 })).rows[0]
          ?.id === primary.id &&
        (await harness.vehicle.list({ keyword: "车辆契约甲" }, { skip: 0, take: 20 })).rows.some(
          (row) => row.id === primary.id,
        ) &&
        (
          await harness.vehicle.list({ keyword: prefix.slice(-5) }, { skip: 0, take: 20 })
        ).rows.some((row) => row.id === primary.id),
    );
    check(
      `${harness.name} 车牌搜索大小写不敏感`,
      (await harness.vehicle.list({ keyword: "粤v10001" }, { skip: 0, take: 20 })).rows[0]?.id ===
        primary.id,
    );
    check(
      `${harness.name} SQL 输入使用绑定参数`,
      (await harness.vehicle.list({ keyword: "%' OR 1=1 --" }, { skip: 0, take: 20 })).total === 0,
    );
    check(
      `${harness.name} 临近保养截止日期`,
      (
        await harness.vehicle.list(
          { customerId: customerA, dueServiceBefore: new Date("2097-02-13T00:00:00.000Z") },
          { skip: 0, take: 20 },
        )
      ).rows.some((row) => row.id === primary.id),
    );

    const byCustomer = await harness.vehicle.listByCustomer(customerA);
    check(
      `${harness.name} listByCustomer createdAt 倒序且过滤软删`,
      byCustomer.map((row) => row.plateNumber).join(",") === "粤V10002,粤V10001",
    );
    const due = await harness.vehicle.listDueService(new Date("2097-02-13T00:00:00.000Z"), 1000);
    const targetDue = due.filter(
      (row) => row.id === primary.id || row.id === otherCustomerVehicle.id,
    );
    check(
      `${harness.name} listDueService Date/排序`,
      targetDue.map((row) => row.id).join(",") === `${otherCustomerVehicle.id},${primary.id}` &&
        targetDue.every((row) => row.nextServiceAt instanceof Date),
    );

    const serviceRecords = await harness.vehicle.listServiceRecords(primary.id, 10);
    check(
      `${harness.name} 保养记录排序/nullable/工单关系`,
      serviceRecords.length === 2 &&
        serviceRecords[0]?.description === "轮胎检查" &&
        serviceRecords[0]?.nextServiceAt === null &&
        serviceRecords[0]?.workOrder === null &&
        serviceRecords[1]?.description === "更换机油" &&
        serviceRecords[1]?.workOrder?.orderNo === `${prefix}-ACTIVE` &&
        serviceRecords[1]?.servicedAt instanceof Date,
    );
    check(`${harness.name} createServiceRecord 返回 Date`, record.createdAt instanceof Date);
    await harness.vehicle.detachServiceRecordsFromWorkOrder(activeOrderId);
    check(
      `${harness.name} detachServiceRecordsFromWorkOrder`,
      (await harness.vehicle.listServiceRecords(primary.id, 10)).find(
        (row) => row.description === "更换机油",
      )?.workOrder === null,
    );

    await harness.vehicle.updateServiceInfo(primary.id, {
      currentMileage: 13000,
      lastServiceAt: new Date("2097-02-07T00:00:00.000Z"),
      nextServiceAt: new Date("2097-02-14T00:00:00.000Z"),
    });
    check(
      `${harness.name} updateServiceInfo`,
      (await harness.vehicle.findDetailBaseById(primary.id))?.currentMileage === 13000 &&
        (await harness.vehicle.findDetailBaseById(primary.id))?.lastServiceAt?.toISOString() ===
          "2097-02-07T00:00:00.000Z",
    );
    await harness.setVehicleMeta(primary.id, { createdAt: dates.first, updatedAt: dates.fifth });

    const deleteView = await harness.vehicle.findForDelete(primary.id);
    check(`${harness.name} findForDelete 保留历史工单计数`, deleteView?.workOrderCount === 2);
    await harness.vehicle.softDelete(secondary.id);
    check(
      `${harness.name} soft delete 后 edit/list/plate 隐藏`,
      (await harness.vehicle.findForEdit(secondary.id)) === null &&
        (await harness.vehicle.findDetailBaseById(secondary.id)) === null &&
        (await harness.vehicle.findIdByPlate("粤V10002")) === null &&
        !(await harness.vehicle.listByCustomer(customerA)).some((row) => row.id === secondary.id),
    );

    const globalBrand = await harness.vehicle.searchForGlobal("TOYOTA UPDATED", 20);
    const globalVin = await harness.vehicle.searchForGlobal("vin-updated", 20);
    const globalModel = await harness.vehicle.searchForGlobal("corolla x", 20);
    check(
      `${harness.name} global 搜索车牌/VIN/品牌/型号`,
      globalBrand[0]?.id === primary.id &&
        globalVin[0]?.id === primary.id &&
        globalModel[0]?.id === primary.id &&
        globalBrand[0]?.customerName === "车辆契约甲",
    );
    const globalEmpty = await harness.vehicle.searchForGlobal("", 2);
    check(
      `${harness.name} global 空查询 updatedAt 排序与 limit`,
      globalEmpty.length === 2 && globalEmpty[0]?.id === primary.id,
    );
    const suggestions = await harness.vehicle.suggestByPlate("v100", 20);
    check(
      `${harness.name} 车牌 suggest 大小写/limit/软删过滤`,
      suggestions.length === 1 &&
        suggestions[0]?.plateNumber === "粤V10001" &&
        suggestions[0]?.customerName === "车辆契约甲",
    );
    const suggestEmpty = await harness.vehicle.suggestByPlate("", 2);
    check(`${harness.name} suggest 空查询尊重 limit`, suggestEmpty.length === 2);

    await harness.vehicle.softDelete(primary.id);
    const historyAfterDelete = await harness.vehicle.listServiceRecords(primary.id, 10);
    check(
      `${harness.name} 软删车辆隐藏普通查询但保留历史关系`,
      (await harness.vehicle.findDetailBaseById(primary.id)) === null &&
        (await harness.vehicle.searchForGlobal("TOYOTA UPDATED", 20)).length === 0 &&
        historyAfterDelete.length === 2,
    );
    await harness.vehicle.softDeleteByCustomer(customerB);
    check(
      `${harness.name} customer 级联软删车辆`,
      (await harness.vehicle.findDetailBaseById(otherCustomerVehicle.id)) === null,
    );
    const duplicate = await harness.vehicle.create({
      customerId: customerA,
      plateNumber: "粤V10001",
      vin: "VIN-UPDATED",
    });
    check(
      `${harness.name} 车牌/VIN 无数据库 UNIQUE（重复校验归 service）`,
      duplicate.id !== primary.id,
    );
    await harness.vehicle.softDelete(duplicate.id);
    await expectError(`${harness.name} update 缺失行翻译 NotFound`, "NotFoundError", () =>
      harness.vehicle.update("missing-vehicle", {
        customerId: customerA,
        plateNumber: "missing",
        brand: null,
        model: null,
        year: null,
        vin: null,
        engineNo: null,
        currentMileage: null,
        lastServiceAt: null,
        nextServiceAt: null,
        remark: null,
      }),
    );

    const serviceSnapshot = serviceRecords.map((row) => ({
      description: row.description,
      orderNo: row.workOrder?.orderNo ?? null,
    }));
    return {
      pageNames: page.rows.map((row) => row.plateNumber),
      listByCustomer: byCustomer.map((row) => row.plateNumber),
      detail: {
        brand: detail!.brand,
        model: detail!.model,
        year: detail!.year,
        vin: detail!.vin,
        engineNo: detail!.engineNo,
        currentMileage: detail!.currentMileage,
        lastServiceAt: detail!.lastServiceAt?.toISOString() ?? null,
        nextServiceAt: detail!.nextServiceAt?.toISOString() ?? null,
        remark: detail!.remark,
      },
      searchKinds: [globalBrand[0]!.brand, globalBrand[0]!.model, globalBrand[0]!.customerName],
      globalEmpty: globalEmpty.map((row) => row.plateNumber),
      suggestTargetPlates: suggestions.map((row) => row.plateNumber),
      dueTargetOrder: targetDue.map((row) => row.plateNumber),
      serviceRecords: serviceSnapshot,
      deleteRelationCount: deleteView!.workOrderCount,
      historyVisibleAfterDelete: historyAfterDelete.length === 2,
      postCascadeVisible:
        (await harness.vehicle.findDetailBaseById(otherCustomerVehicle.id)) !== null,
    };
  } finally {
    await harness.cleanup();
  }
}

function createSqliteHarness(): ContractHarness {
  const db = createMemoryDb();
  const repos = createSqliteRepositories(db);
  const execute = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);
  return {
    name: "SQLite",
    vehicle: repos.vehicle,
    async createCustomer(name, phone) {
      const id = newId();
      const now = new Date().toISOString();
      execute(
        "INSERT INTO customers (id,name,phone,created_at,updated_at) VALUES (?,?,?,?,?)",
        id,
        name,
        phone,
        now,
        now,
      );
      return id;
    },
    async createOrder(input) {
      const id = newId();
      const createdAt = input.createdAt.toISOString();
      execute(
        `INSERT INTO work_orders
           (id,order_no,status,customer_id,vehicle_id,created_at,updated_at,deleted_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        id,
        input.orderNo,
        input.status,
        input.customerId,
        input.vehicleId,
        createdAt,
        createdAt,
        input.deletedAt?.toISOString() ?? null,
      );
      return id;
    },
    async setVehicleMeta(id, meta) {
      execute(
        "UPDATE vehicles SET created_at=?, updated_at=?, deleted_at=? WHERE id=?",
        meta.createdAt.toISOString(),
        meta.updatedAt.toISOString(),
        meta.deletedAt?.toISOString() ?? null,
        id,
      );
    },
    async cleanup() {
      db.close();
    },
  };
}

function createPostgresHarness(prefix: string): ContractHarness {
  const repos = createRepositories(prisma);
  const customerIds: string[] = [];
  return {
    name: "PostgreSQL",
    vehicle: repos.vehicle,
    async createCustomer(name, phone) {
      const customer = await prisma.customer.create({ data: { name, phone } });
      customerIds.push(customer.id);
      return customer.id;
    },
    async createOrder(input) {
      const order = await prisma.workOrder.create({
        data: {
          orderNo: input.orderNo,
          status: input.status,
          customerId: input.customerId,
          vehicleId: input.vehicleId,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          deletedAt: input.deletedAt ?? null,
        },
      });
      return order.id;
    },
    async setVehicleMeta(id, meta) {
      await prisma.vehicle.update({
        where: { id },
        data: {
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          deletedAt: meta.deletedAt ?? null,
        },
      });
    },
    async cleanup() {
      await prisma.workOrder.deleteMany({ where: { orderNo: { startsWith: prefix } } });
      if (customerIds.length > 0) {
        await prisma.vehicle.deleteMany({ where: { customerId: { in: customerIds } } });
        await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      }
    },
  };
}

function checkFactoryFailFast(): void {
  const db = createMemoryDb();
  try {
    const repos = createSqliteRepositories(db);
    check("SQLite Factory 装配真实 customer/vehicle", typeof repos.vehicle.list === "function");
    check(
      "SQLite Factory 装配真实 audit",
      typeof repos.audit.append === "function" && typeof repos.audit.list === "function",
    );
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const prefix = `VH${Date.now()}`;
  const target = process.env.CONTRACT_BACKEND;
  let sqlite: VehicleSnapshot | undefined;
  let postgres: VehicleSnapshot | undefined;
  if (target !== "postgres") {
    sqlite = await runContract(createSqliteHarness(), prefix);
    checkFactoryFailFast();
  }
  if (target !== "sqlite") postgres = await runContract(createPostgresHarness(prefix), prefix);
  if (sqlite && postgres) {
    console.log("\nPostgreSQL Vehicle snapshot:", JSON.stringify(postgres, null, 2));
    console.log("SQLite Vehicle snapshot:", JSON.stringify(sqlite, null, 2));
    assert.deepEqual(postgres, sqlite, "PostgreSQL 与 SQLite vehicle contract 结果不一致");
    passed += 1;
    console.log("\n  ✓ PostgreSQL / SQLite Vehicle 语义快照完全一致");
  }
  console.log(`\nvehicle Repository contract：通过 ${passed} 项，失败 0 项`);
}

main()
  .catch((error) => {
    console.error("\nvehicle Repository contract 失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
