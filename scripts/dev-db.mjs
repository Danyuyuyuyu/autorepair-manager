/**
 * 本地开发数据库（无需 Docker）
 * ---------------------------------------------------------------------------
 * 已内置 embedded-postgres（真实 PostgreSQL 实例，数据落在 ./.devdb，不污染系统）。
 * 如果你本机装了 Docker，用 `docker compose up -d db` 也行 —— 和线上环境完全一致。
 *
 * 首次使用：
 *   pnpm db:start        # 启动并创建数据库
 *   pnpm db:migrate      # 建表（生成迁移）
 *   pnpm db:seed         # 初始化数据
 *
 * 用法：
 *   pnpm db:start
 *   pnpm db:stop
 *
 * 非 Windows 平台：需要额外装一次本平台二进制包（见下方提示或 README）。
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const DATA_DIR = resolve(process.cwd(), ".devdb");
const PORT = Number(process.env.DEV_DB_PORT ?? 55432);
const USER = "autorepair";
const PASSWORD = "autorepair_pwd";
const DATABASE = "autorepair";

const action = process.argv[2] ?? "start";

/** 当前平台对应的 embedded-postgres 二进制包名 */
function platformPackage() {
  const { platform, arch } = process;
  if (platform === "win32") return "@embedded-postgres/windows-x64";
  if (platform === "darwin")
    return arch === "arm64" ? "@embedded-postgres/darwin-arm64" : "@embedded-postgres/darwin-x64";
  if (arch === "arm64") return "@embedded-postgres/linux-arm64";
  if (arch === "arm") return "@embedded-postgres/linux-arm";
  return "@embedded-postgres/linux-x64";
}

async function loadEmbeddedPostgres() {
  try {
    const mod = await import("embedded-postgres");
    return mod.default ?? mod.EmbeddedPostgres ?? mod;
  } catch {
    return null;
  }
}

function printFallbackHelp(reason) {
  console.error(`
✗ 无法使用内置 PostgreSQL：${reason}

请三选一：

  A. 用 Docker（推荐，与线上环境一致）
     docker compose up -d db
     数据库地址：postgresql://autorepair:autorepair_pwd@localhost:5432/autorepair

  B. 安装本平台二进制包（无需 Docker）
     pnpm add -D ${platformPackage()}
     pnpm db:start

  C. 使用本机已安装的 PostgreSQL
     CREATE USER ${USER} WITH PASSWORD '${PASSWORD}';
     CREATE DATABASE ${DATABASE} OWNER ${USER};
`);
}

async function main() {
  const EmbeddedPostgres = await loadEmbeddedPostgres();

  if (!EmbeddedPostgres) {
    printFallbackHelp("未安装 embedded-postgres（pnpm install 未完成？）");
    process.exit(1);
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
  });

  if (action === "stop") {
    await pg.stop().catch(() => undefined);
    console.log("本地 PostgreSQL 已停止。");
    return;
  }

  const initialised = existsSync(resolve(DATA_DIR, "PG_VERSION"));
  if (!initialised) {
    console.log("初始化数据目录…");
    try {
      await pg.initialise();
    } catch (error) {
      if (String(error).includes("embedded-postgres") || String(error).includes("Cannot find")) {
        printFallbackHelp(`缺少本平台二进制包 ${platformPackage()}`);
        process.exit(1);
      }
      throw error;
    }
  }

  await pg.start();
  console.log(`PostgreSQL 已启动：postgresql://${USER}:***@localhost:${PORT}/${DATABASE}`);

  try {
    await pg.createDatabase(DATABASE);
    console.log(`数据库 ${DATABASE} 已创建。`);
  } catch {
    console.log(`数据库 ${DATABASE} 已存在，跳过创建。`);
  }

  console.log(`
下一步：
  pnpm db:migrate   # 建表（首次）
  pnpm db:seed      # 初始化数据

提示：保持本进程运行即为「数据库在线」，按 Ctrl+C 停止。
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
