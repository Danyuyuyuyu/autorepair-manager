import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";

const port = 41731;
const origin = `http://127.0.0.1:${port}`;
const checks: string[] = [];
let server: ChildProcess | null = null;
let browser: Browser | null = null;

function pass(name: string) {
  checks.push(name);
  console.log(`[PASS] ${name}`);
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Vite preview 尚未监听。
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Vite preview 15 秒内未启动");
}

async function main() {
  try {
    const mobileDir = resolve(process.cwd(), "apps/mobile");
    const viteBin = resolve(mobileDir, "node_modules/vite/bin/vite.js");
    const commandArgs = [viteBin, "preview", "--host", "127.0.0.1", "--port", String(port)];
    server = spawn(process.execPath, commandArgs, { cwd: mobileDir, stdio: "ignore" });
    await waitForServer();

    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const remoteRequests = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.hostname !== "127.0.0.1") remoteRequests.add(request.url());
    });

    await page.goto(origin, { waitUntil: "networkidle" });
    if ((await page.title()) === "汽修管家") pass("产品名称");
    if ((await page.getByRole("navigation", { name: "主导航" }).getByRole("link").count()) === 5)
      pass("底部导航 5 项");
    if (await page.getByText("无需连接电脑或云端").isVisible()) pass("首页离线说明");

    for (const [label, heading, hash] of [
      ["工单", "工单", "#/orders"],
      ["客户", "客户", "#/customers"],
      ["库存", "库存", "#/inventory"],
      ["我的", "我的", "#/settings"],
    ] as const) {
      await page.getByRole("link", { name: label, exact: true }).click();
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      if (page.url().endsWith(hash)) pass(`路由 ${hash.slice(1)}`);
    }

    await page.reload({ waitUntil: "networkidle" });
    if (await page.getByRole("heading", { name: "我的", exact: true }).isVisible())
      pass("Hash 路由刷新恢复");
    if (await page.getByText("Native SQLite unavailable in browser development mode").isVisible())
      pass("浏览器 SQLite 明确阻断");
    if (await page.getByPlaceholder("点此唤起软键盘").isVisible()) pass("键盘避让测试入口");

    const cssText = await page.evaluate(() =>
      Array.from(document.styleSheets)
        .flatMap((sheet) => Array.from(sheet.cssRules))
        .map((rule) => rule.cssText)
        .join("\n"),
    );
    if (cssText.includes("safe-area-inset-top")) pass("顶部 Safe Area CSS");
    if (cssText.includes("safe-area-inset-bottom")) pass("底部 Safe Area CSS");
    if (remoteRequests.size === 0) pass("启动无外部网络请求");

    const expected = 13;
    if (checks.length !== expected) throw new Error(`Mobile shell: ${checks.length}/${expected}`);
    console.log(`Mobile shell: ${checks.length}/${expected}`);
  } finally {
    await browser?.close();
    server?.kill();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
