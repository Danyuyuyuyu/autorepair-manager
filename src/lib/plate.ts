/**
 * 车牌号的纯函数工具（ADR-017）。
 *
 * 三条规则：
 * 1. 归一化只做「无损改写」：全角转半角、去掉空白与间隔符、统一大写。
 *    **绝不猜车牌结构** —— 不自动补省份简称、不对新能源/港澳/军牌做特判。
 * 2. 同一个 `normalizePlate` 被前端输入框、zod 校验、仓储匹配共用，
 *    避免出现「搜得到但存不进去」或「存进去但搜不到」的分裂。
 * 3. 只有新建车辆才做格式校验（`isPlausiblePlate`）；
 *    查询与联想**一律不校验** —— 联想必须允许任何半截输入。
 *
 * 本文件必须保持纯函数（不 import React / Prisma / node:*），
 * 前端与服务端、两种存储都用同一份规则。
 */

/** 全角 ASCII（！-～）与半角的码位差 */
const HALF_WIDTH_OFFSET = 0xfee0;

/**
 * 车牌候选的触发下限：少于 2 个字符不查询。
 * 车牌首字是省份简称，单字命中面过大（输「粤」会刷出一屏）。
 */
export const PLATE_SUGGEST_MIN_LENGTH = 2;

/** 一次最多展示的候选条数 */
export const PLATE_SUGGEST_LIMIT = 8;

/**
 * 取数窗口 = limit × 该倍数（上限 {@link PLATE_SUGGEST_MAX_WINDOW}）。
 *
 * 仓储按「最近进厂」取一个放大的窗口，业务层再用 {@link rankPlateCandidates}
 * 把前缀命中提到前面。窗口放大是为了让前缀命中不至于被时间排序切掉。
 */
export const PLATE_SUGGEST_WINDOW_FACTOR = 3;

/** 取数窗口上限 */
export const PLATE_SUGGEST_MAX_WINDOW = 30;

/** 全角 ASCII 与全角空格 → 半角；汉字不受影响 */
function toHalfWidth(input: string): string {
  return input
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - HALF_WIDTH_OFFSET))
    .replace(/\u3000/g, " ");
}

/**
 * 车牌归一化：全角转半角 → 去掉所有空白与间隔符（· ・ - _）→ 统一大写。
 * 幂等：`normalizePlate(normalizePlate(x)) === normalizePlate(x)`。
 */
export function normalizePlate(input: string): string {
  return toHalfWidth(input)
    .replace(/[\s\u00b7\u30fb\-_]/g, "")
    .toUpperCase();
}

/**
 * 车牌格式是否「像一块真车牌」：
 * 1 个汉字（省份简称 / 军种字）+ 1 个字母（发牌机关）+ 5~6 位字母数字。
 * 覆盖普通 7 位（粤A12345）与新能源 8 位（粤AD12345）。
 *
 * 临时牌（粤A1234临）、港澳牌等非标车牌会被判为不合法 ——
 * 这是 ADR-017 明确接受的取舍：宁可少一道闸，也不猜车牌结构。
 */
const PLATE_PATTERN = /^[\u4e00-\u9fa5][A-Z][A-Z0-9]{5,6}$/;

export function isPlausiblePlate(input: string): boolean {
  return PLATE_PATTERN.test(normalizePlate(input));
}

/**
 * 用于「匹配」的车牌关键字：归一化后再摘掉 LIKE 通配符（`% _ \`）。
 *
 * 车牌永远不含这三个字符，因此摘掉它们是无损的；好处是**两种存储的匹配
 * 结果必然一致** —— Prisma 的 `contains` 无法附加 `ESCAPE` 子句，
 * 而 SQLite 侧用 `instr`/`ESCAPE` 都行，只有「先摘掉」这条路两边完全等价。
 *
 * 业务层必须先过这个函数再判断最小长度，否则用户输入 `%%` 会被当成
 * 2 个有效字符而命中全库。
 */
export function plateMatchKeyword(input: string): string {
  return normalizePlate(input).replace(/[\\%_]/g, "");
}

/**
 * LIKE 通配符转义，配合 SQL 的 `ESCAPE '\\'` 使用。
 *
 * `plateMatchKeyword` 已经把通配符摘掉了，这里是**第二层保险**：
 * 仓储可能被直接以原始关键字调用（契约脚本就是这么做的）。
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 候选排序所需的最小形状（由仓储行满足） */
export interface RankablePlateCandidate {
  plateNumber: string;
  /** 最近一次进厂（工单创建时间）；从未进厂为 null */
  lastVisitAt: Date | null;
  /** 车辆档案更新时间，用于同优先级兜底排序 */
  updatedAt: Date;
}

/**
 * 候选排序：**前缀命中 > 最近进厂 > 车辆档案更新时间**。
 *
 * 为什么在 JS 里排而不是 SQL：Prisma 的 orderBy 无法表达「前缀优先」这类
 * CASE 排序，硬写进 SQL 会让 PostgreSQL 与 SQLite 两种实现行为分叉。
 * 排序做成纯函数后，两种存储共用同一套语义，也能被契约脚本直接测到。
 *
 * `Array.prototype.sort` 是稳定排序，因此完全同序的候选保持仓储返回顺序。
 */
export function rankPlateCandidates<T extends RankablePlateCandidate>(
  candidates: readonly T[],
  keyword: string,
): T[] {
  const key = normalizePlate(keyword);
  const prefixRank = (plateNumber: string): number =>
    key.length > 0 && normalizePlate(plateNumber).startsWith(key) ? 0 : 1;

  return [...candidates].sort((a, b) => {
    const byPrefix = prefixRank(a.plateNumber) - prefixRank(b.plateNumber);
    if (byPrefix !== 0) return byPrefix;

    // 可空时间**不能相减**：null 与 null 相减会得到 NaN，
    // 比较器返回 NaN 会让整个排序结果变成未定义顺序（本契约实测踩到过）。
    const visitA = a.lastVisitAt ? a.lastVisitAt.getTime() : null;
    const visitB = b.lastVisitAt ? b.lastVisitAt.getTime() : null;
    if (visitA !== visitB) {
      if (visitA === null) return 1; // 从没进过厂的排在有进厂记录之后
      if (visitB === null) return -1;
      return visitB - visitA;
    }

    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}
