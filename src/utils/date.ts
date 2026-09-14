/**
 * 业务日期工具
 * 全部以门店所在时区（Asia/Shanghai）为准，避免服务器 UTC 导致「今日营业额」错位。
 */

export const BUSINESS_TZ = "Asia/Shanghai";

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** yyyy-MM-dd（业务时区） */
export function businessDateKey(date: Date = new Date()): string {
  return dateKeyFormatter.format(date);
}

/** yyyyMMdd */
export function businessDateCompact(date: Date = new Date()): string {
  return businessDateKey(date).replace(/-/g, "");
}

/** 业务时区当天 00:00:00 对应的 UTC 时刻 */
export function startOfBusinessDay(date: Date = new Date()): Date {
  const key = businessDateKey(date);
  return new Date(`${key}T00:00:00+08:00`);
}

/** 业务时区当天 23:59:59.999 */
export function endOfBusinessDay(date: Date = new Date()): Date {
  return new Date(startOfBusinessDay(date).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** 业务时区当月第一天 00:00:00 */
export function startOfBusinessMonth(date: Date = new Date()): Date {
  const key = businessDateKey(date);
  return new Date(`${key.slice(0, 7)}-01T00:00:00+08:00`);
}

/** 业务时区当月最后一天 23:59:59.999 */
export function endOfBusinessMonth(date: Date = new Date()): Date {
  const start = startOfBusinessMonth(date);
  const nextMonth = new Date(start);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return new Date(nextMonth.getTime() - 1);
}

/** 业务时区往前 n 天的 00:00:00 */
export function daysAgoStart(days: number, date: Date = new Date()): Date {
  const base = startOfBusinessDay(date);
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000);
}

/** 生成 [from, to) 区间内每一天的 dateKey（含头不含尾） */
export function eachDayKey(from: Date, to: Date, maxDays = 366): string[] {
  const keys: string[] = [];
  const cursor = new Date(startOfBusinessDay(from));
  const end = startOfBusinessDay(to);
  while (cursor < end && keys.length < maxDays) {
    keys.push(businessDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

/** 解析 yyyy-MM-dd 为业务时区起点 */
export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00+08:00`);
}
