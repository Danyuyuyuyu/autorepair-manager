import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { chromium, type Browser } from "playwright-core";

import { BOOTSTRAP_MARKER_KEY, BOOTSTRAP_MARKER_VALUE } from "@/server/bootstrap/first-run";

const TEST_ROOT_PREFIX = "autorepair-fresh-e2e-";
const USERNAME = "fresh-e2e-admin";
const PASSWORD = "FreshE2e123456";

let passed = 0;
function check(label: string, condition: unknown): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function launchBrowser(): Promise<Browser> {
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

function startServer(
  port: number,
  dbPath: string,
  backupDir: string,
): {
  child: ChildProcess;
  logs: () => string;
} {
  const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  let output = "";
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      APP_STORAGE: "sqlite",
      AUTOREPAIR_DB_PATH: dbPath,
      AUTOREPAIR_BACKUP_DIR: backupDir,
      DATABASE_URL: "postgresql://127.0.0.1:1/postgres-is-intentionally-unavailable",
      AUTH_SECRET: "fresh-install-e2e-only-secret-at-least-32-characters",
      AUTH_COOKIE_SECURE: "false",
      BOOTSTRAP_ADMIN_USERNAME: USERNAME,
      BOOTSTRAP_ADMIN_PASSWORD: PASSWORD,
      BOOTSTRAP_ADMIN_NAME: "首次安装 E2E 管理员",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output += String(chunk);
  });
  return { child, logs: () => output };
}

async function waitForLogin(
  baseUrl: string,
  child: ChildProcess,
  logs: () => string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next 进程提前退出（exit ${child.exitCode}）：${logs().slice(-1000)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`等待登录页超时：${logs().slice(-1000)}`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolveWait) => setTimeout(() => resolveWait(false), 5_000)),
  ]);
  if (!graceful && child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

function assertCleanupTarget(testRoot: string): void {
  const resolvedRoot = resolve(testRoot);
  const resolvedTemp = resolve(tmpdir());
  const rel = relative(resolvedTemp, resolvedRoot);
  if (
    rel.startsWith("..") ||
    rel.includes(`..${sep}`) ||
    !resolvedRoot.split(sep).at(-1)?.startsWith(TEST_ROOT_PREFIX)
  ) {
    throw new Error(`拒绝清理非 fresh-install E2E 临时目录：${resolvedRoot}`);
  }
}

async function main(): Promise<void> {
  check("生产构建存在", existsSync(join(process.cwd(), ".next", "BUILD_ID")));

  const testRoot = mkdtempSync(join(tmpdir(), TEST_ROOT_PREFIX));
  const dbPath = join(testRoot, "data", "autorepair.db");
  const backupDir = join(testRoot, "backups");
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port, dbPath, backupDir);
  let browser: Browser | null = null;

  try {
    await waitForLogin(baseUrl, server.child, server.logs);
    check("无 DB、无 PostgreSQL 时生产进程启动成功", existsSync(dbPath));

    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(`${baseUrl}/login`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    check("首次启动进入登录页", response?.status() === 200);
    await page.fill("#username", USERNAME);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: /登\s*录/ }).click();
    await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 30_000 });
    check("首次管理员通过真实登录 Action 进入 dashboard", page.url().includes("/dashboard"));
    check("浏览器无 pageerror", pageErrors.length === 0);

    await browser.close();
    browser = null;
    await stopServer(server.child);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const users = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
      const marker = db
        .prepare("SELECT value FROM app_settings WHERE key = ?")
        .get(BOOTSTRAP_MARKER_KEY) as { value: string } | undefined;
      const sessions = db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as {
        count: number;
      };
      check("真实启动只初始化 1 名管理员", Number(users.count) === 1);
      check("真实启动写入 READY marker", marker?.value === BOOTSTRAP_MARKER_VALUE);
      check("真实登录已持久化 Session", Number(sessions.count) === 1);
    } finally {
      db.close();
    }

    check(
      "空白库首次启动没有立即创建每日备份",
      !existsSync(backupDir) || readdirSync(backupDir).length === 0,
    );
    check("服务日志未输出管理员明文密码", !server.logs().includes(PASSWORD));
    check("服务日志未输出 bcrypt hash", !/\$2[aby]\$\d{2}\$/.test(server.logs()));

    console.log(`\nFresh Install browser E2E：通过 ${passed} 项，失败 0 项`);
  } finally {
    await browser?.close().catch(() => undefined);
    await stopServer(server.child);
    assertCleanupTarget(testRoot);
    rmSync(testRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Fresh Install browser E2E 失败：", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
