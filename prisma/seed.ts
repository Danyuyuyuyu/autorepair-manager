/**
 * 初始化数据（seed）
 * ---------------------------------------------------------------------------
 * 幂等：可重复执行，不会产生重复数据。
 * 内容：
 *   1. 管理员 / 员工账号
 *   2. 技师档案、供应商、分类
 *   3. 维修项目与工时目录
 *   4. 配件档案 + 期初库存（含库存流水）
 *   5. 示例客户 / 车辆 / 工单 / 收款 / 支出（便于首页与报表有数据可看）
 *
 * 运行：pnpm db:seed
 */
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

const DEC = (value: number | string) => String(value);

async function seedUsers() {
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin123456";
  const adminName = process.env.SEED_ADMIN_NAME ?? "店长";

  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    update: { role: "ADMIN", isActive: true, deletedAt: null },
    create: {
      username: adminUsername,
      name: adminName,
      role: "ADMIN",
      passwordHash: await hash(adminPassword, 10),
    },
  });

  const staff = await prisma.user.upsert({
    where: { username: "wangqiang" },
    update: {},
    create: {
      username: "wangqiang",
      name: "王强",
      role: "STAFF",
      phone: "13800138001",
      passwordHash: await hash("staff123456", 10),
    },
  });

  console.log(`✓ 账号：${admin.username} / ${staff.username}（默认密码见 .env）`);
  return { admin, staff };
}

async function seedEmployees(users: { admin: { id: string }; staff: { id: string } }) {
  const definitions = [
    { name: "王强", phone: "13800138001", position: "机修", userId: users.staff.id },
    { name: "李师傅", phone: "13800138002", position: "钣金喷漆", userId: null },
    { name: "刘师傅", phone: "13800138003", position: "电路诊断", userId: null },
  ];

  const employees = [];
  for (const definition of definitions) {
    const existing = await prisma.employee.findFirst({
      where: { name: definition.name, deletedAt: null },
    });
    if (existing) {
      employees.push(existing);
      continue;
    }
    employees.push(
      await prisma.employee.create({
        data: {
          name: definition.name,
          phone: definition.phone,
          position: definition.position,
          userId: definition.userId,
          isTechnician: true,
        },
      }),
    );
  }

  console.log(`✓ 技师档案 ${employees.length} 位`);
  return employees;
}

async function seedCategories() {
  const definitions = [
    { name: "机油保养", kind: "PART" as const, sortOrder: 1 },
    { name: "刹车系统", kind: "PART" as const, sortOrder: 2 },
    { name: "滤清器", kind: "PART" as const, sortOrder: 3 },
    { name: "电瓶电器", kind: "PART" as const, sortOrder: 4 },
    { name: "常规保养", kind: "SERVICE" as const, sortOrder: 1 },
    { name: "底盘维修", kind: "SERVICE" as const, sortOrder: 2 },
    { name: "发动机维修", kind: "SERVICE" as const, sortOrder: 3 },
    { name: "电气维修", kind: "SERVICE" as const, sortOrder: 4 },
  ];

  const result: Record<string, string> = {};
  for (const definition of definitions) {
    const record = await prisma.category.upsert({
      where: { kind_name: { kind: definition.kind, name: definition.name } },
      update: { sortOrder: definition.sortOrder },
      create: definition,
    });
    result[definition.name] = record.id;
  }

  console.log(`✓ 分类 ${definitions.length} 个`);
  return result;
}

async function seedSuppliers() {
  const definitions = [
    { name: "顺发汽配", contact: "陈老板", phone: "13900139001" },
    { name: "宏运机油总汇", contact: "李经理", phone: "13900139002" },
    { name: "正大刹车件", contact: "赵师傅", phone: "13900139003" },
  ];

  const suppliers = [];
  for (const definition of definitions) {
    const existing = await prisma.supplier.findFirst({
      where: { name: definition.name, deletedAt: null },
    });
    suppliers.push(
      existing ??
        (await prisma.supplier.create({
          data: { ...definition, address: "汽配城 A 区", isActive: true },
        })),
    );
  }

  console.log(`✓ 供应商 ${suppliers.length} 家`);
  return suppliers;
}

async function seedServiceItems(categories: Record<string, string>) {
  const definitions = [
    { name: "更换机油", kind: "SERVICE" as const, categoryName: "常规保养", price: 60, cost: 20 },
    {
      name: "更换机油机滤",
      kind: "SERVICE" as const,
      categoryName: "常规保养",
      price: 80,
      cost: 25,
    },
    { name: "四轮定位", kind: "SERVICE" as const, categoryName: "底盘维修", price: 120, cost: 40 },
    {
      name: "更换刹车片",
      kind: "SERVICE" as const,
      categoryName: "底盘维修",
      price: 100,
      cost: 35,
    },
    { name: "更换刹车油", kind: "SERVICE" as const, categoryName: "底盘维修", price: 90, cost: 30 },
    {
      name: "发动机故障诊断",
      kind: "SERVICE" as const,
      categoryName: "发动机维修",
      price: 150,
      cost: 60,
    },
    {
      name: "清洗节气门",
      kind: "SERVICE" as const,
      categoryName: "发动机维修",
      price: 120,
      cost: 45,
    },
    { name: "空调加氟", kind: "SERVICE" as const, categoryName: "电气维修", price: 130, cost: 50 },
    { name: "更换蓄电池", kind: "SERVICE" as const, categoryName: "电气维修", price: 50, cost: 15 },
    { name: "常规工时费", kind: "LABOR" as const, categoryName: "常规保养", price: 80, cost: 40 },
    { name: "钣金工时", kind: "LABOR" as const, categoryName: "底盘维修", price: 150, cost: 80 },
    { name: "喷漆工时", kind: "LABOR" as const, categoryName: "底盘维修", price: 200, cost: 110 },
  ];

  let created = 0;
  for (const definition of definitions) {
    const existing = await prisma.serviceItem.findFirst({
      where: { name: definition.name, deletedAt: null },
    });
    if (existing) continue;

    await prisma.serviceItem.create({
      data: {
        name: definition.name,
        kind: definition.kind,
        categoryId: categories[definition.categoryName] ?? null,
        unit: definition.kind === "LABOR" ? "小时" : "项",
        defaultPrice: DEC(definition.price),
        costPrice: DEC(definition.cost),
        isActive: true,
      },
    });
    created += 1;
  }

  console.log(`✓ 维修项目 ${created} 项（跳过已存在）`);
}

interface PartSeed {
  name: string;
  spec: string;
  brand: string;
  unit: string;
  categoryName: string;
  cost: number;
  sale: number;
  stock: number;
  safe: number;
  supplierIndex: number;
}

async function seedParts(categories: Record<string, string>, suppliers: { id: string }[]) {
  const definitions: PartSeed[] = [
    {
      name: "全合成机油",
      spec: "5W-40 4L",
      brand: "美孚",
      unit: "桶",
      categoryName: "机油保养",
      cost: 180,
      sale: 280,
      stock: 24,
      safe: 6,
      supplierIndex: 1,
    },
    {
      name: "半合成机油",
      spec: "10W-40 4L",
      brand: "壳牌",
      unit: "桶",
      categoryName: "机油保养",
      cost: 120,
      sale: 190,
      stock: 15,
      safe: 6,
      supplierIndex: 1,
    },
    {
      name: "机油滤清器",
      spec: "通用型",
      brand: "马勒",
      unit: "个",
      categoryName: "滤清器",
      cost: 25,
      sale: 55,
      stock: 40,
      safe: 10,
      supplierIndex: 0,
    },
    {
      name: "空气滤清器",
      spec: "通用型",
      brand: "马勒",
      unit: "个",
      categoryName: "滤清器",
      cost: 35,
      sale: 70,
      stock: 28,
      safe: 10,
      supplierIndex: 0,
    },
    {
      name: "空调滤清器",
      spec: "活性炭",
      brand: "曼牌",
      unit: "个",
      categoryName: "滤清器",
      cost: 45,
      sale: 90,
      stock: 18,
      safe: 8,
      supplierIndex: 0,
    },
    {
      name: "前刹车片",
      spec: "陶瓷配方",
      brand: "博世",
      unit: "副",
      categoryName: "刹车系统",
      cost: 160,
      sale: 280,
      stock: 12,
      safe: 4,
      supplierIndex: 2,
    },
    {
      name: "后刹车片",
      spec: "陶瓷配方",
      brand: "博世",
      unit: "副",
      categoryName: "刹车系统",
      cost: 140,
      sale: 250,
      stock: 3,
      safe: 4,
      supplierIndex: 2,
    },
    {
      name: "刹车油",
      spec: "DOT4 1L",
      brand: "博世",
      unit: "瓶",
      categoryName: "刹车系统",
      cost: 45,
      sale: 90,
      stock: 20,
      safe: 6,
      supplierIndex: 2,
    },
    {
      name: "蓄电池",
      spec: "55D23L",
      brand: "瓦尔塔",
      unit: "个",
      categoryName: "电瓶电器",
      cost: 320,
      sale: 480,
      stock: 6,
      safe: 3,
      supplierIndex: 0,
    },
    {
      name: "火花塞",
      spec: "铱金",
      brand: "NGK",
      unit: "个",
      categoryName: "电瓶电器",
      cost: 45,
      sale: 85,
      stock: 32,
      safe: 8,
      supplierIndex: 0,
    },
    {
      name: "雨刮片",
      spec: "24 寸",
      brand: "博世",
      unit: "条",
      categoryName: "电瓶电器",
      cost: 35,
      sale: 70,
      stock: 2,
      safe: 6,
      supplierIndex: 0,
    },
    {
      name: "防冻液",
      spec: "-35℃ 4L",
      brand: "壳牌",
      unit: "桶",
      categoryName: "机油保养",
      cost: 55,
      sale: 110,
      stock: 14,
      safe: 4,
      supplierIndex: 1,
    },
  ];

  let created = 0;

  for (const definition of definitions) {
    const existing = await prisma.part.findFirst({
      where: { name: definition.name, spec: definition.spec, deletedAt: null },
    });
    if (existing) continue;

    await prisma.$transaction(async (tx) => {
      const part = await tx.part.create({
        data: {
          name: definition.name,
          spec: definition.spec,
          brand: definition.brand,
          unit: definition.unit,
          categoryId: categories[definition.categoryName] ?? null,
          supplierId: suppliers[definition.supplierIndex]?.id ?? null,
          costPrice: DEC(definition.cost),
          salePrice: DEC(definition.sale),
          isActive: true,
        },
      });

      await tx.inventory.create({
        data: {
          partId: part.id,
          quantity: DEC(definition.stock),
          safeQuantity: DEC(definition.safe),
          avgCost: DEC(definition.cost),
        },
      });

      await tx.inventoryTransaction.create({
        data: {
          partId: part.id,
          type: "PURCHASE_IN",
          quantity: DEC(definition.stock),
          qtyBefore: DEC(0),
          qtyAfter: DEC(definition.stock),
          unitCost: DEC(definition.cost),
          amount: DEC(definition.stock * definition.cost),
          remark: "建档期初库存",
        },
      });
    });

    created += 1;
  }

  console.log(`✓ 配件 ${created} 种（含期初库存与流水，跳过已存在）`);
}

async function seedDemoBusiness(employees: { id: string; name: string }[], adminId: string) {
  const existingOrders = await prisma.workOrder.count();
  if (existingOrders > 0) {
    console.log("✓ 已存在工单数据，跳过示例业务数据");
    return;
  }

  const customersSeed = [
    {
      name: "张伟",
      phone: "13700137001",
      wechat: "zhangwei_wx",
      plate: "粤A12345",
      brand: "大众",
      model: "朗逸",
      year: 2019,
      mileage: 68000,
    },
    {
      name: "李娜",
      phone: "13700137002",
      wechat: "lina0420",
      plate: "粤B88888",
      brand: "丰田",
      model: "卡罗拉",
      year: 2021,
      mileage: 32000,
    },
    {
      name: "陈建国",
      phone: "13700137003",
      wechat: null,
      plate: "粤C66666",
      brand: "本田",
      model: "雅阁",
      year: 2017,
      mileage: 112000,
    },
    {
      name: "周敏",
      phone: "13700137004",
      wechat: "zhoumin",
      plate: "粤D34567",
      brand: "比亚迪",
      model: "秦 PLUS",
      year: 2023,
      mileage: 15000,
    },
    {
      name: "吴桂芳",
      phone: "13700137005",
      wechat: null,
      plate: "粤E23456",
      brand: "日产",
      model: "轩逸",
      year: 2018,
      mileage: 89000,
    },
  ];

  const createdCustomers = [];
  for (const seed of customersSeed) {
    const customer = await prisma.customer.create({
      data: {
        name: seed.name,
        phone: seed.phone,
        wechat: seed.wechat,
        address: "广东省广州市天河区",
        createdBy: adminId,
      },
    });

    const vehicle = await prisma.vehicle.create({
      data: {
        customerId: customer.id,
        plateNumber: seed.plate,
        brand: seed.brand,
        model: seed.model,
        year: seed.year,
        currentMileage: seed.mileage,
        vin: `LSV${Math.random().toString(36).slice(2, 14).toUpperCase()}`,
        lastServiceAt: new Date(Date.now() - 90 * 86400000),
        nextServiceAt: new Date(Date.now() + 30 * 86400000),
      },
    });

    createdCustomers.push({ customer, vehicle });
  }

  const parts = await prisma.part.findMany({
    select: { id: true, name: true, unit: true, salePrice: true, costPrice: true },
    take: 6,
  });
  const services = await prisma.serviceItem.findMany({
    select: { id: true, name: true, unit: true, defaultPrice: true, costPrice: true, kind: true },
    take: 5,
  });

  const statuses = [
    "PENDING_INTAKE",
    "IN_PROGRESS",
    "PENDING_QC",
    "PENDING_PAYMENT",
    "COMPLETED",
    "COMPLETED",
  ] as const;
  const methods = ["WECHAT", "ALIPAY", "CASH", "BANK_CARD"] as const;

  let seq = 0;
  for (let index = 0; index < createdCustomers.length; index += 1) {
    const entry = createdCustomers[index]!;
    const status = statuses[index % statuses.length]!;
    seq += 1;

    const date = new Date();
    date.setDate(date.getDate() - (5 - index));
    date.setHours(10 + index, 20, 0, 0);

    const orderNo = `RO${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
      date.getDate(),
    ).padStart(2, "0")}${String(seq).padStart(3, "0")}`;

    const service = services[index % services.length]!;
    const part = parts[index % parts.length]!;

    const serviceAmount = Number(service.defaultPrice);
    const partAmount = Number(part.salePrice);
    const total = serviceAmount + partAmount;
    const paid =
      status === "COMPLETED" ? total : index === 3 ? 0 : Math.round(total * 0.5 * 100) / 100;

    const order = await prisma.workOrder.create({
      data: {
        orderNo,
        status,
        customerId: entry.customer.id,
        vehicleId: entry.vehicle.id,
        mileage: entry.vehicle.currentMileage,
        faultDescription: [
          "踩刹车有异响",
          "怠速不稳，加速无力",
          "空调不制冷",
          "保养到期",
          "打不着火",
          "方向盘抖动",
        ][index % 6],
        technicianId: employees[index % employees.length]?.id ?? null,
        createdBy: adminId,
        serviceAmount: DEC(serviceAmount),
        partsAmount: DEC(partAmount),
        totalAmount: DEC(total),
        partsCost: DEC(Number(part.costPrice)),
        paidAmount: DEC(paid),
        completedAt: status === "COMPLETED" ? date : null,
        createdAt: date,
        updatedAt: date,
      },
    });

    await prisma.workOrderItem.createMany({
      data: [
        {
          workOrderId: order.id,
          type: service.kind,
          itemRefId: service.id,
          name: service.name,
          unit: service.unit,
          quantity: DEC(1),
          unitPrice: service.defaultPrice,
          costPrice: service.costPrice,
          amount: DEC(serviceAmount),
          sortOrder: 0,
        },
        {
          workOrderId: order.id,
          type: "PART",
          itemRefId: part.id,
          name: part.name,
          unit: part.unit,
          quantity: DEC(1),
          unitPrice: part.salePrice,
          costPrice: part.costPrice,
          amount: DEC(partAmount),
          sortOrder: 1,
        },
      ],
    });

    if (paid > 0) {
      await prisma.payment.create({
        data: {
          workOrderId: order.id,
          customerId: entry.customer.id,
          source: "WORK_ORDER",
          category: "REPAIR_SERVICE",
          amount: DEC(paid),
          method: methods[index % methods.length]!,
          occurredAt: date,
          operatorId: adminId,
          remark: paid < total ? "部分收款" : null,
        },
      });
    }
  }

  // 店铺支出
  const expenseSeed = [
    { category: "RENT" as const, amount: 8000, remark: "9 月店面租金" },
    { category: "UTILITY" as const, amount: 1250.5, remark: "8 月水电费" },
    { category: "SALARY" as const, amount: 18000, remark: "8 月员工工资" },
    { category: "PART_PURCHASE" as const, amount: 6800, remark: "月初配件补货" },
    { category: "TOOL_EQUIPMENT" as const, amount: 2300, remark: "新购扭力扳手" },
  ];

  for (const [index, seed] of expenseSeed.entries()) {
    const date = new Date();
    date.setDate(date.getDate() - (index + 1) * 2);
    await prisma.expense.create({
      data: {
        category: seed.category,
        amount: DEC(seed.amount),
        method: "BANK_CARD",
        occurredAt: date,
        operatorId: adminId,
        remark: seed.remark,
      },
    });
  }

  console.log(
    `✓ 示例业务数据：${createdCustomers.length} 位客户 / ${createdCustomers.length} 台车 / 6 张工单 / 5 笔支出`,
  );
}

async function main() {
  console.log("开始初始化数据…\n");

  const users = await seedUsers();
  const employees = await seedEmployees(users);
  const categories = await seedCategories();
  const suppliers = await seedSuppliers();

  await seedServiceItems(categories);
  await seedParts(categories, suppliers);
  await seedDemoBusiness(employees, users.admin.id);

  console.log("\n初始化完成。");
  console.log(
    `管理员：${users.admin.username} / ${process.env.SEED_ADMIN_PASSWORD ?? "admin123456"}`,
  );
  console.log("普通员工：wangqiang / staff123456");
}

main()
  .catch((error) => {
    console.error("初始化失败：", error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
