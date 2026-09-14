/**
 * 展示层格式化工具
 * 注意：这里只负责「显示」，不参与任何金额运算。
 */
import { D } from "@/lib/money";

/** ¥1,234.56 */
export function formatMoney(
  value: unknown,
  options?: { withSymbol?: boolean; decimals?: number },
): string {
  const { withSymbol = true, decimals = 2 } = options ?? {};
  const n = D(value as never)
    .toDecimalPlaces(decimals, 1)
    .toNumber();
  const text = n.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return withSymbol ? `¥${text}` : text;
}

/** 大额金额缩写：12345 -> 1.23万 */
export function formatMoneyCompact(value: unknown): string {
  const n = D(value as never).toNumber();
  const abs = Math.abs(n);
  if (abs >= 100000000) return `¥${(n / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `¥${(n / 10000).toFixed(2)}万`;
  return formatMoney(value);
}

/** 数量：整数不带小数，小数保留 2 位 */
export function formatQuantity(value: unknown, unit?: string): string {
  const n = D(value as never).toNumber();
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return unit ? `${text} ${unit}` : text;
}

/** 手机号脱敏 */
export function maskPhone(phone?: string | null): string {
  if (!phone) return "-";
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone;
}

const DATE_FMT = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Shanghai",
});

const DATETIME_FMT = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai",
});

const TIME_FMT = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai",
});

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  return DATE_FMT.format(new Date(value));
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  return DATETIME_FMT.format(new Date(value));
}

export function formatTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  return TIME_FMT.format(new Date(value));
}

/** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 昨天 / 日期 */
export function formatRelative(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 2 * day) return "昨天";
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDate(value);
}

/** 日期区间标签：2026-09-14 */
export function toDateKey(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 百分比 */
export function formatPercent(rate: number, decimals = 1): string {
  if (!Number.isFinite(rate)) return "0%";
  return `${(rate * 100).toFixed(decimals)}%`;
}
