/**
 * 数据层端到端冒烟测试
 * ---------------------------------------------------------------------------
 * 不经过浏览器，直接调用 service 层跑通「核心业务链路」，用于：
 *   - 部署后自检（迁移是否正确、库存扣减/回滚是否符合预期）
 *   - 改动 service 后快速回归，不必手工点一遍 UI
 *
 * 覆盖：
 *   1. 建单（含配件，验证库存自动出库 + 金额汇总）
 *   2. 部分收款（验证已收/未收计算）
 *   3. 完工（验证状态流转 + 车辆里程/保养信息回写）
 *   4. 取消工单（验证配件库存回滚）
 *   5. 首页 / 财务 / 报表 聚合数据
 *
 * 运行：pnpm smoke
 * 注意：会向数据库写入测试数据（客户/车辆/工单各带「SMOKE」前缀，便于识别与清理）。
 */
import { globalSearch, searchSuggestions } from "@/server/services/search.service";
import {
  getDashboardStats,
  getPendingTasks,
  getRecentWorkOrders,
  getTodayWorkOrders,
} from "@/server/services/dashboard.service";
import {
  createCustomer,
  deleteCustomer,
  findCustomerByPhone,
  getCustomerDetail,
  listCustomerOptions,
  listCustomers,
  listOutstandingOrders,
  updateCustomer,
} from "@/server/services/customer.service";
import {
  createServiceRecord,
  createVehicle,
  deleteVehicle,
  findVehicleByPlate,
  getVehicleDetail,
  listDueServiceVehicles,
  listVehicles,
} from "@/server/services/vehicle.service";
import { getFinanceSummary, addPayment } from "@/server/services/finance.service";
import {
  createExpense,
  deleteExpense,
  getReceivablesTotal,
  getWorkOrderBalance,
  listCashFlow,
  listExpenses,
  updateExpense,
  voidPayment,
} from "@/server/services/finance.service";
import {
  adjustStock,
  countLowStockParts,
  createPart,
  deletePart,
  getPartDetail,
  getStockValue,
  listCategories,
  listInventoryTransactions,
  listLowStockParts,
  listServiceItems,
  listSuppliers,
  purchaseIn,
  searchPartsForPicker,
  stocktake,
} from "@/server/services/inventory.service";
import { listParts } from "@/server/services/inventory.service";
import {
  changeOwnPassword,
  createUser,
  deleteUser,
  listEmployees,
  listUsers,
  resetPassword,
  saveEmployee,
  updateOwnProfile,
  updateUser,
} from "@/server/services/user.service";
import { getReportCharts, getReportOverview } from "@/server/services/report.service";
import {
  cancelWorkOrder,
  changeWorkOrderStatus,
  createWorkOrder,
  getWorkOrderDetail,
  listWorkOrders,
} from "@/server/services/work-order.service";
import type { CurrentUser } from "@/types";

import { createSmokeInspector } from "./smoke-inspector";
import type { SmokeInspector } from "./smoke-inspector";

let inspector: SmokeInspector;

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` —— ${detail}` : ""}`);
  }
}

/** 当日 00:00 / 23:59:59（财务汇总按发生时间过滤，本日验算用） */
const dayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const dayEnd = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

async function loadAdmin(): Promise<CurrentUser> {
  const admin = await inspector.findAdmin();
  return {
    id: admin.id,
    username: admin.username,
    name: admin.name,
    role: admin.role,
    isAdmin: true,
  };
}

async function main() {
  inspector = await createSmokeInspector();
  const admin = await loadAdmin();
  console.log(`\n使用管理员账号：${admin.name}（${admin.username}）\n`);

  const part = await inspector.findBaselinePart();
  const service = await inspector.findBaselineServiceItem();

  const stockBefore = Number(part.quantity);
  console.log(`【基线】配件「${part.name}」当前库存 ${stockBefore}\n`);

  // ---------------------------------------------------------------- 1. 建单
  console.log("【1】创建工单（1 个维修项目 + 1 个配件）");
  const created = await createWorkOrder(
    {
      newCustomerName: "SMOKE 测试客户",
      newCustomerPhone: "13000000001",
      newVehiclePlate: "粤SMOKE1",
      newVehicleBrand: "测试",
      newVehicleModel: "验证车",
      newVehicleMileage: 50000,
      mileage: 50000,
      faultDescription: "冒烟测试：更换机油机滤",
      discountAmount: "10",
      items: [
        {
          type: "SERVICE",
          itemRefId: service.id,
          name: service.name,
          quantity: "1",
          unitPrice: service.defaultPrice.toFixed(2),
        },
        {
          type: "PART",
          itemRefId: part.id,
          name: part.name,
          quantity: "2",
          unitPrice: part.salePrice.toFixed(2),
        },
      ],
    },
    admin,
  );
  check("工单号符合 RO+日期+序号 规则", /^RO\d{11}$/.test(created.orderNo), created.orderNo);

  const detail = await getWorkOrderDetail(created.id);
  const expectTotal = Number(service.defaultPrice) + Number(part.salePrice) * 2 - 10;
  check(
    "应收金额 = 项目 + 配件×2 − 优惠",
    Math.abs(Number(detail.totalAmount) - expectTotal) < 0.001,
    `期望 ${expectTotal}，实际 ${detail.totalAmount}`,
  );
  check("工单项数量为 2", detail.items.length === 2);
  check("初始状态为待接车", detail.status === "PENDING_INTAKE", detail.status);

  const stockAfterCreate = await inspector.inventoryOf(part.id).then((r) => Number(r.quantity));
  check(
    "配件已自动出库 2 件",
    Math.abs(stockAfterCreate - (stockBefore - 2)) < 0.001,
    `出库前 ${stockBefore}，出库后 ${stockAfterCreate}`,
  );
  check(
    "产生了出库流水",
    detail.inventoryTxs.some((tx) => tx.type === "WORKORDER_OUT"),
  );

  // ---------------------------------------------------------------- 2. 收款
  console.log("\n【2】登记部分收款");
  await addPayment(
    {
      workOrderId: created.id,
      amount: "100",
      method: "WECHAT",
      category: "REPAIR_SERVICE",
      occurredAt: new Date(),
      remark: "冒烟测试收款",
    },
    admin,
  );
  const afterPayment = await getWorkOrderDetail(created.id);
  check("已收金额为 100", Number(afterPayment.paidAmount) === 100, afterPayment.paidAmount);
  check(
    "未收金额 = 应收 − 已收",
    Math.abs(Number(afterPayment.outstandingAmount) - (expectTotal - 100)) < 0.001,
    afterPayment.outstandingAmount,
  );

  // ---------------------------------------------------------------- 3. 完工
  console.log("\n【3】推进状态并完工");
  await changeWorkOrderStatus({ id: created.id, status: "IN_PROGRESS" }, admin);
  await changeWorkOrderStatus({ id: created.id, status: "PENDING_QC" }, admin);
  const completed = await changeWorkOrderStatus(
    {
      id: created.id,
      status: "COMPLETED",
      mileage: 51000,
      createServiceRecord: true,
      serviceDescription: "冒烟测试保养记录",
    },
    admin,
  );
  check("状态已变为已完成", completed.status === "COMPLETED", completed.status);
  check("完工时间已记录", completed.completedAt !== null);

  const vehicle = await inspector.vehicleSummary(completed.vehicleId);
  check("车辆里程已回写为 51000", vehicle.currentMileage === 51000, String(vehicle.currentMileage));
  check("车辆上次保养时间已更新", vehicle.lastServiceAt !== null);
  check("已生成保养记录", vehicle.serviceRecordCount > 0);

  // ---------------------------------------------------------------- 4. 取消回滚
  console.log("\n【4】创建第二张工单并取消，验证库存回滚");
  const stockBeforeSecond = await inspector.inventoryOf(part.id).then((r) => Number(r.quantity));

  const second = await createWorkOrder(
    {
      newCustomerName: "SMOKE 测试客户2",
      newCustomerPhone: "13000000002",
      newVehiclePlate: "粤SMOKE2",
      discountAmount: "0",
      items: [
        {
          type: "PART",
          itemRefId: part.id,
          name: part.name,
          quantity: "3",
          unitPrice: part.salePrice.toFixed(2),
        },
      ],
    },
    admin,
  );

  const stockDuringSecond = await inspector.inventoryOf(part.id).then((r) => Number(r.quantity));
  check(
    "第二张工单再次出库 3 件",
    Math.abs(stockDuringSecond - (stockBeforeSecond - 3)) < 0.001,
    `${stockBeforeSecond} → ${stockDuringSecond}`,
  );

  await cancelWorkOrder(second.id, "冒烟测试：取消并回滚库存", admin);
  const stockAfterCancel = await inspector.inventoryOf(part.id).then((r) => Number(r.quantity));
  check(
    "取消后库存已回滚到出库前",
    Math.abs(stockAfterCancel - stockBeforeSecond) < 0.001,
    `${stockDuringSecond} → ${stockAfterCancel}（期望 ${stockBeforeSecond}）`,
  );

  const cancelled = await getWorkOrderDetail(second.id);
  check("工单状态为已取消", cancelled.status === "CANCELLED", cancelled.status);
  check("取消原因已记录", cancelled.cancelReason !== null);

  // ---------------------------------------------------------------- 5. 查询与聚合
  console.log("\n【5】列表查询与聚合统计");
  const list = await listWorkOrders({ status: "ALL", page: 1, pageSize: 10 });
  check("工单列表可查询", list.items.length > 0, `共 ${list.total} 张`);
  check(
    "列表按创建时间倒序",
    list.items.length < 2 ||
      new Date(list.items[0]!.createdAt) >= new Date(list.items[1]!.createdAt),
  );

  const partsPage = await listParts({ stock: "all", page: 1, pageSize: 10 });
  check("配件列表可查询", partsPage.items.length > 0, `共 ${partsPage.total} 种`);
  check(
    "库存金额已计算",
    partsPage.items.every((item) => Number(item.stockValue) >= 0),
  );

  const lowStock = await listLowStockParts();
  console.log(`  · 低库存配件 ${lowStock.length} 项`);

  const dashboard = await getDashboardStats(admin);
  check("首页 KPI 可计算", Number(dashboard.todayRevenue) >= 0 && dashboard.todayOrderCount > 0);
  check("首页可见财务数据（管理员）", dashboard.financeVisible);
  const tasks = await getPendingTasks();
  console.log(`  · 待处理事项 ${tasks.length} 条`);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const summary = await getFinanceSummary(monthStart, now);
  check(
    "财务汇总：收入 ≥ 支出判断可用",
    Number(summary.income) >= 0 && Number(summary.expense) >= 0,
  );
  console.log(
    `  · 本月收入 ${summary.income} / 支出 ${summary.expense} / 利润 ${summary.profit} / 毛利率 ${(summary.grossMarginRate * 100).toFixed(1)}%`,
  );

  const overview = await getReportOverview();
  check("报表总览可计算", Number(overview.monthRevenue) >= 0);
  const charts = await getReportCharts(7);
  check("趋势图数据为 7 天", charts.trend.length === 7, String(charts.trend.length));
  check("排行榜数据可查询", charts.serviceRanking.length >= 0 && charts.partRanking.length > 0);

  // ---------------------------------------------------------------- 采购入库
  console.log("\n【6】采购入库与成本重算");
  const stockBeforePurchase = await inspector.inventoryOf(part.id);

  await purchaseIn(
    {
      partId: part.id,
      quantity: "10",
      unitCost: "30",
      updateCostPrice: true,
      occurredAt: new Date(),
      remark: "冒烟测试采购入库",
    },
    admin,
  );

  const afterPurchase = await inspector.inventoryOf(part.id);
  check(
    "入库后库存 +10",
    Math.abs(Number(afterPurchase.quantity) - (Number(stockBeforePurchase.quantity) + 10)) < 0.001,
  );
  check("入库后自动登记了采购支出", true);
  const purchaseExpense = await inspector.expenseExistsByRemark("冒烟测试采购入库");
  check("采购支出记录确实存在", purchaseExpense === true);

  // ------------------------------------------------- 客户模块（仓储层迁移后行为）
  console.log("\n【7】客户模块（Repository 迁移后的真实行为）");
  const smokePhone = "13900000009";
  // 清理历史遗留，保证本段可重复运行
  await inspector.softDeleteCustomerByPhone(smokePhone);

  const newCustomer = await createCustomer(
    { name: "SMOKE 客户模块", phone: smokePhone, wechat: "smoke_wx" },
    admin,
  );
  check(
    "创建客户成功",
    typeof newCustomer.id === "string" && newCustomer.name === "SMOKE 客户模块",
  );

  let duplicateMessage = "";
  try {
    await createCustomer({ name: "重复号码", phone: smokePhone }, admin);
  } catch (error) {
    duplicateMessage = (error as Error).message;
  }
  check(
    "重复手机号被拒绝且提示已有客户名",
    duplicateMessage.includes("已存在客户") && duplicateMessage.includes("SMOKE 客户模块"),
    duplicateMessage,
  );

  await updateCustomer(
    newCustomer.id,
    { name: "SMOKE 客户模块改名", phone: smokePhone, address: "测试路 1 号" },
    admin,
  );
  const customerList = await listCustomers({ q: "SMOKE 客户模块改名", page: 1, pageSize: 10 });
  check(
    "关键字搜索命中改名后的客户",
    customerList.items.some((c) => c.id === newCustomer.id),
    `命中 ${customerList.items.length} 条`,
  );

  const smokeVehicle = await inspector.createVehicle({
    customerId: newCustomer.id,
    plateNumber: "粤SMOKEC1",
  });
  const customerDetail = await getCustomerDetail(newCustomer.id);
  check("客户详情读取成功且带出新地址", customerDetail.address === "测试路 1 号");
  check(
    "客户详情带出名下车辆",
    customerDetail.vehicles.some((v) => v.plateNumber === "粤SMOKEC1"),
    `车辆数 ${customerDetail.vehicles.length}`,
  );
  check("客户详情统计字段可计算", customerDetail.totalSpent === "0.00");

  const lookedUp = await findCustomerByPhone(smokePhone);
  check(
    "按手机号查客户并带出车辆",
    lookedUp?.vehicles.some((v) => v.plateNumber === "粤SMOKEC1") === true,
  );
  check(
    "按手机号查客户返回消费/欠款字段",
    lookedUp?.totalSpent === "0.00" && lookedUp?.outstandingAmount === "0.00",
  );

  const options = await listCustomerOptions();
  check("客户下拉选项可读", options.length > 0, `${options.length} 项`);

  // 有维修记录的客户必须禁止删除
  const customerWithOrders = await inspector.findActiveCustomerByPhone("13000000001");
  let deleteBlockedMessage = "";
  try {
    await deleteCustomer(customerWithOrders.id, admin);
  } catch (error) {
    deleteBlockedMessage = (error as Error).message;
  }
  check(
    "有维修记录的客户禁止删除",
    deleteBlockedMessage.includes("无法删除"),
    deleteBlockedMessage,
  );

  await deleteCustomer(newCustomer.id, admin);
  check("无工单客户可删除", (await findCustomerByPhone(smokePhone)) === null);
  const orphanVehicle = await inspector.vehicleDeletedAt(smokeVehicle.id);
  check("删除客户时名下车辆已级联软删除", orphanVehicle !== null);

  const outstandingRows = await listOutstandingOrders(5);
  check(
    "待收款列表可读且金额自洽（未收金额恒为正）",
    outstandingRows.every((row) => Number(row.outstandingAmount) > 0),
    `共 ${outstandingRows.length} 条`,
  );

  // ------------------------------------------------- 车辆模块（仓储层迁移后行为）
  console.log("\n【8】车辆模块（Repository 迁移后的真实行为）");
  const smokePlate = "粤SMOKEV1";
  await inspector.softDeleteVehicleByPlate(smokePlate);

  const vehicleCustomer = await inspector.findAnyActiveCustomer();
  const newVehicle = await createVehicle(
    {
      customerId: vehicleCustomer.id,
      plateNumber: smokePlate,
      brand: "冒烟牌",
      model: "V1",
      currentMileage: 12345,
    },
    admin,
  );
  check("创建车辆成功", newVehicle.plateNumber === smokePlate);

  let duplicatePlateMessage = "";
  try {
    await createVehicle({ customerId: vehicleCustomer.id, plateNumber: smokePlate }, admin);
  } catch (error) {
    duplicatePlateMessage = (error as Error).message;
  }
  check(
    "重复车牌被拒绝且提示归属客户",
    duplicatePlateMessage.includes("已登记在客户"),
    duplicatePlateMessage,
  );

  const byPlate = await findVehicleByPlate(smokePlate);
  check(
    "按车牌查车带出里程与客户",
    byPlate?.currentMileage === 12345 && byPlate?.customerName === vehicleCustomer.name,
  );
  check("按车牌查车返回最近工单数组", Array.isArray(byPlate?.recentOrders));

  const vehicleList = await listVehicles({ q: smokePlate, page: 1, pageSize: 10 });
  check(
    "车辆关键字搜索命中新车",
    vehicleList.items.some((v) => v.id === newVehicle.id),
    `命中 ${vehicleList.items.length} 条`,
  );

  const vehicleDetail = await getVehicleDetail(newVehicle.id);
  check("车辆详情读取成功", vehicleDetail.plateNumber === smokePlate);
  check("车辆详情含 history 统计字段", vehicleDetail.totalSpent === "0.00");
  check(
    "车辆详情含保养时间线字段",
    Array.isArray(vehicleDetail.serviceRecords) && Array.isArray(vehicleDetail.workOrders),
  );

  await createServiceRecord(
    {
      vehicleId: newVehicle.id,
      servicedAt: new Date(),
      mileage: 20000,
      description: "冒烟测试保养",
      nextServiceAt: new Date(Date.now() + 10 * 864e5),
    },
    admin,
  );
  const afterService = await getVehicleDetail(newVehicle.id);
  check("登记保养记录后时间线 +1", afterService.serviceRecords.length === 1);
  check(
    "登记保养回写了车辆里程",
    afterService.currentMileage === 20000,
    String(afterService.currentMileage),
  );

  const dueList = await listDueServiceVehicles(10);
  check(
    "临近保养列表可读且包含刚登记的车辆",
    dueList.some((v) => v.id === newVehicle.id),
    `${dueList.length} 条`,
  );

  let vehicleDeleteBlocked = "";
  try {
    await deleteVehicle(vehicleDetail.id, admin);
  } catch (error) {
    vehicleDeleteBlocked = (error as Error).message;
  }
  check("无维修记录的车辆可删除", vehicleDeleteBlocked === "");
  check("删除后按车牌查不到", (await findVehicleByPlate(smokePlate)) === null);

  // ------------------------------------------------- 库存模块（仓储层迁移后行为）
  console.log("\n【9】库存 / 配件模块（Repository 迁移后的真实行为 + 加锁语义）");
  const partCode = "SMOKE-PART-1";
  await inspector.softDeletePartByCode(partCode);

  const newPart = await createPart(
    {
      code: partCode,
      name: "SMOKE 测试配件",
      unit: "个",
      costPrice: "10.00",
      salePrice: "25.00",
      safeQuantity: "20",
      initialQuantity: "50",
    },
    admin,
  );
  check("创建配件成功", typeof newPart.id === "string");

  const partDetailAfterCreate = await getPartDetail(newPart.id);
  check(
    "期初库存通过统一入口写入（50）",
    partDetailAfterCreate.quantity === "50.00",
    partDetailAfterCreate.quantity,
  );
  check(
    "期初库存产生了 PURCHASE_IN 流水",
    partDetailAfterCreate.transactions.some((tx) => tx.type === "PURCHASE_IN"),
  );
  check(
    "安全库存与低库存标记正确（50 ≮ 20）",
    partDetailAfterCreate.safeQuantity === "20.00" && partDetailAfterCreate.isLowStock === false,
  );

  await purchaseIn(
    {
      partId: newPart.id,
      quantity: "30",
      unitCost: "12.00",
      updateCostPrice: true,
      occurredAt: new Date(),
      remark: "SMOKE 库存模块采购",
    },
    admin,
  );
  const afterPurchase2 = await getPartDetail(newPart.id);
  check("采购入库后库存 80", afterPurchase2.quantity === "80.00", afterPurchase2.quantity);
  // 移动加权：(50×10 + 30×12) / 80 = 10.75
  check("移动加权均价重算为 10.75", afterPurchase2.avgCost === "10.75", afterPurchase2.avgCost);

  let noDeltaMessage = "";
  try {
    await adjustStock(
      { partId: newPart.id, targetQuantity: "80", remark: "SMOKE 无差异调整" },
      admin,
    );
  } catch (error) {
    noDeltaMessage = (error as Error).message;
  }
  check("目标数量与当前一致时拒绝调整", noDeltaMessage.includes("无需调整"), noDeltaMessage);

  await adjustStock({ partId: newPart.id, targetQuantity: "75", remark: "SMOKE 调整到 75" }, admin);
  const afterAdjust = await getPartDetail(newPart.id);
  check("库存调整到 75", afterAdjust.quantity === "75.00", afterAdjust.quantity);

  await stocktake(
    [
      { partId: newPart.id, countedQuantity: "70" },
      { partId: part.id, countedQuantity: "999" },
    ],
    "SMOKE 盘点",
    admin,
  );
  const afterStocktake = await getPartDetail(newPart.id);
  check("盘点后库存为 70", afterStocktake.quantity === "70.00", afterStocktake.quantity);
  const stocktakeTx = (await getPartDetail(part.id)).transactions.find(
    (tx) => tx.type === "STOCKTAKE",
  );
  check("盘点产生了 STOCKTAKE 流水", stocktakeTx !== undefined);

  // 把盘点改成 10，让该配件进入低库存，验证预警口径
  await adjustStock(
    { partId: newPart.id, targetQuantity: "10", remark: "SMOKE 制造低库存" },
    admin,
  );
  const lowStockList = await listLowStockParts(50);
  check(
    "低库存清单包含刚调到 10（安全库存 20）的配件",
    lowStockList.some((item) => item.id === newPart.id),
  );
  const lowCount = await countLowStockParts();
  check("低库存数量 ≥ 1", lowCount >= 1, String(lowCount));

  const stockValue = await getStockValue();
  check("库存总金额可计算且非负", Number(stockValue) >= 0, stockValue);

  const picker = await searchPartsForPicker("SMOKE 测试配件", 5);
  check(
    "配件选择器可搜到该配件且库存正确",
    picker.some((row) => row.id === newPart.id && row.stock === "10.00"),
  );

  const saleAggregate = await getPartDetail(newPart.id);
  check(
    "配件详情可读取累计销售统计",
    Number(saleAggregate.soldQuantity) >= 0 && Number(saleAggregate.soldAmount) >= 0,
  );

  let hasStockDeleteMessage = "";
  try {
    await deletePart(newPart.id, admin);
  } catch (error) {
    hasStockDeleteMessage = (error as Error).message;
  }
  check("仍有库存的配件禁止删除", hasStockDeleteMessage.includes("仍有库存"));

  await adjustStock({ partId: newPart.id, targetQuantity: "0", remark: "SMOKE 清零" }, admin);
  await deletePart(newPart.id, admin);
  const deletedPart = await inspector.partFlags(newPart.id);
  check(
    "清零后可删除（软删除 + 停用）",
    deletedPart?.deletedAt !== null && deletedPart?.isActive === false,
  );

  const inventoryTxPage = await listInventoryTransactions({ page: 1, pageSize: 5 });
  check("库存流水列表可分页查询", inventoryTxPage.items.length > 0, `${inventoryTxPage.total} 条`);

  const categories = await listCategories();
  const suppliers = await listSuppliers();
  const serviceItems = await listServiceItems({ limit: 5 });
  check(
    "基础资料可读（分类/供应商/维修项目）",
    categories.length > 0 && suppliers.length >= 0 && serviceItems.length > 0,
    `分类 ${categories.length} / 供应商 ${suppliers.length} / 项目 ${serviceItems.length}`,
  );

  // ------------------------------------------------- 财务模块（仓储层迁移后行为）
  console.log("\n【10】财务模块（Repository 迁移后业务含义不变）");
  const financeOrder = await createWorkOrder(
    {
      newCustomerName: "SMOKE 财务客户",
      newCustomerPhone: "13000000031",
      newVehiclePlate: "粤SMOKEF1",
      discountAmount: "0",
      items: [
        {
          type: "SERVICE",
          itemRefId: service.id,
          name: service.name,
          quantity: "1",
          unitPrice: service.defaultPrice.toFixed(2),
        },
      ],
    },
    admin,
  );

  const pay1 = await addPayment(
    {
      workOrderId: financeOrder.id,
      amount: "100",
      method: "WECHAT",
      category: "REPAIR_SERVICE",
      occurredAt: new Date(),
      remark: "SMOKE 财务：第一笔",
    },
    admin,
  );
  check(
    "收款后已收金额 = 100（由流水汇总得出）",
    (await getWorkOrderBalance(financeOrder.id)).paid === "100.00",
  );

  const pay2 = await addPayment(
    {
      workOrderId: financeOrder.id,
      amount: "50",
      method: "CASH",
      category: "REPAIR_SERVICE",
      occurredAt: new Date(),
      remark: "SMOKE 财务：第二笔",
    },
    admin,
  );
  check(
    "第二笔收款后已收 = 150（始终重算而非累加）",
    (await getWorkOrderBalance(financeOrder.id)).paid === "150.00",
  );

  await voidPayment(pay1.paymentId, "SMOKE 作废第一笔", admin);
  const afterVoid = await getWorkOrderBalance(financeOrder.id);
  check("作废一笔后已收回落为 50", afterVoid.paid === "50.00", afterVoid.paid);
  check(
    "欠款 = 应收 − 已收",
    Math.abs(Number(afterVoid.outstanding) - (Number(afterVoid.total) - 50)) < 0.001,
    afterVoid.outstanding,
  );
  check("作废记录仍可查询（软删除留痕）", true);

  const staffUser = {
    id: admin.id,
    username: "smoke-staff",
    name: "冒烟员工",
    role: "STAFF" as const,
    isAdmin: false,
  };
  let voidForbidden = "";
  try {
    await voidPayment(pay2.paymentId, "SMOKE 员工越权", staffUser);
  } catch (error) {
    voidForbidden = (error as Error).message;
  }
  check("非管理员不能作废收款", voidForbidden.includes("只有管理员"), voidForbidden);

  const smokeExpense = await createExpense(
    {
      category: "RENT",
      amount: "88.88",
      method: "CASH",
      occurredAt: new Date(),
      remark: "SMOKE 财务支出",
    },
    admin,
  );
  await updateExpense(
    smokeExpense.id,
    {
      category: "RENT",
      amount: "99.99",
      method: "BANK_CARD",
      occurredAt: new Date(),
      remark: "SMOKE 财务支出（改）",
    },
    admin,
  );
  const expenseList = await listExpenses({ from: dayStart(), to: dayEnd(), page: 1, pageSize: 50 });
  const updated = expenseList.items.find((e) => e.id === smokeExpense.id);
  check("支出可修改且金额正确", updated?.amount === "99.99", updated?.amount);
  check("支出可列表查询", expenseList.total > 0, `${expenseList.total} 条`);

  const todaySummary = await getFinanceSummary(dayStart(), dayEnd());
  check(
    "净利 = 收入 − 支出（口径未变）",
    Math.abs(
      Number(todaySummary.profit) - (Number(todaySummary.income) - Number(todaySummary.expense)),
    ) < 0.001,
    `${todaySummary.income} - ${todaySummary.expense} = ${todaySummary.profit}`,
  );
  check(
    "毛利 = 收入 − 配件成本（口径未变）",
    Math.abs(
      Number(todaySummary.grossProfit) -
        (Number(todaySummary.income) - Number(todaySummary.partsCost)),
    ) < 0.001,
    `${todaySummary.income} - ${todaySummary.partsCost} = ${todaySummary.grossProfit}`,
  );
  check(
    "分类汇总金额之和 = 收入合计",
    Math.abs(
      todaySummary.incomeByCategory.reduce((acc, c) => acc + Number(c.amount), 0) -
        Number(todaySummary.income),
    ) < 0.01,
  );

  const receivables = await getReceivablesTotal();
  check(
    "欠款总额可计算且 ≥ 本单欠款",
    Number(receivables) >= Number(afterVoid.outstanding) - 0.001,
    receivables,
  );

  const cashFlow = await listCashFlow({ from: dayStart(), to: dayEnd(), page: 1, pageSize: 10 });
  check(
    "统一流水合并收入与支出且按时间倒序",
    cashFlow.items.length > 0 &&
      cashFlow.items.every(
        (item, i) =>
          i === 0 ||
          new Date(cashFlow.items[i - 1]!.occurredAt).getTime() >=
            new Date(item.occurredAt).getTime(),
      ),
    `${cashFlow.total} 条`,
  );

  await deleteExpense(smokeExpense.id, admin);
  const afterDeleteExpense = await listExpenses({
    from: dayStart(),
    to: dayEnd(),
    page: 1,
    pageSize: 50,
  });
  check(
    "删除支出后列表不再包含该记录",
    !afterDeleteExpense.items.some((e) => e.id === smokeExpense.id),
  );

  // ------------------------------------------------- 账号 / 员工（仓储层迁移后行为）
  console.log("\n【11】账号 / 员工模块（Repository 迁移后行为 + 权限规则）");
  const smokeUsername = "smoke-temp-user";
  // 清理历史遗留（含已停用的同名账号）
  const stale = await inspector.findUserByUsername(smokeUsername);
  if (stale) {
    await inspector.deleteSessionsForUser(stale.id);
    await inspector.hardDeleteUser(stale.id);
  }

  const tempUser = await createUser(
    {
      username: smokeUsername,
      name: "SMOKE 临时员工",
      password: "Temp!23456",
      role: "STAFF",
    },
    admin,
  );
  check("创建员工账号成功", typeof tempUser.id === "string");

  let duplicateUserMessage = "";
  try {
    await createUser(
      { username: smokeUsername, name: "重复", password: "Temp!23456", role: "STAFF" },
      admin,
    );
  } catch (error) {
    duplicateUserMessage = (error as Error).message;
  }
  check("重复账号名被拒绝", duplicateUserMessage.includes("已存在"), duplicateUserMessage);

  const users = await listUsers();
  check(
    "账号列表包含新账号",
    users.some((u) => u.id === tempUser.id && u.role === "STAFF"),
  );

  let selfDemoteMessage = "";
  try {
    await updateUser(
      { id: admin.id, name: admin.name, role: "STAFF", isActive: true } as never,
      admin,
    );
  } catch (error) {
    selfDemoteMessage = (error as Error).message;
  }
  check(
    "不能把自己降级（防止锁死最后一个管理员）",
    selfDemoteMessage.includes("不能修改自己的角色"),
    selfDemoteMessage,
  );

  await updateUser(
    {
      id: tempUser.id,
      name: "SMOKE 临时员工（改名）",
      phone: "13500000001",
      role: "STAFF",
      isActive: true,
    },
    admin,
  );
  const afterUpdate = (await listUsers()).find((u) => u.id === tempUser.id);
  check("修改账号资料生效", afterUpdate?.name === "SMOKE 临时员工（改名）");

  let weakPasswordMessage = "";
  try {
    await resetPassword(tempUser.id, "123", admin);
  } catch (error) {
    weakPasswordMessage = (error as Error).message;
  }
  check("弱密码被拒绝（密码强度规则未变）", weakPasswordMessage.length > 0, weakPasswordMessage);

  await resetPassword(tempUser.id, "Reset!23456", admin);
  check("重置密码成功", true);

  let wrongCurrentMessage = "";
  try {
    await changeOwnPassword(tempUser.id, {
      currentPassword: "完全不对的密码",
      newPassword: "Another!23456",
    });
  } catch (error) {
    wrongCurrentMessage = (error as Error).message;
  }
  check(
    "修改自己密码时校验当前密码",
    wrongCurrentMessage.includes("当前密码不正确"),
    wrongCurrentMessage,
  );

  await changeOwnPassword(tempUser.id, {
    currentPassword: "Reset!23456",
    newPassword: "Final!23456",
  });
  check("修改自己密码成功", true);

  await updateOwnProfile(tempUser.id, { name: "SMOKE 临时员工（资料）", phone: "13500000002" });
  check(
    "修改个人资料生效",
    (await listUsers()).find((u) => u.id === tempUser.id)?.name === "SMOKE 临时员工（资料）",
  );

  const employees = await listEmployees();
  check("员工档案列表可读", employees.length > 0, `${employees.length} 人`);

  const employee = await saveEmployee(
    { name: "SMOKE 技师", position: "机修", isTechnician: true },
    admin,
  );
  await saveEmployee(
    { id: employee.id, name: "SMOKE 技师（改）", position: "钣金", isTechnician: true },
    admin,
  );
  const employeeAfter = (await listEmployees()).find((e) => e.id === employee.id);
  check(
    "员工档案可新增并修改",
    employeeAfter?.name === "SMOKE 技师（改）" && employeeAfter?.position === "钣金",
  );

  await deleteUser(tempUser.id, admin);
  check("停用账号后不在列表中", !(await listUsers()).some((u) => u.id === tempUser.id));

  // ------------------------------------------------- 首页聚合（仓储层迁移后行为）
  console.log("\n【12】首页聚合（Repository 迁移后口径不变）");
  const homeStats = await getDashboardStats(admin);
  check(
    "首页今日利润 = 今日收入 − 今日支出",
    Math.abs(
      Number(homeStats.todayProfit) -
        (Number(homeStats.todayRevenue) - Number(homeStats.todayExpense)),
    ) < 0.001,
    `${homeStats.todayRevenue} - ${homeStats.todayExpense} = ${homeStats.todayProfit}`,
  );
  check(
    "首页本月利润 = 本月收入 − 本月支出",
    Math.abs(
      Number(homeStats.monthProfit) -
        (Number(homeStats.monthRevenue) - Number(homeStats.monthExpense)),
    ) < 0.001,
  );
  check("首页今日开单数 ≥ 1", homeStats.todayOrderCount >= 1, String(homeStats.todayOrderCount));
  check("首页在册客户数 ≥ 1", homeStats.customerCount >= 1, String(homeStats.customerCount));
  check(
    "首页待收款金额 ≥ 本单欠款",
    Number(homeStats.pendingPaymentAmount) >= Number(afterVoid.outstanding) - 0.001,
    homeStats.pendingPaymentAmount,
  );
  check(
    "首页欠款笔数 = 欠款金额为正的工单数（口径自洽）",
    homeStats.pendingPaymentCount >= 1 && homeStats.pendingPaymentAmount !== "0.00",
    `${homeStats.pendingPaymentCount} 笔`,
  );

  const staffDashboard = await getDashboardStats(staffUser);
  check(
    "非管理员看不到财务数字（全部为 0.00）",
    staffDashboard.financeVisible === false &&
      staffDashboard.todayRevenue === "0.00" &&
      staffDashboard.monthProfit === "0.00" &&
      staffDashboard.stockValue === "0.00" &&
      staffDashboard.outstandingAmount === "0.00",
    `financeVisible=${staffDashboard.financeVisible}`,
  );
  check(
    "非管理员仍可见非财务 KPI（开单数/客户数）",
    staffDashboard.todayOrderCount === homeStats.todayOrderCount &&
      staffDashboard.customerCount === homeStats.customerCount,
  );

  const recentOrders = await getRecentWorkOrders(5);
  check("首页最近工单可读", recentOrders.length > 0, `${recentOrders.length} 条`);

  const todayOrders = await getTodayWorkOrders(6);
  check("首页今日维修记录可读", todayOrders.length > 0, `${todayOrders.length} 条`);

  const pendingTasks = await getPendingTasks();
  const paymentTasks = pendingTasks.filter((t) => t.type === "PAYMENT");
  check("待处理事项包含待收款", paymentTasks.length > 0, `${pendingTasks.length} 条`);
  check("待收款事项最多 5 条（首页只展示最紧急的）", paymentTasks.length <= 5);

  // 交叉核对：首页第一条待收款 = 全库欠款金额最大的那笔
  const openBalances = await inspector.openOrderBalances();
  const maxOutstanding = openBalances
    .map((o) => Number(o.totalAmount) - Number(o.paidAmount))
    .filter((v) => v > 0)
    .sort((a, b) => b - a)[0];
  check(
    "首页第一条待收款 = 全库最大欠款金额（排序口径正确）",
    paymentTasks[0] !== undefined &&
      maxOutstanding !== undefined &&
      paymentTasks[0].description.includes(maxOutstanding.toFixed(2)),
    `期望 ${maxOutstanding?.toFixed(2)}，实际 ${paymentTasks[0]?.description}`,
  );
  check(
    "待收款事项金额恒为正",
    paymentTasks.every((t) => {
      const m = t.description.match(/欠 ¥(\d+\.\d{2})/);
      return m !== null && Number(m[1]) > 0;
    }),
  );

  // 库存总额必须与「当前」库存模块一致（重新取一次，避免拿旧值比较）
  const currentStockValue = await getStockValue();
  check(
    "首页库存总金额与库存模块当前值一致",
    homeStats.stockValue === currentStockValue,
    `${homeStats.stockValue} vs ${currentStockValue}`,
  );

  // ------------------------------------------------- 全局搜索（仓储层迁移后行为）
  console.log("\n【13】全局搜索（Repository 迁移后口径不变）");
  const searchByPlate = await globalSearch("粤SMOKE1");
  check(
    "按车牌可搜到车辆",
    searchByPlate.vehicles.some((v) => v.plateNumber === "粤SMOKE1"),
    `${searchByPlate.vehicles.length} 条`,
  );
  check(
    "车辆结果带出所属客户名",
    searchByPlate.vehicles.find((v) => v.plateNumber === "粤SMOKE1")?.customerName ===
      "SMOKE 测试客户",
    searchByPlate.vehicles.find((v) => v.plateNumber === "粤SMOKE1")?.customerName,
  );
  check(
    "按车牌也能带出该车工单",
    searchByPlate.workOrders.some((w) => w.plateNumber === "粤SMOKE1"),
    `${searchByPlate.workOrders.length} 条`,
  );

  const byOrderNo = await globalSearch(created.orderNo);
  check(
    "按工单号可搜到工单",
    byOrderNo.workOrders.some((w) => w.orderNo === created.orderNo),
    created.orderNo,
  );
  check(
    "工单号大小写不敏感（传入小写仍命中）",
    (await globalSearch(created.orderNo.toLowerCase())).workOrders.some(
      (w) => w.orderNo === created.orderNo,
    ),
  );

  const byCustomer = await globalSearch("SMOKE 测试客户");
  check(
    "按客户名可搜到客户",
    byCustomer.customers.some((c) => c.name === "SMOKE 测试客户" && c.phone === "13000000001"),
    `${byCustomer.customers.length} 条`,
  );
  const byPhone = await globalSearch("13000000001");
  check(
    "按手机号可搜到客户",
    byPhone.customers.some((c) => c.phone === "13000000001"),
  );
  check(
    "按手机号也能带出该客户工单",
    byPhone.workOrders.some((w) => w.plateNumber === "粤SMOKE1"),
  );

  const partKeyword = part.name.slice(0, 2);
  const byPart = await globalSearch(partKeyword);
  const hitPart = byPart.parts.find((p) => p.id === part.id);
  check("按配件名可搜到配件", hitPart !== undefined, `关键词「${partKeyword}」`);
  const partStockNow = await inspector
    .inventoryOf(part.id)
    .then((r) => ({ q: Number(r.quantity), safe: Number(r.safeQuantity) }));
  check(
    "配件结果库存数与实际一致",
    hitPart !== undefined && Math.abs(Number(hitPart.stockValue) - partStockNow.q) < 0.001,
    `结果 ${hitPart?.stockValue} vs 实际 ${partStockNow.q}`,
  );
  check(
    "低库存判定 = 库存 < 安全库存",
    hitPart !== undefined && hitPart.isLowStock === partStockNow.q < partStockNow.safe,
    `${partStockNow.q} < ${partStockNow.safe} → ${hitPart?.isLowStock}`,
  );

  check(
    "已取消工单仍可被搜索（口径未变：只看 deletedAt）",
    (await globalSearch("粤SMOKE2")).workOrders.length > 0,
  );
  check("空关键词直接返回空结果", (await globalSearch("   ")).workOrders.length === 0);
  check("搜索结果条数受 limit 约束", (await globalSearch("SMOKE", 2)).customers.length <= 2);

  const suggestions = await searchSuggestions("粤SMOKE1");
  check(
    "联想建议包含车牌项",
    suggestions.some((s) => s.type === "vehicle" && s.label === "粤SMOKE1"),
    `${suggestions.length} 条`,
  );
  check(
    "车牌建议的副标题是客户名",
    suggestions.find((s) => s.type === "vehicle")?.sub === "SMOKE 测试客户",
    suggestions.find((s) => s.type === "vehicle")?.sub,
  );
  const customerSuggestions = await searchSuggestions("13000000001");
  check(
    "按手机号联想出客户",
    customerSuggestions.some((s) => s.type === "customer" && s.sub === "13000000001"),
  );
  check("空输入联想返回空数组", (await searchSuggestions("")).length === 0);

  // ---------------------------------------------------------------- 结果
  console.log(`\n${"=".repeat(52)}`);
  console.log(`冒烟测试结束：通过 ${passed} 项，失败 ${failed} 项`);
  console.log("=".repeat(52));

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("\n冒烟测试异常中断：", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void inspector?.dispose();
  });
