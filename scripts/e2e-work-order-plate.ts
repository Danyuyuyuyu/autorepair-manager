/**
 * 新建工单「输入部分车牌 → 内联候选 → 点选锁定」真实浏览器检查（ADR-017）
 * ---------------------------------------------------------------------------
 * 这是本仓库唯一的真实浏览器检查，跑在**已启动的服务**上：
 *
 *   pnpm build && pnpm start          # 另开一个终端
 *   pnpm e2e:plate
 *
 * 环境变量：
 *   E2E_BASE_URL   默认 http://localhost:3000
 *   E2E_USERNAME   默认 admin
 *   E2E_PASSWORD   默认 admin123456
 *   E2E_PARTIAL    默认「粤A123」—— 库里必须存在以此为片段的车牌，否则用例会提示你改
 *   E2E_CHROMIUM   指定浏览器可执行文件；默认用本机已装的 Edge / Chrome
 *
 * 安全边界：**绝不点击「保存工单」**，因此不会写入任何业务数据。
 * 它只验证交互（防抖联想、键盘导航、点选锁定、保存闸门、近似车牌确认）。
 *
 * 为什么用 playwright-core 而不是 @playwright/test：本仓库的验证入口是
 * 「tsx 脚本 + 契约」这一套，引入第二个测试框架不划算；playwright-core
 * 不带浏览器下载，直接用本机 Edge/Chrome。
 */
import { chromium, type Browser } from "playwright-core";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const USERNAME = process.env.E2E_USERNAME ?? "admin";
const PASSWORD = process.env.E2E_PASSWORD ?? "admin123456";
const PARTIAL = process.env.E2E_PARTIAL ?? "粤A123";

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

/** 本机已装的 Edge / Chrome 优先，避免下载 Playwright 自带浏览器 */
async function launchBrowser(): Promise<Browser> {
  const explicit = process.env.E2E_CHROMIUM;
  if (explicit) return chromium.launch({ executablePath: explicit, headless: true });

  const attempts: Array<() => Promise<Browser>> = [
    () => chromium.launch({ channel: "msedge", headless: true }),
    () => chromium.launch({ channel: "chrome", headless: true }),
    () => chromium.launch({ headless: true }),
  ];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function main() {
  const browser = await launchBrowser();
  // 手机视口：这个功能的主战场是手机
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    // ---------------------------------------------------------------- 登录
    console.log(`【1】登录 ${BASE_URL}`);
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.fill("#username", USERNAME);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: /登\s*录/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });

    // ------------------------------------------------------ 打开新建工单
    console.log("\n【2】新建工单：未确认车辆时保存被拦住");
    await page.goto(`${BASE_URL}/work-orders/new`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const plateInput = page.getByPlaceholder("例如：粤A12345");
    await plateInput.waitFor({ state: "visible", timeout: 30000 });
    // exact: 空态那张大卡片按钮的文案里也含「保存工单」，用子串匹配会命中两个
    const saveButton = page.getByRole("button", { name: "保存工单", exact: true });
    const listbox = page.getByRole("listbox", { name: "车牌候选" });
    const options = listbox.getByRole("option");

    check("未确认车辆时「保存工单」禁用", await saveButton.isDisabled());
    check(
      "底部条提示「请先选择车辆或新建车辆」",
      await page.getByText("请先选择车辆或新建车辆").isVisible(),
    );

    // ------------------------------------------------ 输入部分车牌 → 候选
    console.log(`\n【3】输入「${PARTIAL}」出现候选`);
    await plateInput.fill(PARTIAL);
    let listVisible = true;
    try {
      await listbox.waitFor({ state: "visible", timeout: 20000 });
    } catch {
      listVisible = false;
    }
    check("输入 2 个字符以上自动出现候选（无需点查询）", listVisible);
    if (!listVisible) {
      console.error(
        `\n提示：库里没有匹配「${PARTIAL}」的车牌。请用 E2E_PARTIAL 指定一个库里存在的车牌片段。`,
      );
      return;
    }

    const count = await options.count();
    check(`候选条数 > 0（实际 ${count} 条）`, count > 0);
    const firstPlate = ((await options.first().innerText()).split("\n")[0] ?? "").trim();
    check(
      `候选展示的是车牌号（读到「${firstPlate}」）`,
      /[\u4e00-\u9fa5][A-Z][A-Z0-9]{5,6}/.test(firstPlate),
    );

    // -------------------------------------------------------- 键盘导航
    console.log("\n【4】键盘上下 + 回车选中");
    await plateInput.press("ArrowDown");
    check(
      "ArrowDown 高亮第一条候选",
      (await options.first().getAttribute("aria-selected")) === "true",
    );
    await plateInput.press("Enter");
    const reselect = page.getByRole("button", { name: "重选" });
    await reselect.waitFor({ state: "visible", timeout: 20000 });
    check("回车选中候选后锁定车辆卡（出现「重选」）", await reselect.isVisible());
    check("锁定车辆后「保存工单」解禁", !(await saveButton.isDisabled()));
    check(
      "车辆卡上就是候选里那块车牌",
      (await page.locator("body").innerText()).includes(firstPlate),
    );

    // -------------------------------------------------- Esc 收起候选列表
    console.log("\n【5】重选 / Esc");
    await reselect.click();
    await plateInput.waitFor({ state: "visible", timeout: 20000 });
    await listbox.waitFor({ state: "visible", timeout: 20000 });
    check("重选后回到输入态且候选重新出现", await listbox.isVisible());
    await plateInput.press("Escape");
    await listbox.waitFor({ state: "hidden", timeout: 10000 });
    check("Esc 收起候选列表", !(await listbox.isVisible()));

    // -------------------------------------------- 半截车牌不给建档入口
    console.log("\n【6】车牌不完整时不提供「新建车辆」");
    await plateInput.fill("粤A1");
    await page.getByText(/车牌号看起来不完整/).waitFor({ state: "visible", timeout: 20000 });
    check("半截车牌给出「不完整」提示", await page.getByText(/车牌号看起来不完整/).isVisible());
    check(
      "半截车牌下没有「新建车辆」入口",
      (await page.getByRole("button", { name: /新建车辆/ }).count()) === 0,
    );
    check("半截车牌下「保存工单」仍被禁用", await saveButton.isDisabled());

    // ---------------------------------- 近似车牌确认（防「错一位」建档）
    console.log("\n【7】近似车牌二次确认");
    const stem = firstPlate.slice(0, -1);
    const lastChar = firstPlate.slice(-1);
    const typoPlate = stem + (lastChar === "0" ? "1" : "0");
    await plateInput.fill(typoPlate);
    await page.getByText("没有匹配的车牌。").waitFor({ state: "visible", timeout: 20000 });
    const createButton = page.getByRole("button", { name: /新建车辆/ });
    await createButton.waitFor({ state: "visible", timeout: 20000 });
    await createButton.click();

    const dialog = page.getByRole("alertdialog");
    let dialogVisible = true;
    try {
      await dialog.waitFor({ state: "visible", timeout: 20000 });
    } catch {
      dialogVisible = false;
    }
    check(`打错最后一位「${typoPlate}」时弹出近似车牌确认`, dialogVisible);
    if (dialogVisible) {
      check(
        `确认弹窗列出了真实车牌「${firstPlate}」`,
        (await dialog.innerText()).includes(firstPlate),
      );
      await dialog.getByRole("button", { name: "仍然新建" }).click();
      await page
        .getByText(`按「${typoPlate}」新建车辆`)
        .waitFor({ state: "visible", timeout: 20000 });
      check("确认后展开建档面板", await page.getByText(`按「${typoPlate}」新建车辆`).isVisible());
      check("建档面板展开后「保存工单」解禁", !(await saveButton.isDisabled()));
    }

    check("浏览器无 pageerror", pageErrors.length === 0, pageErrors.join(" | "));
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    failures.push("脚本异常");
    console.error("\n✗ 真实浏览器检查异常：");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    const total = passed + failures.length;
    if (failures.length > 0) {
      console.error(`\n✗ 新建工单车牌联想 e2e：${passed}/${total} 通过`);
      for (const name of failures) console.error(`  - ${name}`);
      process.exitCode = 1;
    } else {
      console.log(`\n新建工单车牌联想 e2e：${passed}/${total} 通过`);
    }
  });
