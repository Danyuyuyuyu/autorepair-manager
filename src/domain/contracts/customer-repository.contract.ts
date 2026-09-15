import type { CustomerRepository } from "@/domain/repositories";

export type CustomerContractMeta = {
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  wechat?: string | null;
  address?: string | null;
  remark?: string | null;
};

export interface CustomerContractHarness {
  name: string;
  customer: CustomerRepository;
  createVehicle(customerId: string, plateNumber: string, deletedAt?: Date): Promise<string>;
  createOrder(input: {
    customerId: string;
    vehicleId: string;
    orderNo: string;
    status: "PENDING_INTAKE" | "COMPLETED" | "CANCELLED";
    totalAmount: string;
    paidAmount: string;
    createdAt: Date;
    deletedAt?: Date;
  }): Promise<void>;
  setCustomerMeta(id: string, meta: CustomerContractMeta): Promise<void>;
  cleanup(): Promise<void>;
}

export interface CustomerContractSnapshot {
  pageNames: string[];
  listKeys: string[];
  relationCounts: { vehicles: number; workOrders: number };
  options: string[];
  activeVehiclePlates: string[];
  stats: Array<{ name: string; total: string; paid: string; lastOrderAt: string }>;
  globalEmpty: string[];
  suggestEmptyCount: number;
  postDeleteActiveCount: number;
  reusedPhoneName: string;
}

export interface CustomerContractResult {
  passed: number;
  total: 37;
  snapshot: CustomerContractSnapshot;
}

type ContractReporter = (label: string) => void;

/**
 * CustomerRepository 的跨驱动 contract。
 *
 * 这里故意不依赖 node:assert、数据库驱动或测试框架：PostgreSQL、PC SQLite 和
 * Android Native SQLite 都必须从同一个 interface seam 跑完全相同的 37 项断言。
 */
export async function runCustomerRepositoryContract(
  harness: CustomerContractHarness,
  prefix: string,
  report: ContractReporter = () => undefined,
): Promise<CustomerContractResult> {
  let passed = 0;
  const check = (label: string, condition: unknown, detail?: string): void => {
    if (!condition) throw new Error(`${label}${detail ? `：${detail}` : ""}`);
    passed += 1;
    report(label);
  };
  const expectError = async (
    label: string,
    expectedCode: string,
    operation: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      await operation();
      check(label, false, `应抛出领域错误 ${expectedCode}`);
    } catch (error) {
      const actualCode = (error as { code?: unknown } | null)?.code;
      check(label, actualCode === expectedCode, `实际 code=${String(actualCode)}`);
    }
  };
  const fixedMoney = (value: { toFixed(decimalPlaces: number): string }): string =>
    value.toFixed(2);

  const phone = {
    alice: `${prefix}01`,
    bob: `${prefix}02`,
    charlie: `${prefix}03`,
    deleted: `${prefix}04`,
  };
  const dates = {
    first: new Date("2097-01-01T00:00:00.000Z"),
    second: new Date("2097-01-02T00:00:00.000Z"),
    third: new Date("2097-01-03T00:00:00.000Z"),
    fourth: new Date("2097-01-04T00:00:00.000Z"),
    fifth: new Date("2097-01-05T00:00:00.000Z"),
  };
  const baselineActive = await harness.customer.countActive();

  try {
    const alice = await harness.customer.create({
      name: "Alice Garage",
      phone: phone.alice,
      createdBy: null,
    });
    const bob = await harness.customer.create({
      name: "客户乙",
      phone: phone.bob,
      createdBy: null,
    });
    const charlie = await harness.customer.create({
      name: "Case Tester",
      phone: phone.charlie,
      createdBy: null,
    });
    const deleted = await harness.customer.create({
      name: "Deleted Customer",
      phone: phone.deleted,
      createdBy: null,
    });

    await harness.customer.update(alice.id, {
      name: "Alice Updated",
      phone: phone.alice,
      wechat: "WxAlpha",
      address: null,
      remark: "O'Reilly customer",
    });
    await harness.setCustomerMeta(alice.id, {
      createdAt: dates.first,
      updatedAt: dates.fourth,
      wechat: "WxAlpha",
      address: null,
      remark: "O'Reilly customer",
    });
    await harness.setCustomerMeta(bob.id, {
      createdAt: dates.second,
      updatedAt: dates.third,
      wechat: "betaNote",
      address: "二号地址",
      remark: null,
    });
    await harness.setCustomerMeta(charlie.id, {
      createdAt: dates.third,
      updatedAt: dates.second,
      wechat: null,
      address: null,
      remark: null,
    });
    await harness.setCustomerMeta(deleted.id, {
      createdAt: dates.fourth,
      updatedAt: dates.fifth,
      deletedAt: dates.fifth,
      wechat: "deletedWx",
      address: null,
      remark: null,
    });

    const aliceVehicle = await harness.createVehicle(alice.id, "粤A10001");
    await harness.createVehicle(alice.id, "粤DEL999", dates.fifth);
    const bobVehicle = await harness.createVehicle(bob.id, "粤B20002");

    await harness.createOrder({
      customerId: alice.id,
      vehicleId: aliceVehicle,
      orderNo: `${prefix}-ACTIVE`,
      status: "COMPLETED",
      totalAmount: "10.50",
      paidAmount: "1.10",
      createdAt: dates.first,
    });
    await harness.createOrder({
      customerId: alice.id,
      vehicleId: aliceVehicle,
      orderNo: `${prefix}-CANCELLED`,
      status: "CANCELLED",
      totalAmount: "99.99",
      paidAmount: "99.99",
      createdAt: dates.second,
    });
    await harness.createOrder({
      customerId: alice.id,
      vehicleId: aliceVehicle,
      orderNo: `${prefix}-DELETED`,
      status: "PENDING_INTAKE",
      totalAmount: "999.99",
      paidAmount: "0.01",
      createdAt: dates.third,
      deletedAt: dates.fifth,
    });
    await harness.createOrder({
      customerId: bob.id,
      vehicleId: bobVehicle,
      orderNo: `${prefix}-BOB`,
      status: "PENDING_INTAKE",
      totalAmount: "99999999.99",
      paidAmount: "0.01",
      createdAt: dates.fourth,
    });

    check("create 返回 ID/name", alice.id.length > 0 && alice.name === "Alice Garage");
    check("手机号精确查询", (await harness.customer.findByPhone(phone.alice))?.id === alice.id);
    check(
      "手机号查询 excludeId",
      (await harness.customer.findByPhone(phone.alice, alice.id)) === null,
    );
    const edit = await harness.customer.findForEdit(alice.id);
    check(
      "update 与 nullable round-trip",
      edit?.name === "Alice Updated" &&
        edit.wechat === "WxAlpha" &&
        edit.address === null &&
        edit.remark === "O'Reilly customer",
    );

    const page = await harness.customer.list({ keyword: prefix }, { skip: 1, take: 1 });
    check("分页与 active 总数", page.total === 3 && page.rows.length === 1);
    check("createdAt 倒序", page.rows[0]?.name === "客户乙");
    check(
      "Date 与领域行转换",
      page.rows[0]?.createdAt instanceof Date &&
        page.rows[0].createdAt.toISOString() === dates.second.toISOString(),
    );

    const aliceList = await harness.customer.list({ keyword: "alice" }, { skip: 0, take: 10 });
    check("姓名模糊匹配不区分大小写", aliceList.total === 1 && aliceList.rows[0]?.id === alice.id);
    check(
      "手机号模糊匹配",
      (await harness.customer.list({ keyword: phone.bob.slice(-5) }, { skip: 0, take: 10 })).rows[0]
        ?.id === bob.id,
    );
    check(
      "微信备注模糊匹配不区分大小写",
      (await harness.customer.list({ keyword: "wxalpha" }, { skip: 0, take: 10 })).rows[0]?.id ===
        alice.id,
    );
    check(
      "已删车辆车牌仍参与列表关联搜索",
      (await harness.customer.list({ keyword: "粤del999" }, { skip: 0, take: 10 })).rows[0]?.id ===
        alice.id,
    );
    check(
      "SQL 输入使用绑定参数",
      (await harness.customer.list({ keyword: "%' OR 1=1 --" }, { skip: 0, take: 10 })).total === 0,
    );

    const aliceRow = aliceList.rows[0]!;
    check(
      "关系统计包含软删关联行",
      aliceRow._count.vehicles === 2 && aliceRow._count.workOrders === 3,
    );
    check("findListView 隐藏已删客户", (await harness.customer.findListView(deleted.id)) === null);

    const options = await harness.customer.listOptions(2);
    check(
      "listOptions updatedAt 排序与 limit",
      options.map((row) => row.name).join(",") === "Alice Updated,客户乙",
    );
    const withVehicles = await harness.customer.findByPhoneWithVehicles(phone.alice);
    check(
      "手机查询只返回 active 车辆",
      withVehicles?.vehicles.length === 1 && withVehicles.vehicles[0]?.plateNumber === "粤A10001",
    );

    check("空客户集合聚合短路", (await harness.customer.aggregateOrderStats([])).length === 0);
    const stats = await harness.customer.aggregateOrderStats([alice.id, bob.id, charlie.id]);
    const aliceStats = stats.find((row) => row.customerId === alice.id);
    const bobStats = stats.find((row) => row.customerId === bob.id);
    check(
      "聚合排除取消与软删工单",
      stats.length === 2 &&
        fixedMoney(aliceStats!.totalAmount!) === "10.50" &&
        fixedMoney(aliceStats!.paidAmount!) === "1.10" &&
        aliceStats!.lastOrderAt?.toISOString() === dates.first.toISOString(),
    );
    check(
      "Decimal 大金额聚合精确",
      fixedMoney(bobStats!.totalAmount!) === "99999999.99" &&
        fixedMoney(bobStats!.paidAmount!) === "0.01",
    );

    const deleteView = await harness.customer.findForDelete(alice.id);
    check(
      "删除前统计包含全部关联行",
      deleteView?.vehicleCount === 2 && deleteView.workOrderCount === 3,
    );
    check("existsActive", await harness.customer.existsActive(alice.id));
    check("countActive", (await harness.customer.countActive()) === baselineActive + 3);
    check(
      "countCreatedBetween 包含两端边界",
      (await harness.customer.countCreatedBetween(dates.first, dates.second)) === 2,
    );

    check(
      "global 姓名搜索",
      (await harness.customer.searchForGlobal("ALICE", 10))[0]?.id === alice.id,
    );
    check(
      "global 手机搜索",
      (await harness.customer.searchForGlobal(phone.bob.slice(-5), 10))[0]?.id === bob.id,
    );
    check(
      "global 微信搜索",
      (await harness.customer.searchForGlobal("BETANOTE", 10))[0]?.id === bob.id,
    );
    const globalEmpty = await harness.customer.searchForGlobal("", 2);
    check(
      "global 空查询按 updatedAt 排序并限制",
      globalEmpty.map((row) => row.name).join(",") === "Alice Updated,客户乙",
    );
    check(
      "global vehicleCount 不过滤软删车辆",
      (await harness.customer.searchForGlobal("ALICE", 10))[0]?.vehicleCount === 2,
    );

    check(
      "suggest 姓名/手机搜索",
      (await harness.customer.suggest("case", 10))[0]?.id === charlie.id &&
        (await harness.customer.suggest(phone.bob.slice(-5), 10))[0]?.id === bob.id,
    );
    const suggestEmpty = await harness.customer.suggest("", 2);
    check("suggest 空查询与 limit", suggestEmpty.length === 2);
    check(
      "已删客户从搜索与 suggest 隐藏",
      (await harness.customer.searchForGlobal("Deleted Customer", 10)).length === 0 &&
        (await harness.customer.suggest("Deleted Customer", 10)).length === 0,
    );

    const duplicate = await harness.customer.create({
      name: "Duplicate phone allowed",
      phone: phone.alice,
      createdBy: null,
    });
    check("phone 无数据库 UNIQUE（重复校验归 service）", duplicate.id !== alice.id);
    await harness.customer.softDelete(duplicate.id);

    await harness.customer.softDelete(alice.id);
    check(
      "soft delete 后普通读取全部不可见",
      (await harness.customer.findListView(alice.id)) === null &&
        (await harness.customer.findForEdit(alice.id)) === null &&
        (await harness.customer.findForDelete(alice.id)) === null &&
        !(await harness.customer.existsActive(alice.id)) &&
        (await harness.customer.findByPhone(phone.alice)) === null &&
        (await harness.customer.findByPhoneWithVehicles(phone.alice)) === null,
    );
    check(
      "soft delete 后列表/global/suggest 不可见",
      (await harness.customer.list({ keyword: "Alice Updated" }, { skip: 0, take: 10 })).total ===
        0 &&
        (await harness.customer.searchForGlobal("Alice Updated", 10)).length === 0 &&
        (await harness.customer.suggest("Alice Updated", 10)).length === 0,
    );
    const activeAfterDelete = await harness.customer.countActive();
    check("soft delete 后 active count", activeAfterDelete === baselineActive + 2);

    const replacement = await harness.customer.create({
      name: "Reused Phone",
      phone: phone.alice,
      createdBy: null,
    });
    check(
      "已删手机号可重新使用",
      (await harness.customer.findByPhone(phone.alice))?.id === replacement.id,
    );
    await expectError("update 缺失行翻译 NotFound", "NOT_FOUND", () =>
      harness.customer.update("missing-customer", {
        name: "missing",
        phone: "missing",
        wechat: null,
        address: null,
        remark: null,
      }),
    );

    const idToName = new Map([
      [alice.id, "Alice Updated"],
      [bob.id, "客户乙"],
      [charlie.id, "Case Tester"],
    ]);
    const snapshot: CustomerContractSnapshot = {
      pageNames: page.rows.map((row) => row.name),
      listKeys: Object.keys(aliceRow).sort(),
      relationCounts: aliceRow._count,
      options: options.map((row) => row.name),
      activeVehiclePlates: withVehicles!.vehicles.map((row) => row.plateNumber).sort(),
      stats: stats
        .map((row) => ({
          name: idToName.get(row.customerId)!,
          total: fixedMoney(row.totalAmount!),
          paid: fixedMoney(row.paidAmount!),
          lastOrderAt: row.lastOrderAt!.toISOString(),
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      globalEmpty: globalEmpty.map((row) => row.name),
      suggestEmptyCount: suggestEmpty.length,
      postDeleteActiveCount: activeAfterDelete - baselineActive,
      reusedPhoneName: (await harness.customer.findByPhone(phone.alice))!.name,
    };
    if (passed !== 37) throw new Error(`Customer contract 断言计数漂移：${passed}/37`);
    return { passed, total: 37, snapshot };
  } finally {
    await harness.cleanup();
  }
}
