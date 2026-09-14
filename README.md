# 汽修管家 · 汽车维修店管理系统

面向**汽车维修店日常经营**的记账 + 工单管理系统。手机优先设计，PC 端响应式适配，数据统一存储在服务器数据库，支持 PWA 添加到手机桌面。

> 第一版聚焦一件事：把「客户进店 → 开单 → 加项加料 → 算钱 → 收款 → 完工 → 库存与账目自动更新」这条主链路做到又快又准。

---

## 一、技术栈

| 层次     | 选型                                                              |
| -------- | ----------------------------------------------------------------- |
| 前端框架 | Next.js 15（App Router）+ React 19 + TypeScript（strict）         |
| 样式     | Tailwind CSS v4（CSS-first 设计令牌）+ shadcn/ui 风格组件         |
| 图标     | lucide-react                                                      |
| 后端     | Next.js Server Actions（业务写入）+ Server Components（数据读取） |
| ORM      | Prisma 6                                                          |
| 数据库   | PostgreSQL 16                                                     |
| 鉴权     | 自建会话（httpOnly Cookie + 数据库会话表 + bcrypt 密码哈希）      |
| 校验     | Zod（服务端强制校验）                                             |
| 图表     | Recharts（趋势 / 支付方式）+ 纯 CSS 条形（排行榜）                |
| PWA      | Web App Manifest + Service Worker（手写，含离线兜底）             |
| 工具链   | pnpm + ESLint（flat config）+ Prettier                            |
| 部署     | Docker + Docker Compose（Next standalone 镜像）                   |

---

## 二、快速开始

### 1. 准备数据库

任选其一：

```bash
# A. Docker（推荐）
docker compose up -d db

# B. 本机已有的 PostgreSQL
createdb autorepair
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 必改：AUTH_SECRET（生产环境务必替换为随机字符串）
# 生成方式：openssl rand -base64 48
```

### 3. 准备数据库

**方式 A —— Docker（推荐，与线上环境一致）**

```bash
docker compose up -d db
```

**方式 B —— 无需 Docker（内置真实 PostgreSQL，数据落在 `./.devdb`）**

```bash
pnpm db:start        # 前台运行，保持窗口开启即为「数据库在线」
```

> macOS / Linux 首次使用方式 B 时，需要额外装一次本平台二进制包
> `pnpm add -D @embedded-postgres/<你的平台>`（脚本会在缺失时打印确切命令）。

数据库地址默认 `postgresql://autorepair:autorepair_pwd@localhost:55432/autorepair`
（Docker 方式端口是 `5432`，请相应修改 `.env` 的 `DATABASE_URL`）。

### 4. 安装依赖并初始化数据

```bash
pnpm install
pnpm prisma:generate
pnpm db:migrate      # 建表（会生成 prisma/migrations）
pnpm db:seed         # 生成账号 + 示例数据
```

### 5. 启动

```bash
pnpm dev             # http://localhost:3000
```

> **国内网络提示**：如果 `pnpm install` 很慢，可以切换镜像源（本项目开发时使用的就是国内镜像）：
>
> ```bash
> pnpm install --registry https://registry.npmmirror.com
> ```
>
> 注意 `pnpm-lock.yaml` 会记录实际使用的镜像地址；若团队位于海外或希望统一走官方源，
> 删除 lockfile 后用官方源重新 `pnpm install` 生成即可。

**默认账号**

| 角色   | 账号        | 密码          |
| ------ | ----------- | ------------- |
| 管理员 | `admin`     | `admin123456` |
| 员工   | `wangqiang` | `staff123456` |

> 上线前请立刻修改默认密码，并按需在「设置 → 账号权限」中增删员工账号。

---

## 三、常用脚本

```bash
pnpm dev              # 开发服务器
pnpm build            # 生产构建
pnpm start            # 启动生产服务
pnpm typecheck        # TypeScript 静态检查
pnpm lint             # ESLint
pnpm format           # Prettier 格式化

pnpm prisma:generate  # 生成 Prisma Client
pnpm prisma:validate  # 校验 schema
pnpm db:migrate       # 创建迁移（开发）
pnpm db:deploy        # 应用迁移（生产）
pnpm db:push          # 直接同步表结构（不生成迁移，仅开发用）
pnpm db:seed          # 初始化数据
pnpm db:studio        # Prisma Studio 可视化管理
pnpm db:start         # 启动内置 PostgreSQL（无 Docker 时用）
pnpm db:stop          # 停止内置 PostgreSQL

pnpm smoke            # 数据层端到端冒烟测试（135 项断言，PostgreSQL）
pnpm smoke:sqlite     # 同一套 135 项断言跑在 SQLite 上（需已有基线数据的 SQLite 库）
pnpm session:prune    # 清理过期会话（幂等，可挂 crontab；默认作用于 APP_STORAGE）
pnpm migrate:postgres-to-sqlite  # PostgreSQL → SQLite 正式迁移（--target / --force）
pnpm backup           # SQLite 备份 / 校验 / 恢复（create|list|verify|restore|prune|daily）
pnpm icons            # 重新生成 PWA 图标
```

### 自检：`pnpm smoke`

不经过浏览器，直接调用 service 层跑通核心业务链路，用于**部署后自检**和**改动 service 后的快速回归**：

```
【1】建单（含配件）→ 验证库存自动出库、金额汇总、工单号规则
【2】部分收款     → 验证已收 / 未收计算
【3】完工交车     → 验证状态流转、车辆里程与保养记录回写
【4】取消工单     → 验证配件库存回滚（账实一致）
【5】列表与聚合   → 验证首页 KPI / 财务汇总 / 报表趋势
【6】采购入库     → 验证数量增加、移动加权成本、自动登记采购支出
```

它会向数据库写入带 `SMOKE` 前缀的测试数据，方便识别与清理。

> **Windows 上构建生产镜像产物的注意点**
>
> `next.config.ts` 的 `output: "standalone"`（生产镜像依赖它）需要在构建收尾阶段创建符号链接，
> 而 Windows 默认不允许非管理员/非开发者模式创建符号链接，会报 `EPERM: operation not permitted, symlink`。
>
> 因此本项目改成**按需开启**：本机 `pnpm build` 默认不产出 standalone（构建完全通过），
> Docker 构建时通过 `ENV BUILD_STANDALONE=1` 打开（Linux 容器内无此限制）。
>
> 如果你想在本机也验证 standalone 产物，二选一：开启 Windows「开发者模式」，或设置 `BUILD_STANDALONE=1` 后用管理员终端构建。

pnpm icons # 重新生成 PWA 图标（纯 Node，无额外依赖）

```

---

## 四、目录结构

```

src/
├── app/ # 路由（App Router）
│ ├── (auth)/login/ # 登录（无导航外壳）
│ ├── (app)/ # 已登录区域：手机底部导航 + PC 侧边栏
│ │ ├── dashboard/ # 首页 / 工作台
│ │ ├── work-orders/ # 工单列表 / 新建 / 详情
│ │ ├── customers/ # 客户列表 / 详情
│ │ ├── vehicles/ # 车辆列表 / 详情（含保养记录）
│ │ ├── inventory/ # 配件库存 / 配件详情 / 出入库流水
│ │ ├── finance/ # 财务记账（仅管理员）
│ │ ├── reports/ # 经营报表（仅管理员）
│ │ ├── settings/ # 账号 / 技师 / 维修项目 / 操作日志（仅管理员）
│ │ └── me/ # 我的
│ ├── offline/ # PWA 离线兜底页
│ ├── manifest.ts # Web App Manifest
│ ├── error.tsx / not-found.tsx
│ └── globals.css # 设计令牌（@theme）与基础样式
├── components/
│ ├── ui/ # 基础组件（Button / Sheet / Dialog / MoneyInput …）
│ ├── layout/ # 外壳：MobileNav / Sidebar / TopBar / 全局搜索
│ └── shared/ # PageHeader / Pagination / StatusBadge / Icon 映射
├── features/ # 按业务域组织（组件 + 表单 + 面板）
│ ├── dashboard/ work-orders/ customers/ vehicles/
│ ├── inventory/ finance/ reports/ settings/ auth/
├── lib/ # 与框架无关的纯逻辑
│ ├── money.ts # ★ 全系统唯一金额计算入口
│ ├── constants.ts # 中文文案 / 状态流转 / 导航配置
│ ├── format.ts # 展示层格式化
│ ├── validation/ # Zod 校验规则（前后端共用）
│ └── utils.ts
├── server/ # 仅服务端
│ ├── db.ts # Prisma 单例
│ ├── selects.ts # 查询投影集中管理
│ ├── serializers.ts # Prisma 实体 → DTO（金额转字符串）
│ ├── errors.ts # 统一错误与 safeAction
│ ├── validate.ts # 入参校验
│ ├── auth/ # 会话 / 密码 / 权限守卫 / 审计
│ ├── services/ # ★ 业务逻辑（工单、库存、财务、报表…）
│ └── actions/ # Server Actions（薄层：鉴权 → 校验 → 调 service）
├── hooks/ # useDebouncedValue / useMediaQuery / useDisclosure
├── types/ # 跨端 DTO 类型
└── utils/date.ts # 业务时区（Asia/Shanghai）日期工具

prisma/
├── schema.prisma # 数据库模型
├── migrations/ # 迁移历史
└── seed.ts # 初始化数据

scripts/
├── generate-icons.mjs # PWA 图标生成（SDF 光栅化 + PNG 编码）
└── dev-db.mjs # 无 Docker 时的本地 PostgreSQL

docs/DECISIONS.md # 关键设计决策记录（为什么这么做）

```

### 分层约定（重要）

```

页面 / 组件 → Server Action → service → Prisma
↑ ↑
鉴权 + 参数校验 业务规则 + 事务 + 审计

```

- **页面不写业务规则**：页面只负责取数与排版，所有写操作走 Server Action。
- **Server Action 只做三件事**：鉴权（`requireUserAction` / `requireAdminAction`）、Zod 校验、调用 service。
- **service 承载业务**：事务边界、库存扣减、金额重算、审计日志都在这里。
- **金额只在 `lib/money.ts` 里算**：页面与组件不允许自己实现金额公式。

---

## 五、核心业务规则

### 1. 金额计算（`src/lib/money.ts`）

- 全程使用 `Decimal`，**禁止浮点数参与金额运算**；数据库字段为 `Decimal(14,2)`。
- `calcOrderTotals(items, discount)` 是工单金额的**唯一实现**：

```

应收金额 = 维修项目 + 配件 + 工时 + 其他费用 − 优惠
优惠金额上限为小计（不会出现负应收）
配件成本 = Σ(数量 × 成本单价) ← 用于毛利

```

- 区分三个常见但容易混淆的概念：

| 指标 | 计算方式 | 含义 |
| --- | --- | --- |
| 营业额 | 收款流水合计 | 客户实际付了多少钱 |
| 毛利润 | 营业收入 − 配件成本 | 定价与采购是否健康 |
| 经营利润 | 营业收入 − 全部支出 | 扣除房租工资后的真实盈亏 |

### 2. 工单与库存联动

- 工单添加**配件** → 自动产生 `WORKORDER_OUT` 出库流水并扣减库存。
- 修改配件数量 → 按差额补出库或回滚入库。
- 删除配件行 / 取消工单 → 自动回滚入库（`RETURN_IN`）。
- 库存不足时**不会失败静默**，返回明确文案：「当前库存不足，无法出库。（现有 X，需要 Y）」
- 所有库存变动都写入 `inventory_transactions`，记录 `qtyBefore → qtyAfter`，只增不改。
- 入库按**移动加权平均法**重算成本：`新均价 = (旧库存×旧均价 + 入库量×入库价) ÷ (旧库存+入库量)`
- 工单项的 `name / unitPrice / costPrice` 均为**下单时快照**，后期改价不影响历史工单。

### 3. 工单状态流转（服务端强制校验）

```

待接车 → 维修中 → 待质检 → 待付款 → 已完成
↘ ↘ ↘ ↘
已取消（终态，配件自动回滚）

````

- 流转规则集中在 `lib/constants.ts` 的 `WORK_ORDER_STATUS_FLOW`，非法流转直接报错。
- 已收款的工单取消需管理员先作废收款；有收款的工单不可硬删除（改用「取消」）。
- 完工时同步车辆里程、上次保养时间，并可按需生成保养记录。

### 4. 权限

| 能力 | 管理员 | 员工 |
| --- | :---: | :---: |
| 查看全部工单 | ✅ | ❌ 仅自己创建的 |
| 新建 / 编辑工单、加项加料 | ✅ | ✅ |
| 客户 / 车辆查询与建档 | ✅ | ✅ |
| 收款 | ✅ | ✅ |
| 财务、报表 | ✅ | ❌ |
| 修改价格 / 优惠 | ✅ | ❌ |
| 删除工单、作废收款、库存调整 | ✅ | ❌ |
| 账号与员工管理 | ✅ | ❌ |

> 前端隐藏按钮只是体验优化，**真正的判定一律在服务端**（`requireAdminAction` / `canModifyWorkOrder`）。

### 5. 审计日志

以下操作会写入 `audit_logs`（含操作人、时间、IP、变更前后快照）：
删除工单 / 取消工单 / 改价优惠 / 修改收款 / 作废收款 / 库存调整 / 盘点 / 删除客户 / 删除配件 / 账号变更 / 登录退出。

---

## 六、设计系统

设计令牌集中在 `src/app/globals.css` 的 `@theme` 中，**组件里不写死颜色**。

| 语义 | 令牌 | 用途 |
| --- | --- | --- |
| 品牌色 | `--color-brand` `#2563eb` | 主按钮、链接、选中态 |
| 成功 | `--color-success` `#16a34a` | 已完工、收入、无欠款 |
| 警告 | `--color-warning` `#f59e0b` | 库存预警、待保养 |
| 危险 | `--color-danger` `#dc2626` | 删除、支出、欠款 |
| 背景 / 卡片 | `--color-background` `#f4f5f7` / `--color-card` `#ffffff` | 大量留白的基础 |

移动端硬性要求：

- 所有可点击元素最小 **44px** 触控高度（`Button size="md"` = 44px）。
- 输入框字号 **16px**，避免 iOS 聚焦时页面缩放。
- 底部导航高 64px + `env(safe-area-inset-bottom)`，内容区用 `pb-nav` 让位。
- 复杂表单一律用 **Bottom Sheet**，不用大弹窗。

### 响应式断点

| 宽度 | 布局 |
| --- | --- |
| 375 / 390 / 430px | 单列 + 底部导航 + 固定操作条 |
| 平板（640–1024px） | 弹出层居中，卡片两列 |
| ≥1024px | 左侧 Sidebar + 顶部栏 + 内容区（表格化） |

---

## 七、PWA

- `src/app/manifest.ts` 生成 `/manifest.webmanifest`（名称「汽车维修店管理系统」，简称「汽修管家」）。
- `public/sw.js` 手写 Service Worker：静态资源 Cache First，页面导航 Network First，离线回退 `/offline`。
- **不缓存任何业务数据**：POST（Server Action）一律直连网络，避免离线写入造成账目错误。
- 图标由 `pnpm icons` 生成（方向盘的行业符号），含 `maskable` 版本以适配安卓自适应图标。
- iOS 用户：Safari → 分享 → 添加到主屏幕，即可以 standalone 全屏运行。

---

## 八、生产部署

```bash
# 1. 准备环境变量
cp .env.example .env
# 修改 AUTH_SECRET、POSTGRES_PASSWORD

# 2. 构建并启动
docker compose up -d --build

# 3. 首次初始化数据
docker compose exec app node node_modules/prisma/build/index.js db seed
````

容器启动时会自动执行 `prisma migrate deploy`（幂等）。

建议再挂一条定时任务清理过期登录会话（幂等，可安全重复执行）：

```bash
# 每天 03:30 清理一次（Docker 部署）
30 3 * * * docker compose exec -T app pnpm session:prune
```

不挂定时任务也不会堆数据：每次登录成功时会按进程内 1 小时节流顺带清理一次。

### 放到公网前务必确认

1. `AUTH_SECRET` 已替换为随机值，且未提交进版本库。
2. 数据库端口不要暴露到公网（compose 中默认仅绑定 `127.0.0.1`）。
3. 通过 Nginx / Caddy 反向代理并启用 HTTPS（PWA 与安全 Cookie 依赖 HTTPS）。
4. 已修改 `admin` 默认密码。
5. 配置数据库定期备份（`pg_dump`）。

---

## 九、后续可扩展方向

架构已为以下功能预留空间（**第一版刻意不做**）：库存供应商比价与采购单、员工提成与考勤、会员与储值卡、微信/支付宝在线支付、预约排队、多门店、短信/微信消息通知、条码枪扫码开单。

新增业务域时建议遵循同样的分层：`features/<domain>` + `server/services/<domain>.service.ts` + `server/actions/<domain>.actions.ts`，并把金额相关逻辑收敛到 `lib/money.ts`。

---

## 十、已知取舍

见 [`docs/DECISIONS.md`](docs/DECISIONS.md)，其中记录了工单项为什么用单表加类型、客户手机号为什么不做唯一约束、软删除与唯一索引的冲突如何规避等关键决策。

---

## 十一、SQLite 单机模式（PC 端 / 无服务器部署）

同一套业务逻辑可以跑在 PostgreSQL 或 SQLite 上（ADR-014），由 `APP_STORAGE` 决定：

| 环境变量                      | 默认值                                                | 说明                                     |
| ----------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| `APP_STORAGE`                 | 未设置 = `postgres`                                   | `sqlite` 时使用 node:sqlite 单文件数据库 |
| `AUTOREPAIR_DB_PATH`          | `%LOCALAPPDATA%\AutoRepairManager\data\autorepair.db` | SQLite 数据文件                          |
| `AUTOREPAIR_BACKUP_DIR`       | `%LOCALAPPDATA%\AutoRepairManager\backups`            | 备份目录                                 |
| `AUTOREPAIR_BACKUP_RETENTION` | `30`                                                  | 保留最近 N 份备份                        |

```bash
$env:APP_STORAGE="sqlite"; pnpm start        # Windows PowerShell
APP_STORAGE=sqlite pnpm start                # macOS / Linux
```

### 从 PostgreSQL 迁移

```bash
pnpm migrate:postgres-to-sqlite                      # 目标必须是空库（否则明确拒绝）
pnpm migrate:postgres-to-sqlite -- --target <path>   # 指定目标文件
pnpm migrate:postgres-to-sqlite -- --force           # 先自动备份，再覆盖已有 SQLite
```

**不是文件复制**：逐表读取 PostgreSQL → 领域类型转换 → 单个 SQLite 事务写入 → 自动校验。
主键（Customer/Vehicle/WorkOrder/Payment/InventoryTransaction/AuditLog/User/Session 的 id）原样保留，
写入顺序由真实外键图拓扑排序得出。校验包括：逐表 Count、`PRAGMA foreign_key_check`、
逐条外键的孤儿检查、业务聚合对账（应收/已收/欠款/库存数量与估值…）、全表逐行逐列对账
（Decimal 两位小数 / DateTime ISO / Boolean / JSON 语义）、工单与配件专项、金额与日期边界样本。
任何一项不一致都以非 0 退出码报失败。

### 备份与恢复

```bash
pnpm backup create                  # 立即备份（SQLite Online Backup API，WAL 安全）
pnpm backup list                    # 列出备份（新 → 旧）
pnpm backup verify <文件>            # integrity_check + foreign_key_check + 业务表齐备
pnpm backup restore <文件>           # 恢复（先自动备份当前库；失败自动回滚）
pnpm backup prune                   # 只执行保留策略
pnpm backup daily                   # 当天还没有备份时才创建（计划任务用）
```

- 备份**不是简单复制文件**：WAL 模式下单独复制 `autorepair.db` 会丢最近提交。这里用
  SQLite Online Backup API 产出单一、一致、可恢复的文件；创建后立即校验，不通过就丢弃。
- 服务启动时（`APP_STORAGE=sqlite`）会自动做一次「每日备份」，同一进程/同一天只做一次。
- `restore` 需要先停止服务（Windows 下文件被占用会明确报错，而不是产生半恢复的库）。

### 手机 / 平板在局域网访问

1. 服务默认监听 `0.0.0.0`，不用改配置；只要手机和电脑连在同一个 Wi-Fi / 局域网。
2. 查电脑的内网 IP：`ipconfig`，找到「以太网」或「WLAN」下的 IPv4（本机是 `192.168.2.14`）。
3. 手机浏览器打开 `http://<内网IP>:3000`，例如 `http://192.168.2.14:3000`。
4. **必须关掉 Secure Cookie**，否则登录后会立刻被弹回登录页（原因见下）。

生产模式（`pnpm start`）默认只在 HTTPS 下发会话 Cookie。手机用明文 HTTP 访问时浏览器会
**拒收**这个 Cookie，表现得像「密码明明对，却又回到登录页」。让内网明文访问可用：

    # .env.local（机器本地、不会被提交）
    AUTH_COOKIE_SECURE="false"

改完配置后重新 `pnpm build` 并重启服务。以后若改成 HTTPS 访问（证书 + 反代），
请把这一行删掉或改回 `"true"`。

Windows 防火墙：`node.exe` 的入站规则通常已允许（本机实测 Private / Public 均已放行）；
若手机仍打不开，用**管理员** PowerShell 补一条：

    New-NetFirewallRule -DisplayName "汽修管家 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private

**已知限制**：没有 HTTPS 时 `http://192.168.x.x` 不是安全上下文，浏览器**不会注册 Service Worker**，
因此 PWA 的「添加到主屏幕 / 离线页」不可用。想在手机上像 App 一样用桌面图标，
需要给内网配证书走 HTTPS（例如 Caddy + 内部 CA）。
