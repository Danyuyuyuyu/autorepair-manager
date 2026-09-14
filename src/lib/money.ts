/**
 * 金额计算中枢 —— 全系统唯一金额运算入口
 * ---------------------------------------------------------------------------
 * 规则：
 * 1. 金额一律使用 Decimal，禁止用 number 做加减乘除后落库
 * 2. 所有对外输出在最后一步统一保留 2 位小数（四舍五入）
 * 3. 任何页面 / 组件都不允许自己实现金额公式，只能调用本模块
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -9, toExpPos: 21 });

/** 可被金额函数接受的输入类型（Prisma.Decimal 亦满足） */
export type DecimalInput = Decimal | string | number | { toString(): string } | null | undefined;

/** 空值安全的 Decimal 构造函数 */
export function D(value: DecimalInput): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  try {
    return new Decimal(value.toString());
  } catch {
    return new Decimal(0);
  }
}

/** 归一化为「元」，保留 2 位小数 */
export function money(value: DecimalInput): Decimal {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** 数量归一化，保留 2 位小数 */
export function qty(value: DecimalInput): Decimal {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** 仅在展示 / 图表场景使用：转 number */
export function toNumber(value: DecimalInput): number {
  return D(value).toNumber();
}

/** 单价 × 数量 = 行金额 */
export function lineAmount(quantity: DecimalInput, unitPrice: DecimalInput): Decimal {
  return money(D(quantity).times(D(unitPrice)));
}

/** 求和 */
export function sumMoney(values: DecimalInput[]): Decimal {
  return money(values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0)));
}

// ---------------------------------------------------------------------------
// 工单金额计算
// ---------------------------------------------------------------------------

export interface OrderItemLike {
  type: "SERVICE" | "PART" | "LABOR" | "OTHER";
  quantity: DecimalInput;
  unitPrice: DecimalInput;
  costPrice?: DecimalInput;
}

export interface OrderTotals {
  /** 维修项目费 */
  serviceAmount: Decimal;
  /** 配件费 */
  partsAmount: Decimal;
  /** 工时费 */
  laborAmount: Decimal;
  /** 其他费用 */
  otherAmount: Decimal;
  /** 小计（优惠前） */
  subtotal: Decimal;
  /** 优惠金额（不会超过小计） */
  discountAmount: Decimal;
  /** 应收金额 */
  totalAmount: Decimal;
  /** 配件成本合计（毛利计算用） */
  partsCost: Decimal;
  /** 全部成本合计（配件 + 工时人工成本） */
  totalCost: Decimal;
}

/**
 * 工单金额计算的唯一实现。
 * 优惠金额允许传入大于小计的值，会被自动钳制到小计，避免出现负应收。
 */
export function calcOrderTotals(items: OrderItemLike[], discount: DecimalInput = 0): OrderTotals {
  let service = new Decimal(0);
  let parts = new Decimal(0);
  let labor = new Decimal(0);
  let other = new Decimal(0);
  let partsCost = new Decimal(0);
  let laborCost = new Decimal(0);

  for (const item of items) {
    const amount = D(item.quantity).times(D(item.unitPrice));
    const cost = D(item.quantity).times(D(item.costPrice ?? 0));
    switch (item.type) {
      case "SERVICE":
        service = service.plus(amount);
        break;
      case "PART":
        parts = parts.plus(amount);
        partsCost = partsCost.plus(cost);
        break;
      case "LABOR":
        labor = labor.plus(amount);
        laborCost = laborCost.plus(cost);
        break;
      case "OTHER":
        other = other.plus(amount);
        break;
    }
  }

  const subtotal = service.plus(parts).plus(labor).plus(other);
  const rawDiscount = D(discount);
  const discountAmount = rawDiscount.isNegative()
    ? new Decimal(0)
    : Decimal.min(rawDiscount, subtotal);

  return {
    serviceAmount: money(service),
    partsAmount: money(parts),
    laborAmount: money(labor),
    otherAmount: money(other),
    subtotal: money(subtotal),
    discountAmount: money(discountAmount),
    totalAmount: money(subtotal.minus(discountAmount)),
    partsCost: money(partsCost),
    totalCost: money(partsCost.plus(laborCost)),
  };
}

/** 未收金额 = 应收 - 已收（不会为负，溢收单独展示） */
export function outstanding(total: DecimalInput, paid: DecimalInput): Decimal {
  const diff = D(total).minus(D(paid));
  return diff.isNegative() ? new Decimal(0) : money(diff);
}

/** 溢收金额 */
export function overpaid(total: DecimalInput, paid: DecimalInput): Decimal {
  const diff = D(paid).minus(D(total));
  return diff.isNegative() ? new Decimal(0) : money(diff);
}

/** 毛利率（0-1），除零返回 0 */
export function grossMarginRate(revenue: DecimalInput, cost: DecimalInput): number {
  const rev = D(revenue);
  if (rev.isZero()) return 0;
  return D(rev).minus(D(cost)).div(rev).toNumber();
}

/**
 * 移动加权平均成本
 * newAvg = (旧库存 × 旧均价 + 入库数量 × 入库单价) / (旧库存 + 入库数量)
 */
export function weightedAverageCost(
  oldQty: DecimalInput,
  oldAvgCost: DecimalInput,
  inQty: DecimalInput,
  inUnitCost: DecimalInput,
): Decimal {
  const prevQty = D(oldQty);
  const totalQty = prevQty.plus(D(inQty));
  if (totalQty.lte(0)) return money(D(inUnitCost));
  const totalValue = prevQty.times(D(oldAvgCost)).plus(D(inQty).times(D(inUnitCost)));
  return totalValue.div(totalQty).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** 安全除法，避免出现 NaN / Infinity */
export function safeRatio(numerator: DecimalInput, denominator: DecimalInput): number {
  const den = D(denominator);
  if (den.isZero()) return 0;
  return D(numerator).div(den).toNumber();
}
