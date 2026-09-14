/**
 * 车牌联想纯函数契约
 * ---------------------------------------------------------------------------
 * 覆盖 `src/lib/plate.ts` 的四组规则：
 *   1. 归一化（全角/空白/间隔符/大小写、幂等性）
 *   2. 新建车辆的格式闸门（`isPlausiblePlate`）
 *   3. LIKE 通配符转义（不然输入 % 会命中全库）
 *   4. 候选排序（前缀命中 > 最近进厂 > 更新时间）
 *
 * 为什么需要它：这四条规则同时被前端输入框、zod 校验、Prisma 仓储、
 * SQLite 仓储四处使用，一旦有人只改一处就会出现「搜得到但存不进去」。
 * 排序尤其重要 —— 它必须与存储无关，否则 PostgreSQL 与 SQLite 会行为分叉。
 *
 * 本脚本不连数据库，`pnpm plate:contract` 可随时跑。
 */
import {
  PLATE_SUGGEST_MIN_LENGTH,
  escapeLikePattern,
  isPlausiblePlate,
  normalizePlate,
  plateMatchKeyword,
  rankPlateCandidates,
} from "../src/lib/plate";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

function eq(actual: unknown, expected: unknown): string {
  return `实际 ${JSON.stringify(actual)} / 预期 ${JSON.stringify(expected)}`;
}

// ---------------------------------------------------------------------------
console.log("【1】归一化");
// ---------------------------------------------------------------------------
check(
  "全角字母与数字转半角",
  normalizePlate("粤Ａ１２３４５") === "粤A12345",
  normalizePlate("粤Ａ１２３４５"),
);
check("小写转大写", normalizePlate("粤a12345") === "粤A12345");
check("去掉半角空格", normalizePlate(" 粤 A 12345 ") === "粤A12345");
check("去掉全角空格", normalizePlate("粤\u3000A12345") === "粤A12345");
check("去掉间隔符 · 与 ・", normalizePlate("粤·A・12345") === "粤A12345");
check(
  "去掉连字符与下划线",
  normalizePlate("粤A-12345") === "粤A12345" && normalizePlate("粤A_12345") === "粤A12345",
);
check("汉字不受影响", normalizePlate("粤A12345") === "粤A12345");
check(
  "全角与半角输入归一到同一个值",
  normalizePlate("粤Ａ１２３４５") === normalizePlate("粤A12345"),
);
check("幂等", normalizePlate(normalizePlate(" 粤·Ａ12345 ")) === normalizePlate(" 粤·Ａ12345 "));
check("空串不炸", normalizePlate("") === "" && normalizePlate("   ") === "");

// ---------------------------------------------------------------------------
console.log("\n【2】新建车辆的格式闸门");
// ---------------------------------------------------------------------------
check("普通 7 位车牌合法", isPlausiblePlate("粤A12345"));
check("新能源 8 位车牌合法", isPlausiblePlate("粤AD12345"));
check("归一化后再判断（全角输入也算合法）", isPlausiblePlate("粤Ａ１２３４５"));
check("军牌（汉字 + 字母 + 5 位）合法", isPlausiblePlate("军A12345"));
check("半截车牌不合法（本次要拦的核心脏数据）", !isPlausiblePlate("粤A1"));
check("纯数字不合法", !isPlausiblePlate("12345"));
check("无省份汉字不合法（如测试数据 CAT...-plate）", !isPlausiblePlate("CAT1789391318098-plate"));
check("位数不足不合法", !isPlausiblePlate("粤A1234"));
check("位数过多不合法", !isPlausiblePlate("粤A1234567"));
check("只有省份不合法", !isPlausiblePlate("粤"));
check(
  "冒烟测试用的车牌仍然合法（粤SMOKE1 / 粤SMOKEF1）",
  isPlausiblePlate("粤SMOKE1") && isPlausiblePlate("粤SMOKEF1"),
);

// ---------------------------------------------------------------------------
console.log("\n【3】LIKE 通配符转义");
// ---------------------------------------------------------------------------
check(
  "% 被转义（否则命中全库）",
  escapeLikePattern("100%") === "100\\%",
  eq(escapeLikePattern("100%"), "100\\%"),
);
check("_ 被转义", escapeLikePattern("A_1") === "A\\_1");
check("反斜杠自身被转义", escapeLikePattern("a\\b") === "a\\\\b");
check("普通车牌不被改动", escapeLikePattern("粤A12345") === "粤A12345");
check("转义后可安全拼进 LIKE 模式", escapeLikePattern(normalizePlate(" 100% ")) === "100\\%");

// ---------------------------------------------------------------------------
console.log("\n【3b】匹配关键字（两种存储共用的同一套摘除规则）");
// ---------------------------------------------------------------------------
check(
  "摘掉 % 与 _（车牌不含它们）",
  plateMatchKeyword("100%") === "100" && plateMatchKeyword("A_1") === "A1",
);
check("摘掉反斜杠", plateMatchKeyword("a\\b") === "AB", eq(plateMatchKeyword("a\\b"), "AB"));
check("归一化后再摘（全角输入也处理）", plateMatchKeyword("粤Ａ１２３４５") === "粤A12345");
check(
  "纯通配符输入归一化后为空（业务层据此拒绝查询，不会命中全库）",
  plateMatchKeyword("%%") === "" && plateMatchKeyword("__") === "",
);
check("普通车牌不受影响", plateMatchKeyword(" 粤a12345 ") === "粤A12345");

// ---------------------------------------------------------------------------
console.log("\n【4】候选排序");
// ---------------------------------------------------------------------------
const at = (iso: string) => new Date(iso);
const row = (plateNumber: string, lastVisitAt: string | null, updatedAt: string) => ({
  plateNumber,
  lastVisitAt: lastVisitAt ? at(lastVisitAt) : null,
  updatedAt: at(updatedAt),
});
const order = (list: Array<{ plateNumber: string }>) => list.map((r) => r.plateNumber).join(" > ");

// 关键字「粤A1234」：只有 粤A12345 是前缀命中，且它从没进过厂
const candidates = [
  row("粤B12345", "2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z"),
  row("粤A12399", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z"),
  row("粤A12345", null, "2026-01-01T00:00:00Z"),
  row("粤A12388", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z"),
];
const ranked = rankPlateCandidates(candidates, "粤A1234");
check("前缀命中排在最前（即使它从没进过厂）", ranked[0]?.plateNumber === "粤A12345", order(ranked));
check(
  "其余候选按最近进厂倒序",
  ranked[1]?.plateNumber === "粤A12388" &&
    ranked[2]?.plateNumber === "粤B12345" &&
    ranked[3]?.plateNumber === "粤A12399",
  order(ranked),
);
check(
  "关键字归一化后同样生效（全角关键字）",
  rankPlateCandidates(candidates, "粤ａ１２３４")[0]?.plateNumber === "粤A12345",
  order(rankPlateCandidates(candidates, "粤ａ１２３４")),
);

// 从没进过厂（lastVisitAt = null）的候选：排在有进厂记录之后
const withNull = [
  row("粤E10002", null, "2026-01-01T00:00:00Z"),
  row("粤E10001", "2025-05-01T00:00:00Z", "2025-05-01T00:00:00Z"),
];
check(
  "没进过厂的排在有进厂记录之后",
  order(rankPlateCandidates(withNull, "粤E")) === "粤E10001 > 粤E10002",
  order(rankPlateCandidates(withNull, "粤E")),
);

// 两个 null 相减会得到 NaN，会让整个排序变成未定义顺序 —— 这组专门守它
const bothNull = [
  row("粤F10001", null, "2026-01-01T00:00:00Z"),
  row("粤F10002", null, "2026-06-01T00:00:00Z"),
];
check(
  "都没进过厂时按档案更新时间倒序（守 null 相减的 NaN）",
  order(rankPlateCandidates(bothNull, "粤F")) === "粤F10002 > 粤F10001",
  order(rankPlateCandidates(bothNull, "粤F")),
);

const ties = [
  row("粤D10001", null, "2026-01-01T00:00:00Z"),
  row("粤D10002", null, "2026-01-01T00:00:00Z"),
];
check(
  "完全同序时保持仓储返回顺序（稳定排序）",
  order(rankPlateCandidates(ties, "粤D")) === "粤D10001 > 粤D10002",
);

check("不修改入参数组", candidates[0]?.plateNumber === "粤B12345");
check("空关键字不炸且保持稳定", rankPlateCandidates(candidates, "").length === candidates.length);
check("候选下限为 2（单字不查询）", PLATE_SUGGEST_MIN_LENGTH === 2);

// ---------------------------------------------------------------------------
const total = passed + failures.length;
if (failures.length > 0) {
  console.error(`\n✗ 车牌联想纯函数契约：${passed}/${total} 通过，失败 ${failures.length} 项：`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exitCode = 1;
} else {
  console.log(`\n车牌联想纯函数契约：${passed}/${total} 通过`);
}
