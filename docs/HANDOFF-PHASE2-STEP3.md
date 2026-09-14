# Handoff：汽修管家（autorepair-manager）阶段 2 · Step 3 接续

> 交接时间：2026-09-14 17:30 (GMT+8)
> 下一session焦点：**阶段 2 · Step 3 —— 逐个实现 SQLite Repository**（从 work-order 开始，一次只做一个）

---

## 0. 必读上下文（不重复，按路径读）

| 文档                                                                    | 内容                                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `D:\autorepair-manager\docs\DECISIONS.md`                               | 全部 ADR。**ADR-014 是本阶段总纲**（领域层不依赖 Prisma；已更新为真实进度：11 个 service 全部走仓储；auth 三文件有意保留直连及理由）         |
| `D:\autorepair-manager\prisma\schema.prisma`                            | 领域模型的唯一权威（SQLite schema 从它机械派生）                                                                                             |
| `D:\autorepair-manager\src\server\repos\sqlite\migrations\001_init.sql` | Step 1 产物：18 张表 + 全部列的 SQLite 形态（金额=TEXT、枚举=TEXT+CHECK、DateTime=TEXT ISO、外键动作逐列对照）——**写仓储实现时列名以此为准** |
| `D:\autorepair-manager\src\domain\repositories.ts`                      | 10 个仓储接口（唯一契约）+ 领域过滤/行类型                                                                                                   |
| `D:\autorepair-manager\src\server\repos\prisma\*.ts`                    | Prisma 实现 = 行为参照物（SQL 语义、事务边界、select 形状都照它对齐）                                                                        |
| `D:\autorepair-manager\scripts\smoke-test.ts`                           | 135 条业务断言（Step 3 的验收标尺，SQLite 模式下要 135/135）                                                                                 |
| `D:\.workbuddy\memory\2026-09-14.md`                                    | 详细工作日志：阶段 1 全程 + Step 1/2 交付明细 + 踩坑记录                                                                                     |

## 1. 项目与用户背景

- 项目：`D:\autorepair-manager`，Next.js 15 + Prisma + PostgreSQL 汽修店记账系统（中文 UI）。无 git 仓库（用户明确拒绝），回滚兜底 = `.baseline/` 快照（勿删）。
- 用户中文交流、表述直接；规划已由用户长文拍板（阶段 2 七步走，Step 1/2 已完成），**按既定规范执行，不要扩大范围**。
- 用户规范要点：Step 3 逐个实现仓储、每个都验证后再下一个，**禁止一次性批量重写 9 个**；不改业务 service；不改 UI；不动手机端/Capacitor/同步。

## 2. 当前状态（全部实测通过）

### 已完成

- **阶段 1**：11 个 service 全部迁移到仓储接口（`grep -rln 'from "@/server/db"' src/server/services` 为空）。Smoke 135/135。
- **Step 1（SQLite adapter）**：`src/server/repos/sqlite/{client,migration,transaction,errors,decimal,id}.ts` + `migrations/001_init.sql`。验证 `pnpm sqlite:verify` 32/32。
- **Step 2（context 双装配）**：`src/server/storage.ts`（resolveStorageKind：未设置→postgres，非法→启动抛错）、`src/server/repos/create-repositories.ts`（createRepositoriesFor，repos 打 `__storageBrand` 标记）、`src/server/repos/sqlite/factory.ts`（10 槽位占位，访问即抛 `SQLite repository "X" is not implemented yet.`）。验证 `pnpm storage:verify` 22/22（4 场景独立子进程）。

### 验收命令（改完必跑）

```bash
pnpm typecheck && pnpm lint && pnpm exec prettier --check .
env -u NODE_OPTIONS pnpm exec next build        # 必须去掉 NODE_OPTIONS（shim 钩子会弄挂 build）
pnpm smoke                                       # PostgreSQL 基线，必须保持 135/135
pnpm storage:verify                              # 装配回归
pnpm sqlite:verify                               # Step 1 回归
```

### 门禁现状

typecheck 0 / lint 0/0 / format ✅ / build ✅ / smoke(postgres) 135/135。

## 3. Step 3 执行方案（用户已批准的顺序）

每完成一个仓储：把 `src/server/repos/sqlite/factory.ts` 的 `PLACEHOLDER_KEYS` 里对应键摘除、接上真实实现 → tsc → 单仓储针对性断言（可往 `scripts/sqlite-verify.ts` 或新脚本加）→ 最后 Step 4 用 `pnpm smoke:sqlite` 双跑 135。

建议顺序（依赖与风险排序）：

1. **work-order + work-order-item**（最重：建单事务、状态机、库存联动、工单号重试）
2. **part + inventory**（FOR UPDATE → BEGIN IMMEDIATE 语义落地点）
3. **customer + vehicle**（级联软删除）+ **catalog**（穿插按需）
4. **finance**（汇总口径多）
5. **user + audit**（收尾）

技术要点：

- node:sqlite `DatabaseSync` 同步 API；仓储方法签名保持 async（接口如此），内部直接同步执行即可。
- 事务：service 层调 `context.transaction(fn)`；sqlite 路径已由 `runInTransaction(db, () => fn(repos))` 接好（串行队列、嵌套并入外层）。仓储实现内**不得**自己 BEGIN/COMMIT。
- 金额：写入 `toDbDecimal()`（TEXT "1234.56"），读取 `fromDbDecimal()`；**比较/求和一律在领域层 decimal.js**；SQL 里排序金额用 `CAST(col AS REAL)`。
- 枚举：TEXT 直存直读（CHECK 已兜底非法值）；布尔 INTEGER 0/1；DateTime TEXT ISO（`new Date().toISOString()`）。
- JSON（audit_logs.before/after）：仓储层 JSON.stringify/parse，领域层只见对象。
- 错误：不要 try/catch 驱动错误——`factory.ts` 外层应有统一包装；真实实现建议沿用 `withSqliteErrorTranslation()` 代理包每个 repo（sqlite/errors.ts 已备好）。
- `createWithInventory` 等多表写入依赖"回调拿到的 repos 绑定同一事务"——SQLite 单连接天然满足，无需特殊处理。
- 工单号生成/重试：prisma 实现用 `UniqueConstraintError` 判断重试，sqlite 侧错误翻译已对齐（UNIQUE constraint failed: work_orders.order_no）。

## 4. 踩坑记录（务必先读，能省大量时间）

- **本机环境**：无 Docker/独立 PG（dev 用 embedded-postgres，`pnpm db:start`）；pnpm 只在受管 Node 目录（`C:\Users\danyu\.workbuddy\binaries\node\versions\22.22.2-3`）；Bash 工具需先 `export PATH="/usr/bin:/bin:/c/Windows/System32:<node目录>:$PATH"`；PowerShell 工具不回显 stdout，别用。
- **next build 必须 `env -u NODE_OPTIONS`**（NODE_OPTIONS 注入的 shim 安全删除钩子会挂 build）。
- **长命令用 run_in_background**（前台约 100s 被杀）；不要同时跑两个 pnpm install。
- node:sqlite：`PRAGMA journal_mode` 返回列名是 `journal_mode`；`:memory:` 库永远是 memory 模式；此 Node 版本 **没有** `DatabaseSync.location`（用 `client.resolveDbPath()`）；无 flag 可用（仅 ExperimentalWarning）。
- **AppError 子类的 `error.name` 全是 "AppError"**（基类覆写）——测试判断异常类型用 `error.constructor.name` 或 instanceof。
- Prisma 适配器嵌套 select 必须展平成扁平领域形状；SQLite 行读取同理（snake_case → 领域形状转换在仓储内做）。
- 冒烟断言失败时**先核实原因再改断言**：本项目两次"失败"都是断言写错（比对对象取错、用了前面章节已改动的旧值），不是代码错。
- 沙箱拦截 `wmic.exe`，无法绕过（本项目暂未依赖）。

## 5. 已知边界 / 待决策（Step 3 完成后向用户提出）

- **auth 三文件仍直连 PG**（`src/server/auth/session.ts`、`auth/audit.ts`、`src/server/actions/auth.actions.ts`，阶段 1 决策保留）。SQLite 模式下登录环节走 PG —— 全库脱离 PG 需专项决策（登录查 user 走仓储 vs auth 也收口），Step 3 完成时把选项摆给用户。
- `smoke:sqlite` 脚本已就位但被 `run-with-storage.mjs` 明确拒绝（防假通过），Step 3 完成后放开。
- prisma seed / `pnpm db:seed` 是 PG 专用；SQLite 首次启动的"创建管理员"在用户规范第十八节，Step 3 后接入初始化流程。

## 6. Suggested skills（下一 session 应调用的 Skill）

- 无需额外安装 skill；本项目工作流已沉淀在记忆文件与 ADR 里。
- 若需要规划确认类交互，用户偏好 `/grill-with-docs` 风格（A/B 选项 + AI 推荐）。
- 遇到 Office/文档类需求不适用本项目；本次任务纯代码。

## 7. 第一步动作建议

1. 读 `src/server/repos/prisma/work-order.ts`（行为参照）+ `src/domain/repositories.ts` 的 WorkOrderRepository/WorkOrderItemRepository 接口 + `001_init.sql` 对应表。
2. 写 `src/server/repos/sqlite/work-order.ts`（workOrder + workOrderItem 两个仓储一起，它们共享事务路径）。
3. 在 `factory.ts` 摘除对应占位键。
4. tsc → `pnpm storage:verify`（确认槽位摘除后其余占位仍报错）→ 写 work-order 专项 sqlite 断言 → 最后统一跑门禁。
5. 汇报格式沿用用户规范：真实结果表，没实测的项不许标 ✅。

## 8. 2026-09-14 work-order 切片验收记录

### 验证环境修复

- 根因不是项目缺少直接 `esbuild` 声明：`tsx@4.23.13` 已在自身 dependencies 中声明
  `esbuild~0.28.0`，lockfile 也完整记录二者关系。
- 实际原因是工作区从 `D:\autorepair-manager` 移到 `E:\autorepair-manager` 后，旧
  `node_modules/.modules.yaml` 的 `virtualStoreDir` 仍指向 D 盘，导致 pnpm 链接失效；表现为
  `tsx` 找不到 `esbuild`、ESLint 找不到 `debug`。
- 用项目约定的 Node 22 执行单次 `pnpm install --force` 重建依赖，随后执行
  `pnpm prisma:generate`，恢复与当前 schema 一致的 Prisma Client。没有把 `esbuild` 加为项目
  直接依赖。
- 先前完整 typecheck 中的 Prisma、隐式 any、UI `possibly undefined` 报错均由未生成的 Prisma
  Client 级联产生；generate 后全部消失。抽查的 UI 文件与 `.baseline/src-20260914` 哈希一致，
  未修改 UI 类型、未降低 strict、未排除文件。

### work-order / work-order-item 验收

- `src/server/repos/sqlite/work-order.ts`、`customer.ts`、`vehicle.ts` 已实现并接入 factory；其余 6 个仓储保持 fail-fast，
  SQLite 模式不允许静默回退 PostgreSQL。
- `scripts/work-order-repository-contract.ts` 用同一套断言分别运行 SQLite 与 PostgreSQL，覆盖
  创建、分页、排序、状态筛选、软删除过滤、四表详情、Decimal/Date/nullable、六组金额边界、
  ADR-012 状态捷径、精确聚合和硬删除级联。
- `hardDelete` 是现有管理员“误建单删除”业务路径；service 在调用前校验管理员权限与已收金额，
  并先回滚库存、解除库存流水/保养记录引用，不是普通软删除路径。

| 门禁                                  | 实测结果                            |
| ------------------------------------- | ----------------------------------- |
| `pnpm typecheck`                      | 通过                                |
| `pnpm lint`                           | 通过，0 error / 0 warning           |
| `pnpm format`                         | 通过，全部 unchanged                |
| `pnpm build`（已移除 `NODE_OPTIONS`） | 通过                                |
| `pnpm storage:verify`                 | 25/25                               |
| `pnpm sqlite:verify`                  | 32/32                               |
| `pnpm smoke`（PostgreSQL）            | 135/135                             |
| `pnpm work-order:contract`            | 37/37；PostgreSQL / SQLite 快照一致 |

### customer / vehicle 验收

- `scripts/customer-repository-contract.ts`：PostgreSQL / SQLite 共享契约 78/78，快照一致。
- `scripts/vehicle-repository-contract.ts`：PostgreSQL / SQLite 共享契约 63/63，快照一致；覆盖
  车辆列表、客户筛选、车牌/VIN/品牌/型号搜索、suggest、临近保养、保养记录、软删除与历史关系。
- `APP_STORAGE=sqlite` 已验证 workOrder、workOrderItem、customer、vehicle 使用真实 SQLite，
  inventory 等其余仓储继续明确 fail-fast。

结论：**阶段 2 · Step 3 · work-order + customer + vehicle Repository ✅**。下一仓储只实现
`inventory`，仍须完成一个、完整验证一个。
