/**
 * 仓储接口 —— 业务层与存储层之间的唯一契约
 * ---------------------------------------------------------------------------
 * 规则：
 * 1. 接口方法只接受「领域参数」（普通对象 / 字符串 / Decimal），
 *    绝不接受 Prisma 的 WhereInput / Select / Include 等类型。
 * 2. 返回值是 `src/domain/entities.ts` 和 `src/domain/rows.ts` 里的后端无关形状。
 * 3. 事务由 `RepositoryContext.transaction()` 统一提供，接口本身不出现
 *    `$transaction` / `BEGIN` 等任何后端概念。
 * 4. 分页这类「表达」由业务层决定，仓储只负责「取数」。
 *
 * 这样同一套业务逻辑可以跑在三种实现上：
 *   Prisma(PostgreSQL) / Prisma(SQLite) / 原生 SQLite(手机端)
 *
 * 【演进方式】接口随服务迁移一块儿长大：
 *   本文件当前覆盖「工单 + 库存写入 + 审计」切片（工单是全系统最核心、
 *   事务最密集的路径，先把它打穿能证明抽象站得住）。其余实体在后续切片中
 *   按同样方式补齐，接口只声明已迁移服务真正用到的方法，不做投机性声明。
 */
import type {
  AuditLog,
  Money,
  VehicleServiceRecord,
  WorkOrder,
  WorkOrderItem,
} from "@/domain/entities";
import type {
  CategoryKind,
  ExpenseCategory,
  IncomeCategory,
  IncomeSource,
  InventoryTxType,
  PaymentMethod,
  Role,
  WorkOrderItemType,
  WorkOrderStatus,
} from "@/domain/enums";
import type {
  CategoryOptionRow,
  CustomerListRow,
  CustomerOrderStatsRow,
  CustomerSuggestionRow,
  DueServiceVehicleRow,
  EmployeeListRow,
  ExpenseRow,
  InventoryTxRow,
  PartDetailRow,
  PartListRow,
  PartPickerRow,
  PartSalesAggregateRow,
  PartStockLevelRow,
  PaymentRow,
  SearchCustomerRow,
  SearchPartRow,
  SearchVehicleRow,
  SearchWorkOrderRow,
  ServiceItemPickerRow,
  StockValuationLine,
  SupplierOptionRow,
  UnsettledOrderRow,
  UserListRow,
  VehicleDetailBaseRow,
  VehicleItemHistoryRow,
  VehicleListRow,
  VehicleOrderBriefRow,
  VehicleServiceRecordRow,
  VehicleSuggestionRow,
  WorkOrderDetailRow,
  WorkOrderListRow,
  WorkOrderMutationRow,
  WorkOrderTotalsRow,
} from "@/domain/rows";

// ---------------------------------------------------------------------------
// 事务上下文
// ---------------------------------------------------------------------------

/** 仓储集合：业务层拿到它就能访问所有已迁移的实体 */
export interface Repositories {
  workOrder: WorkOrderRepository;
  workOrderItem: WorkOrderItemRepository;
  customer: CustomerRepository;
  vehicle: VehicleRepository;
  inventory: InventoryRepository;
  part: PartRepository;
  catalog: CatalogRepository;
  finance: FinanceRepository;
  user: UserRepository;
  audit: AuditRepository;
}

/**
 * 仓储上下文 —— 单元工作的入口。
 *
 * `transaction()` 回调里拿到的仓储绑定在同一事务上：要么全部成功，要么全部回滚。
 * Prisma 实现为 `$transaction`；手机端实现为 `BEGIN IMMEDIATE ... COMMIT`。
 */
export interface RepositoryContext {
  /** 无事务的默认仓储，用于只读查询与单条写入 */
  readonly repos: Repositories;
  transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// 工单
// ---------------------------------------------------------------------------

export interface WorkOrderListFilter {
  /** 关键字：工单号 / 客户姓名 / 客户手机 / 车牌 */
  keyword?: string;
  /** ALL = 全部；UNPAID = 未结清（待接车/维修中/待质检/待付款） */
  status?: WorkOrderStatus | "ALL" | "UNPAID";
  customerId?: string;
  vehicleId?: string;
  /** 员工只能看到自己创建的工单（管理员不传） */
  restrictToCreatorId?: string;
}

export interface WorkOrderListResult {
  rows: WorkOrderListRow[];
  total: number;
}

export interface WorkOrderCreateData {
  orderNo: string;
  customerId: string;
  vehicleId: string;
  mileage?: number | null;
  faultDescription?: string | null;
  remark?: string | null;
  technicianId?: string | null;
  createdBy: string | null;
  discountAmount: Money;
}

export interface WorkOrderInfoPatch {
  mileage?: number | null;
  faultDescription?: string | null;
  remark?: string | null;
  technicianId?: string | null;
  discountAmount?: Money;
}

/** 工单金额字段（由 lib/money 的 calcOrderTotals 算出后落库） */
export interface WorkOrderTotalsPatch {
  serviceAmount: Money;
  partsAmount: Money;
  laborAmount: Money;
  otherAmount: Money;
  discountAmount: Money;
  totalAmount: Money;
  partsCost: Money;
}

/** 删除工单时留痕用的快照 */
export interface WorkOrderSnapshot {
  orderNo: string;
  status: WorkOrderStatus;
  totalAmount: Money;
  customer: { name: string } | null;
  vehicle: { plateNumber: string } | null;
}

export interface WorkOrderRepository {
  /** 当日最大工单号（生成 RO + 日期 + 序号用） */
  findLatestOrderNo(prefix: string): Promise<string | null>;

  list(
    filter: WorkOrderListFilter,
    paging: { skip: number; take: number },
  ): Promise<WorkOrderListResult>;

  /** 某客户的最近工单（客户详情页时间线） */
  listRecentByCustomer(customerId: string, take: number): Promise<WorkOrderListRow[]>;

  /** 某车辆的最近工单（车辆详情页） */
  listRecentByVehicle(vehicleId: string, take: number): Promise<WorkOrderListRow[]>;

  /** 某车辆的最近工单摘要（按车牌查车时展示） */
  listBriefByVehicle(vehicleId: string, take: number): Promise<VehicleOrderBriefRow[]>;

  /**
   * 未结清工单候选行（「待收款」页面用）。
   * 只做「排除已取消 + 排序 + 限量」，**是否真的欠款由业务层判断**：
   * 未收金额 = 应收 − 已收 属于金额规则，必须在领域层算。
   */
  listUnsettled(take: number): Promise<UnsettledOrderRow[]>;

  findDetailById(id: string): Promise<WorkOrderDetailRow | null>;

  /** 改动权限校验 / 状态机判断所需的最小行 */
  findForMutation(id: string): Promise<WorkOrderMutationRow | null>;

  /** 重算金额所需的工单项与优惠金额 */
  findTotalsSource(id: string): Promise<WorkOrderTotalsRow | null>;

  create(data: WorkOrderCreateData): Promise<WorkOrder>;

  updateInfo(id: string, patch: WorkOrderInfoPatch): Promise<void>;

  /** 落库 calcOrderTotals 的结果 */
  applyTotals(id: string, totals: WorkOrderTotalsPatch): Promise<void>;

  changeStatus(
    id: string,
    patch: {
      status: WorkOrderStatus;
      mileage?: number | null;
      completedAt?: Date | null;
      cancelledAt?: Date | null;
      cancelReason?: string | null;
    },
  ): Promise<void>;

  setPaidAmount(id: string, paidAmount: Money): Promise<void>;

  /** 仅取应收金额（审计留痕用） */
  findTotalAmount(id: string): Promise<Money | null>;

  /** 收款时需要的工单信息（状态校验 + 归属客户） */
  findForPayment(id: string): Promise<{
    id: string;
    orderNo: string;
    status: WorkOrderStatus;
    totalAmount: Money;
    customerId: string;
  } | null>;

  /** 应收 / 已收（欠款计算用，取数最小化） */
  findBalance(id: string): Promise<{ totalAmount: Money; paidAmount: Money } | null>;

  /** 未取消工单的应收与已收（欠款总额汇总 / 首页统计 / 报表欠款卡片共用） */
  listOpenOrderBalances(): Promise<
    Array<{
      status: WorkOrderStatus;
      totalAmount: Money;
      paidAmount: Money;
      customerId: string;
    }>
  >;

  /** 某区间内创建的工单（首页「今日开单数」按状态统计） */
  listCreatedBetween(from: Date, to: Date): Promise<Array<{ status: WorkOrderStatus }>>;

  /** 某区间内创建的工单数（报表口径可选排除已取消） */
  countCreatedBetween(
    from: Date,
    to: Date,
    options?: { excludeCancelled?: boolean },
  ): Promise<number>;

  /** 某区间内创建的工单时间（趋势图按日归集，归集与补零由领域层负责） */
  listCreatedDates(from: Date, to: Date): Promise<Array<{ createdAt: Date }>>;

  /** 某区间内完工的工单汇总（报表「完工收入 / 成本 / 客单价」） */
  findCompletedBetween(
    from: Date,
    to: Date,
  ): Promise<{ count: number; totalAmount: Money | null; partsCost: Money | null }>;

  /** 最近工单（首页） */
  listRecent(take: number): Promise<WorkOrderListRow[]>;

  /** 全局搜索：工单号 / 车牌 / 客户姓名 / 客户手机 模糊匹配 */
  searchForGlobal(keyword: string, limit: number): Promise<SearchWorkOrderRow[]>;

  /** 今日有变动的工单（创建或更新落在区间内，首页「今日维修记录」） */
  listTouchedBetween(from: Date, to: Date, take: number): Promise<WorkOrderListRow[]>;

  /** 某区间内创建的工单数与配件成本合计（财务汇总用） */
  aggregateCreatedOrders(
    from: Date,
    to: Date,
  ): Promise<{ orderCount: number; partsCost: Money | null }>;

  findSnapshot(id: string): Promise<WorkOrderSnapshot | null>;

  /** 硬删除（仅管理员误建单场景） */
  hardDelete(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// 工单项
// ---------------------------------------------------------------------------

export interface WorkOrderItemCreateData {
  workOrderId: string;
  type: WorkOrderItemType;
  itemRefId?: string | null;
  name: string;
  spec?: string | null;
  unit?: string | null;
  quantity: Money;
  unitPrice: Money;
  costPrice: Money;
  amount: Money;
  remark?: string | null;
  sortOrder: number;
}

export interface WorkOrderItemPatch {
  quantity?: Money;
  unitPrice?: Money;
  amount?: Money;
  remark?: string | null;
}

/** 工单项 + 所属工单归属信息（改动权限校验用） */
export interface WorkOrderItemWithOrder {
  id: string;
  workOrderId: string;
  type: WorkOrderItemType;
  itemRefId: string | null;
  name: string;
  quantity: Money;
  unitPrice: Money;
  amount: Money;
  workOrder: { id: string; orderNo: string; createdBy: string | null; status: WorkOrderStatus };
}

/** 工单取消 / 删除时需回滚库存的配件项 */
export interface PartItemRow {
  id: string;
  itemRefId: string | null;
  name: string;
  quantity: Money;
}

export interface WorkOrderItemRepository {
  create(data: WorkOrderItemCreateData): Promise<WorkOrderItem>;
  findByIdWithOrder(id: string): Promise<WorkOrderItemWithOrder | null>;
  update(id: string, patch: WorkOrderItemPatch): Promise<void>;
  hardDelete(id: string): Promise<void>;
  countByOrder(workOrderId: string): Promise<number>;
  /** 工单里的配件项（type = PART） */
  listPartItems(workOrderId: string): Promise<PartItemRow[]>;
  /**
   * 某车辆历史用料/用工（排除已取消工单）。
   * 只返回明细，聚合与排序由领域层负责（该车辆「常换配件」的口径属于业务规则）。
   */
  listVehicleItemHistory(vehicleId: string): Promise<VehicleItemHistoryRow[]>;

  /** 某配件在有效工单中的累计出货量 / 金额 / 次数（配件详情页） */
  aggregatePartSales(partId: string): Promise<PartSalesAggregateRow>;

  /** 按工单项类型汇总金额（报表「本月项目 / 配件 / 工时收入」） */
  sumAmountByType(
    from: Date,
    to: Date,
  ): Promise<Array<{ type: WorkOrderItemType; amount: Money | null }>>;

  /** 按名称排行（维修项目 / 配件 / 工时通用，报表排行榜） */
  groupByName(
    type: WorkOrderItemType,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<Array<{ name: string; quantity: Money | null; amount: Money | null; count: number }>>;
}

// ---------------------------------------------------------------------------
// 客户 / 车辆（本切片只覆盖建单与完工真正用到的部分）
// ---------------------------------------------------------------------------

export interface CustomerRepository {
  /**
   * 按手机号查客户（新建工单最高频入口 / 重复校验）。
   * 传 `excludeId` 可排除自身（编辑时判断手机号是否被他人占用）。
   */
  findByPhone(phone: string, excludeId?: string): Promise<{ id: string; name: string } | null>;

  /** 客户列表（关键字命中姓名 / 手机 / 微信 / 名下车辆车牌） */
  list(
    filter: { keyword?: string },
    paging: { skip: number; take: number },
  ): Promise<{ rows: CustomerListRow[]; total: number }>;

  /** 列表投影单条（详情页主表部分） */
  findListView(id: string): Promise<CustomerListRow | null>;

  /** 下拉选项（车辆建档、选择器用） */
  listOptions(limit: number): Promise<Array<{ id: string; name: string; phone: string }>>;

  /** 按手机号取客户 + 名下车辆（新建工单时按手机号带出车辆） */
  findByPhoneWithVehicles(phone: string): Promise<{
    id: string;
    name: string;
    phone: string;
    vehicles: Array<{ id: string; plateNumber: string }>;
  } | null>;

  /**
   * 一次聚合出多个客户的「累计消费 / 已收 / 最近到店」。
   * 返回原始合计值，消费与欠款的差额计算留给领域层（金额规则不写在 SQL 里）。
   */
  aggregateOrderStats(customerIds: string[]): Promise<CustomerOrderStatsRow[]>;

  create(data: {
    name: string;
    phone: string;
    createdBy: string | null;
  }): Promise<{ id: string; name: string }>;

  /** 编辑表单回填所需字段 */
  findForEdit(id: string): Promise<{
    id: string;
    name: string;
    phone: string;
    wechat: string | null;
    address: string | null;
    remark: string | null;
  } | null>;

  update(
    id: string,
    patch: {
      name: string;
      phone: string;
      wechat: string | null;
      address: string | null;
      remark: string | null;
    },
  ): Promise<void>;

  /** 删除前校验：需要知道名下有多少工单 / 车辆 */
  findForDelete(id: string): Promise<{
    id: string;
    name: string;
    phone: string;
    workOrderCount: number;
    vehicleCount: number;
  } | null>;

  softDelete(id: string): Promise<void>;

  /** 客户是否存在且未删除（建档车辆前校验） */
  existsActive(id: string): Promise<boolean>;

  /** 在册客户数（首页 KPI） */
  countActive(): Promise<number>;

  /** 某区间内新增客户数（报表自定义区间汇总） */
  countCreatedBetween(from: Date, to: Date): Promise<number>;

  /** 全局搜索：姓名 / 手机 / 微信 模糊匹配 */
  searchForGlobal(keyword: string, limit: number): Promise<SearchCustomerRow[]>;

  /** 联想建议：姓名或手机号匹配 */
  suggest(keyword: string, limit: number): Promise<CustomerSuggestionRow[]>;
}

export interface VehicleRepository {
  findIdByPlate(plateNumber: string): Promise<{ id: string; customerId: string } | null>;

  /** 车辆列表（关键字命中车牌 / VIN / 品牌 / 型号 / 客户姓名 / 客户手机） */
  list(
    filter: {
      keyword?: string;
      customerId?: string;
      /** 仅看「在此日期前该保养」的车辆（30 天口径由领域层决定后传入） */
      dueServiceBefore?: Date;
    },
    paging: { skip: number; take: number },
  ): Promise<{ rows: VehicleListRow[]; total: number }>;

  /** 详情主表：列表投影 + engineNo / remark */
  findDetailBaseById(id: string): Promise<VehicleDetailBaseRow | null>;

  /**
   * 按车牌取详情主表。`excludeId` 用于「改车牌时排除自身」。
   * 同时服务三个场景：建单按车牌查车、新建车辆查重、修改车辆查重。
   */
  findDetailBaseByPlate(
    plateNumber: string,
    excludeId?: string,
  ): Promise<VehicleDetailBaseRow | null>;

  create(data: {
    customerId: string;
    plateNumber: string;
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    vin?: string | null;
    engineNo?: string | null;
    currentMileage?: number | null;
    lastServiceAt?: Date | null;
    nextServiceAt?: Date | null;
    remark?: string | null;
  }): Promise<{ id: string; plateNumber: string }>;

  /** 车辆过户：把车牌改挂到另一个客户名下 */
  reassignToCustomer(id: string, customerId: string): Promise<void>;

  /** 编辑表单回填 / 归属校验所需的最小行 */
  findForEdit(id: string): Promise<{ id: string; plateNumber: string; customerId: string } | null>;

  update(
    id: string,
    patch: {
      customerId: string;
      plateNumber: string;
      brand: string | null;
      model: string | null;
      year: number | null;
      vin: string | null;
      engineNo: string | null;
      currentMileage: number | null;
      lastServiceAt: Date | null;
      nextServiceAt: Date | null;
      remark: string | null;
    },
  ): Promise<void>;

  /** 删除前校验：需要知道名下有多少工单 */
  findForDelete(id: string): Promise<{
    id: string;
    plateNumber: string;
    workOrderCount: number;
  } | null>;

  softDelete(id: string): Promise<void>;

  /** 某客户名下车辆（客户详情页） */
  listByCustomer(customerId: string): Promise<VehicleListRow[]>;

  /** 删除客户时级联软删除其车辆（与客户删除同事务） */
  softDeleteByCustomer(customerId: string): Promise<void>;

  /** 保养记录时间线（带所属工单号） */
  listServiceRecords(vehicleId: string, take: number): Promise<VehicleServiceRecordRow[]>;

  /** 临近保养车辆（首页待处理事项）；截止日期由领域层算好传入 */
  listDueService(before: Date, limit: number): Promise<DueServiceVehicleRow[]>;

  /** 完工时回写保养信息 */
  updateServiceInfo(
    id: string,
    patch: { currentMileage?: number | null; lastServiceAt: Date; nextServiceAt?: Date | null },
  ): Promise<void>;

  createServiceRecord(data: {
    vehicleId: string;
    workOrderId?: string | null;
    servicedAt: Date;
    mileage?: number | null;
    description: string;
    nextServiceAt?: Date | null;
    nextServiceMileage?: number | null;
    createdBy: string | null;
  }): Promise<VehicleServiceRecord>;
  /** 解除保养记录对工单的引用（工单硬删除时保留记录本身） */
  detachServiceRecordsFromWorkOrder(workOrderId: string): Promise<void>;

  /** 全局搜索：车牌 / VIN / 品牌 / 型号 模糊匹配 */
  searchForGlobal(keyword: string, limit: number): Promise<SearchVehicleRow[]>;

  /** 联想建议：仅按车牌匹配 */
  suggestByPlate(keyword: string, limit: number): Promise<VehicleSuggestionRow[]>;
}

// ---------------------------------------------------------------------------
// 库存
// ---------------------------------------------------------------------------

/** 加锁后的库存行 —— 「读-算-写」期间防止并发超卖 */
export interface LockedInventoryRow {
  id: string;
  quantity: Money;
  avgCost: Money;
  safeQuantity: Money;
}

export interface InventoryTransactionCreateData {
  partId: string;
  type: InventoryTxType;
  quantity: Money;
  qtyBefore: Money;
  qtyAfter: Money;
  unitCost?: Money | null;
  amount?: Money | null;
  workOrderId?: string | null;
  operatorId?: string | null;
  remark?: string | null;
}

export interface InventoryRepository {
  /**
   * 取某配件的库存行并加排他锁；不存在时补建。
   * PostgreSQL 用 `SELECT ... FOR UPDATE`；SQLite 靠写事务串行化。
   * 必须在事务中调用，否则锁会立即释放，失去防超卖意义。
   */
  lockOrCreate(partId: string): Promise<LockedInventoryRow>;

  /** 写回库存数量与移动加权均价 */
  applyChange(partId: string, patch: { quantity: Money; avgCost: Money }): Promise<void>;

  appendTransaction(data: InventoryTransactionCreateData): Promise<{ id: string }>;

  /** 库存流水列表（可按配件 / 类型过滤） */
  listTransactions(
    filter: { partId?: string; type?: InventoryTxType },
    paging: { skip: number; take: number },
  ): Promise<{ rows: InventoryTxRow[]; total: number }>;

  /**
   * 库存估值明细（报表「库存总金额」用）。
   * 只提供原始值：是否有均价、回退进货价的规则由领域层决定。
   */
  listValuationLines(): Promise<StockValuationLine[]>;

  /** 解除库存流水对工单的引用（工单硬删除时保留流水本身，财务可追溯） */
  detachWorkOrder(workOrderId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// 配件档案
// ---------------------------------------------------------------------------

/** 工单项落库时需要的配件快照 */
export interface PartSnapshot {
  name: string;
  spec: string | null;
  unit: string;
  costPrice: Money;
  /** 库存均价（无库存行时为 null，此时回退到 costPrice） */
  avgCost: Money | null;
}

/** 建档 / 编辑配件时同步维护库存行的入参 */
export interface PartWriteData {
  code: string | null;
  name: string;
  spec: string | null;
  brand: string | null;
  unit: string;
  categoryId: string | null;
  supplierId: string | null;
  costPrice: Money;
  salePrice: Money;
  remark: string | null;
}

export interface PartRepository {
  /** 工单项落库时的配件快照（名称 / 规格 / 单位 / 成本） */
  findSnapshot(partId: string): Promise<PartSnapshot | null>;

  /**
   * 配件出库记账所需的两个成本值。
   * 「优先库存均价、回退最近进货价」属于业务规则，由领域层决定。
   */
  findUnitCost(partId: string): Promise<{ costPrice: Money; avgCost: Money | null } | null>;

  /** 只需 id + 名称的场景（采购入库） */
  findBrief(id: string): Promise<{ id: string; name: string } | null>;

  /** 库存调整：当前库存数量 */
  findStockLevel(id: string): Promise<PartStockLevelRow | null>;

  /** 库存盘点：批量取现状 */
  listStockLevels(ids: string[]): Promise<PartStockLevelRow[]>;

  /** 配件列表（关键字命中名称 / 规格 / 品牌 / 编码） */
  list(
    filter: {
      keyword?: string;
      categoryId?: string;
      includeInactive?: boolean;
      /** 只看库存为 0 或负数的配件 */
      zeroStockOnly?: boolean;
      /** 只看有库存行的配件（低库存清单的候选集） */
      hasInventoryRowOnly?: boolean;
    },
    paging: { skip: number; take: number },
  ): Promise<{ rows: PartListRow[]; total: number }>;

  /**
   * 低库存判定所需的候选集：启用中且已有库存行的配件。
   * 是否真的低于安全库存由领域层比较（列间比较无法在 SQL 里通用表达）。
   */
  listLowStockCandidates(): Promise<PartListRow[]>;

  /** 配件详情主表 */
  findDetail(id: string): Promise<PartDetailRow | null>;

  /** 编辑表单回填所需字段 */
  findForEdit(id: string): Promise<{
    id: string;
    code: string | null;
    name: string;
    spec: string | null;
    brand: string | null;
    unit: string;
    categoryId: string | null;
    supplierId: string | null;
    remark: string | null;
    safeQuantity: Money | null;
    location: string | null;
  } | null>;

  /** 建档配件：同时创建库存行（同一事务） */
  createWithInventory(
    data: PartWriteData,
    inventory: { safeQuantity: Money; location: string | null },
  ): Promise<{ id: string; name: string }>;

  /** 编辑配件档案与库存行（同一事务） */
  updateWithInventory(
    id: string,
    data: PartWriteData,
    inventory: { safeQuantity: Money; location: string | null },
  ): Promise<void>;

  /** 删除前校验：剩余库存必须为 0 */
  findForDelete(id: string): Promise<{ id: string; name: string; quantity: Money | null } | null>;

  softDelete(id: string): Promise<void>;

  /** 采购入库时按需回写最近进货价与供应商 */
  updateCostAndSupplier(
    id: string,
    patch: { costPrice: Money; supplierId?: string | null },
  ): Promise<void>;

  /** 配件选择器搜索 */
  searchForPicker(keyword: string, limit: number): Promise<PartPickerRow[]>;

  /** 全局搜索：名称 / 规格 / 编码 / 品牌 模糊匹配（带库存与安全库存） */
  searchForGlobal(keyword: string, limit: number): Promise<SearchPartRow[]>;

  /** 启用中且未删除的配件总数（库存页概览） */
  countActive(): Promise<number>;
}

// ---------------------------------------------------------------------------
// 基础资料（分类 / 供应商 / 维修项目目录）
// ---------------------------------------------------------------------------

export interface CatalogRepository {
  findServiceItemCost(id: string): Promise<Money | null>;

  /** 维修项目 / 工时目录（工单选择器数据源） */
  listServiceItems(params: {
    keyword?: string;
    kind?: WorkOrderItemType;
    limit: number;
  }): Promise<ServiceItemPickerRow[]>;

  createServiceItem(data: {
    code: string | null;
    name: string;
    kind: WorkOrderItemType;
    categoryId: string | null;
    unit: string;
    defaultPrice: Money;
    defaultHours: Money | null;
    costPrice: Money;
    sortOrder: number;
    remark: string | null;
  }): Promise<{ id: string; name: string }>;

  listCategories(kind?: CategoryKind): Promise<CategoryOptionRow[]>;

  findCategoryByName(kind: CategoryKind, name: string): Promise<{ id: string } | null>;

  createCategory(data: {
    name: string;
    kind: CategoryKind;
    sortOrder: number;
  }): Promise<CategoryOptionRow>;

  listSuppliers(): Promise<SupplierOptionRow[]>;

  createSupplier(data: {
    name: string;
    contact: string | null;
    phone: string | null;
    address: string | null;
    remark: string | null;
  }): Promise<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// 财务
// ---------------------------------------------------------------------------

export interface FinanceRepository {
  /** 工单取消时作废该工单全部收款，返回作废条数 */
  voidPaymentsByWorkOrder(workOrderId: string, reason: string): Promise<number>;

  /** 登记一笔收款流水 */
  createPayment(data: {
    workOrderId?: string | null;
    customerId?: string | null;
    source: IncomeSource;
    category: IncomeCategory;
    amount: Money;
    method: PaymentMethod;
    occurredAt: Date;
    operatorId: string | null;
    remark?: string | null;
  }): Promise<{ id: string }>;

  /** 工单上未被作废的收款合计（已收金额的唯一口径） */
  sumPaymentsByWorkOrder(workOrderId: string): Promise<Money>;

  /** 作废前的行读取 */
  findPaymentForVoid(id: string): Promise<{
    id: string;
    amount: Money;
    workOrderId: string | null;
    remark: string | null;
  } | null>;

  /** 作废收款（软删除并追加原因，保留痕迹） */
  voidPayment(id: string, remark: string): Promise<void>;

  /** 收款流水列表（按发生时间区间 + 关键字） */
  listPayments(
    filter: { from: Date; to: Date; keyword?: string },
    paging: { skip: number; take: number },
  ): Promise<{ rows: PaymentRow[]; total: number }>;

  /** 按收入分类汇总（分页前的全量口径） */
  groupPaymentsByCategory(
    from: Date,
    to: Date,
  ): Promise<Array<{ category: IncomeCategory; amount: Money | null; count: number }>>;

  /** 按支付方式汇总 */
  groupPaymentsByMethod(
    from: Date,
    to: Date,
  ): Promise<Array<{ method: PaymentMethod; amount: Money | null; count: number }>>;

  /** 登记一笔支出流水（采购入库时也走这里自动记账） */
  createExpense(data: {
    category: ExpenseCategory;
    amount: Money;
    method: PaymentMethod;
    occurredAt: Date;
    supplierId?: string | null;
    workOrderId?: string | null;
    operatorId: string | null;
    remark?: string | null;
  }): Promise<{ id: string }>;

  /** 修改支出前的行读取 */
  findExpenseForEdit(id: string): Promise<{
    id: string;
    category: ExpenseCategory;
    amount: Money;
    method: PaymentMethod;
    occurredAt: Date;
    remark: string | null;
  } | null>;

  updateExpense(
    id: string,
    patch: {
      category: ExpenseCategory;
      amount: Money;
      method: PaymentMethod;
      occurredAt: Date;
      supplierId: string | null;
      workOrderId: string | null;
      remark: string | null;
    },
  ): Promise<void>;

  /** 删除支出前的行读取 */
  findExpenseForDelete(id: string): Promise<{
    id: string;
    category: ExpenseCategory;
    amount: Money;
    remark: string | null;
  } | null>;

  softDeleteExpense(id: string): Promise<void>;

  /** 支出流水列表 */
  listExpenses(
    filter: { from: Date; to: Date; keyword?: string },
    paging: { skip: number; take: number },
  ): Promise<{ rows: ExpenseRow[]; total: number }>;

  /** 按支出分类汇总 */
  groupExpensesByCategory(
    from: Date,
    to: Date,
  ): Promise<Array<{ category: ExpenseCategory; amount: Money | null; count: number }>>;

  /** 区间内的收款合计（首页 KPI，口径 = 未作废收款） */
  sumPaymentsInRange(from: Date, to: Date): Promise<Money>;

  /** 区间内的支出合计（首页 KPI，口径 = 未删除支出） */
  sumExpensesInRange(from: Date, to: Date): Promise<Money>;

  /** 区间内的收款明细（趋势图按日归集，归集与补零由领域层负责） */
  listPaymentEntries(from: Date, to: Date): Promise<Array<{ amount: Money; occurredAt: Date }>>;

  /** 区间内的支出明细 */
  listExpenseEntries(from: Date, to: Date): Promise<Array<{ amount: Money; occurredAt: Date }>>;
}

// ---------------------------------------------------------------------------
// 账号 / 员工
// ---------------------------------------------------------------------------
// 说明：登录会话（`sessions` 表）不走仓储 —— 它属于鉴权基础设施，
// 见 `src/server/auth/session.ts`。手机端将改用设备令牌方案，两者互不影响。

export interface UserRepository {
  /** 账号列表（含建单数 / 收款数，用于管理页展示） */
  list(): Promise<UserListRow[]>;

  /** 新建账号时的用户名占用检查（需要区分「已停用」与「已存在」） */
  findByUsernameAny(username: string): Promise<{ id: string; deletedAt: Date | null } | null>;

  /** 登录凭据读取：排除已删除账号，但保留停用账号以便返回专门提示 */
  findForLogin(username: string): Promise<{
    id: string;
    name: string;
    passwordHash: string;
    role: Role;
    isActive: boolean;
  } | null>;

  create(data: {
    username: string;
    name: string;
    phone: string | null;
    passwordHash: string;
    role: Role;
  }): Promise<{ id: string; name: string; username: string }>;

  /** 修改账号前的行读取（含自我保护 / 最后管理员判断所需字段） */
  findForEdit(
    id: string,
  ): Promise<{ id: string; name: string; role: Role; isActive: boolean } | null>;

  update(
    id: string,
    patch: { name: string; phone: string | null; role: Role; isActive: boolean },
  ): Promise<void>;

  /** 启用状态的管理员数量（保证系统至少留一名） */
  countActiveAdmins(): Promise<number>;

  /** 重置密码 / 改密码前的行读取 */
  findBrief(id: string): Promise<{ id: string; name: string } | null>;

  /** 改自己密码时需要校验当前密码 */
  findWithPassword(id: string): Promise<{ id: string; name: string; passwordHash: string } | null>;

  /** 个人资料回填 */
  findOwnProfile(id: string): Promise<{ id: string; name: string; phone: string | null } | null>;

  updatePassword(id: string, passwordHash: string): Promise<void>;

  /** 登录成功后记录最后登录时间 */
  recordLogin(id: string): Promise<void>;

  updateProfile(id: string, patch: { name: string; phone: string | null }): Promise<void>;

  /** 停用账号（软删除 + 停用） */
  softDelete(id: string): Promise<void>;

  /** 员工档案（技师）列表 */
  listEmployees(onlyActive: boolean): Promise<EmployeeListRow[]>;

  /** 新增 / 修改员工档案 */
  saveEmployee(data: {
    id?: string;
    name: string;
    phone: string | null;
    position: string | null;
    isTechnician: boolean;
    userId: string | null;
    remark: string | null;
  }): Promise<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

export interface AuditLogInput {
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditLogFilter {
  userId?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
}

export interface AuditLogListResult {
  rows: AuditLog[];
  total: number;
}

export interface AuditRepository {
  append(data: AuditLogInput): Promise<void>;
  list(filter: AuditLogFilter, paging: { skip: number; take: number }): Promise<AuditLogListResult>;
  findById(id: string): Promise<AuditLog | null>;
}
