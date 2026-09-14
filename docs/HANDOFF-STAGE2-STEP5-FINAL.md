# Handoff: AutoRepair Manager — Stage 2 · 最终 Step 5（迁移 / 备份 / 恢复 / 最终验收）

> 本文件就是阶段 2 的收尾报告，按用户规范第二十七节的 17 项逐条给出。
> 上一份（会话清理切片）见 `docs/HANDOFF-STAGE2-SESSION-PRUNE.md`。

## 结论

**阶段 2 完成。** 全部 26 条完成标准均已实测成立（见「六、完成标准逐条核对」）。
PostgreSQL 已彻底拔线（进程 0、端口关闭、DATABASE_URL 不可达），纯 SQLite 生产模式
完成登录、全页面、135 项业务冒烟、备份、真实破坏恢复、恢复后再次写入 135 项。

工作区：`E:\autorepair-manager`。本地 PostgreSQL 已停止；生产服务已停止。

---

## 一 ~ 四：迁移方式与实际记录数

**1. SQLite DB 文件位置**

```
C:\Users\ZhenXun\AppData\Local\AutoRepairManager\data\autorepair.db      （主库，WAL 模式）
C:\Users\ZhenXun\AppData\Local\AutoRepairManager\backups\                （备份目录）
```

可用 `AUTOREPAIR_DB_PATH` / `AUTOREPAIR_BACKUP_DIR` 覆盖；两者都不在源码目录里，
更新程序不会覆盖数据（见 `src/server/repos/sqlite/client.ts`）。

**2 / 3. 迁移方式**

命令 `pnpm migrate:postgres-to-sqlite`，实现见 `src/server/migration/`，流程：

```
读取 PostgreSQL（Prisma 全表，保留原 ID）
  ↓ 领域类型转换（Decimal→两位小数字符串 / DateTime→ISO / Boolean→0|1 / Json→文本）
  ↓ 拓扑排序（顺序来自真实外键图，18 张表 / 26 条外键）
  ↓ SQLite 单事务写入（BEGIN IMMEDIATE … COMMIT；覆盖时同事务内先按外键反序清空）
  ↓ 七层校验
```

禁止文件复制；主键（Customer / Vehicle / WorkOrder / Payment / InventoryTransaction /
AuditLog / User / Session 的 id）原样搬运。目标非空时**拒绝静默覆盖**，必须
`--target <新文件>` 或 `--force`（force 会先自动生成 pre-migration 备份）。
计划表与列映射不是手写清单：字段来自 Prisma DMMF，列来自 `PRAGMA table_info`，
双向覆盖校验，任何一侧对不上直接失败（`src/server/migration/plan.ts`）。

迁移顺序（实测输出）：

```
app_settings → categories → suppliers → users → audit_logs → customers → employees →
parts → service_items → sessions → inventories → vehicles → work_orders → expenses →
inventory_transactions → payments → vehicle_service_records → work_order_items
```

**4. 实际迁移记录数：1,856 行 / 18 张表**

| 表            | 行数 | 表                      |     行数 |
| ------------- | ---: | ----------------------- | -------: |
| app_settings  |    0 | inventories             |       51 |
| categories    |   10 | vehicles                |       58 |
| suppliers     |    5 | work_orders             |       89 |
| users         |    3 | expenses                |       80 |
| audit_logs    |  869 | inventory_transactions  |      306 |
| customers     |   34 | payments                |       78 |
| employees     |   23 | vehicle_service_records |       55 |
| parts         |   51 | work_order_items        |      126 |
| service_items |   16 | **合计**                | **1856** |
| sessions      |    2 |                         |          |

---

## 五 ~ 八：对账结果

**5. Count 对账：18/18 全等，mismatch = 0**（上表两列在报告中逐表打印 `PG = SQLite ✓`）

**6. 财务对账：difference = 0.00**（口径由领域仓储在两种存储上各算一遍）

| 指标           |    PostgreSQL |        SQLite |
| -------------- | ------------: | ------------: |
| 客户数（在册） |             9 |             9 |
| 车辆总数       |             9 |             9 |
| 工单总数       |            89 |            89 |
| 已完成工单     |            32 |            32 |
| 已取消工单     |            31 |            31 |
| 总应收         |       7515.00 |       7515.00 |
| 总已收         |       4822.50 |       4822.50 |
| 总欠款         |       2692.50 |       2692.50 |
| 收款笔数/总额  |  57 / 4822.50 |  57 / 4822.50 |
| 支出笔数/总额  | 59 / 53930.50 | 59 / 53930.50 |
| 库存总数量     |       1233.00 |       1233.00 |
| 库存总估值     |      45327.08 |      45327.08 |
| 库存流水数     |           306 |           306 |
| 审计日志数     |           869 |           869 |
| 账号数         |             2 |             2 |

> 说明：账号数 2 而 users 表 3 行，是因为 `user.list()` 只统计未软删账号；
> 两侧口径一致（3 = 3 on table count，2 = 2 on active），这正是用同一套仓储对账的意义。

**7. 工单对账：WorkOrder compared: 89 / Mismatch: 0**
逐张比较 `totalAmount / paidAmount / outstandingAmount（领域层算的应收−已收）/ status /
customerId / vehicleId`，不是只比总额。

**8. 库存对账：Part+Inventory compared: 51 / Mismatch: 0**
逐件比较 `当前库存 / 安全库存 / 进货价 / 销售价 / 库存估值`。

**补充（超出要求的更强证据）**：全表**逐行逐列**对账 —— 1,856 行全部比较，mismatch = 0；
其中 Audit 的 `before / after` JSON 语义比较 1,142 个非空值全部等价。
边界样本：Decimal `0 / 0.01 / 1.10 / 99999999.99 / 1234.5→1234.50` 全 ✓；
日期最早/最晚（work_orders.created_at、completed_at、payments.occurred_at、
audit_logs.created_at、sessions.expires_at）两侧完全一致。

**9. FK check：0 violations**
SQLite `PRAGMA foreign_key_check` = 0 行；并且沿 26 条真实外键边逐条做孤儿检查
（vehicle→customer、work_order→vehicle/customer、work_order_item→work_order、
payment→work_order、inventory_transaction→part、audit_log→user、session→user 等），
PostgreSQL 与 SQLite 均为 0 = 0 ✓。**不是只看 count。**

**10. integrity check：ok**
主库、每份备份、恢复后的主库都执行 `PRAGMA integrity_check` → `ok`；
备份校验还要求业务表齐备 + `schema_version >= 1`。

---

## 九 ~ 十：Backup / Restore 实现

**11. Backup 实现** `src/server/backup/backup-service.ts`（`BackupService`：
create / list / verify / restore / prune / maybeCreateDailyBackup）

- 用 `node:sqlite` 的 `backup()`（SQLite Online Backup API）生成**单一、一致**的备份文件，
  而不是复制 `autorepair.db`（WAL 下那样会丢最近提交）。
- 命名 `autorepair-YYYYMMDD-HHMMSS.db`；恢复前自动备份命名 `…-prerestore.db`。
- 创建后立即校验：`integrity_check` + `foreign_key_check` + 业务表齐备 + schema 版本；
  任一项不过 → 删除该文件并报错，**绝不标记为成功**。
- 保留最近 N 份（`AUTOREPAIR_BACKUP_RETENTION`，默认 30），创建后自动执行。
- 每日自动备份：服务启动时（`APP_STORAGE=sqlite`）由 `src/instrumentation.ts` 调用，
  当天已有备份则跳过 —— 实测启动日志：`[backup] 每日自动备份：autorepair-20260914-231424.db`。
- CLI：`pnpm backup create|list|verify|restore|prune|daily`。
- 契约 `pnpm backup:contract` 19/19（含真实破坏恢复与注入失败的回滚）。

**12. Restore 实现**

```
校验备份（不过则拒绝）→ 自动 pre-restore 备份 → 关闭主库连接 →
把当前库移到 <db>.restoring → 删除 -wal/-shm → 拷入备份 → 校验新库 →
重开连接（含 migration）→ 删除 <db>.restoring → 执行保留策略
任何一步失败：丢掉半恢复的主库、把 <db>.restoring 放回、重开连接、抛出明确错误
```

实测（§19 真实破坏恢复）：写入标记客户 `RESTORE-MARKER-CUSTOMER`（customers 37、markers 1）
→ 关闭服务 → **真实删除主库（含 -wal/-shm）**（exists=false）→ 从备份恢复 →
恢复后 customers 36、**markers 0**、`integrity_check=ok`、FK 0 →
重启服务 → 登录成功、全部页面 200 → 再跑 135 项冒烟 135/135。
备份契约里还注入了「重开连接失败」，验证恢复中途失败会回滚到恢复前状态。

---

## 十一 ~ 十三：smoke 与 contracts

**13. PostgreSQL smoke：135/135 ✅**（`pnpm smoke` / `pnpm smoke:postgres`）

**14. SQLite smoke：135/135 ✅**（`pnpm smoke:sqlite`，首次真正可用）

改造方式按用户要求：**共享 smoke → postgres / sqlite**。
`scripts/smoke-test.ts` 的 135 条断言本来就走 service 层，与存储无关；
只有 18 处「直接看库」的交叉核对此前直连 Prisma。这些访问收敛到
`scripts/smoke-inspector.ts` 的一个接口 + 两个实现（Prisma / node:sqlite），
断言本身**一个字都没改**，因此改造不会悄悄放松验收标准；
数据库专属的基础设施就隔离在这一个文件里。

**Storage Matrix（阶段 2 最重要的最终证明）**

```
PostgreSQL:  135/135 ✅
SQLite:      135/135 ✅   （恢复后再次运行仍 135/135 ✅）
```

**15. 所有 contracts（实测）**

| 脚本                          | 结果  |
| ----------------------------- | ----- |
| `pnpm work-order:contract`    | 37/37 |
| `pnpm customer:contract`      | 78/78 |
| `pnpm vehicle:contract`       | 63/63 |
| `pnpm part:contract`          | 37/37 |
| `pnpm inventory:contract`     | 27/27 |
| `pnpm finance:contract`       | 31/31 |
| `pnpm catalog:contract`       | 29/29 |
| `pnpm user:contract`          | 33/33 |
| `pnpm audit:contract`         | 17/17 |
| `pnpm session:contract`       | 22/22 |
| `pnpm session:prune-contract` | 17/17 |
| `pnpm backup:contract`        | 19/19 |
| `pnpm sqlite:verify`          | 32/32 |
| `pnpm storage:verify`         | 25/25 |

其它门禁：`pnpm typecheck` 通过、`pnpm lint` 0 error / 0 warning、
`pnpm format:check` 全部符合、`pnpm build`（已移除 NODE_OPTIONS）通过（18 条路由）。

---

## 十四：拔线验证（PostgreSQL 完全不可连接）

前置实测：`postgres` 进程数 = 0，`127.0.0.1:55432` 不可连接，
服务进程 `DATABASE_URL=postgresql://127.0.0.1:1/unavailable`、`APP_STORAGE=sqlite`。

```
启动（生产 next start）           ✅ 日志仅出现 [storage] Storage: SQLite
每日自动备份                      ✅ autorepair-20260914-231424.db
登录（真实 server action）        ✅ 303 → /dashboard，下发 ar_session
全页面（16 个路由 + manifest）    ✅ 全部 200 且渲染真实数据；/login 带会话时 307→/dashboard（正确）
完整业务 smoke                    ✅ 135/135
备份                              ✅ pnpm backup create
真实破坏恢复                      ✅ 删主库 → 恢复 → 标记数据消失、校验 ok
重启后再次验证                    ✅ 登录 + 全页面 200
恢复后写入（§20）                 ✅ 135/135（建客户→建车→建单→加工时/配件→扣库存→收款→完工→Audit）
```

页面清单：`/dashboard`、`/work-orders`、`/work-orders/new`、`/work-orders/[id]`、
`/customers`、`/customers/[id]`、`/vehicles`、`/vehicles/[id]`、`/inventory`、
`/inventory/[id]`、`/finance`、`/reports`、`/settings`、`/me`、`/login`、`/offline`、
`/manifest.webmanifest`。

> 诚实说明：本会话没有 true browser E2E（skill 目录里没有 `computer-use`），
> 页面验证是 HTTP 层（真实 server action 登录 + 每个页面 200 + 关键内容命中 + 无错误标记）。
> 证据强度弱于真实浏览器，但覆盖了路由、鉴权、数据渲染与写路径。

---

## 十五：本阶段发现并修复的真实缺陷

1. **`scripts/finance-repository-contract.ts` 清理缺口**（验收时红过一次）。
   只按工单 id 删除 payment/expense，`workOrderId = NULL` 的手工流水每次运行都残留；
   而测试年份是 `2200 + Date.now()%500` 的随机年份，一旦与残留年份撞车，
   二月计数断言就失败。已改为按「本次年份窗口」清理；实测清理后再跑 2 次，
   数据库残留 1 payment / 3 expense → **0 / 0**。
2. **`scripts/session-store-contract.ts` 断言不隔离**（验收时红过一次）。
   `pruneExpired(2099)` 会清掉**全表**早于 2099 的会话（包括真实登录会话），
   但断言要求返回数恰好为 1，因此库里只要有真实会话就假红。
   已改为「本契约的过期会话消失 + 有效会话仍在」，实测在库内有 7 个真实会话时仍 22/22。
3. **备份目录残留 `-wal`/`-shm`**：校验时只读打开 WAL 库会生成伴生文件。
   已在服务层清理（主库绝不在清理范围），并加了契约断言（19/19）。

三者都只用测试/备份代码修复，未改业务规则、财务公式、库存规则、权限、Session、Audit、UI。

---

## 十六：阶段 2 完成标准逐条核对

```
所有 Repository SQLite          ✅
Session SQLite                  ✅
Audit SQLite                    ✅
Postgres → SQLite Migration     ✅（18 表 / 1856 行 / 原 ID 保留）
逐表 Count                      0 mismatch
Foreign Key                     0 violation（含 26 条外键边的孤儿检查）
WorkOrder                       0 mismatch（89 张全量）
Finance                         0 difference（金额差 0.00）
Inventory                       0 mismatch（51 件全量）
Backup                          ✅（Online Backup API + 创建即校验）
Backup integrity                ok
Restore                         ✅（含真实删库恢复 + 失败回滚）
Post-restore write              ✅（135/135）
PostgreSQL smoke                135/135
SQLite smoke                    135/135
PostgreSQL unplugged            ✅（进程 0 / 端口关闭 / DATABASE_URL 不可达）
```

---

## 十七：当前已知遗留风险

1. **SQLite 首次安装的初始化流程仍未实现**。`prisma/seed.ts` 是 PostgreSQL 专用；
   目前让一台新 PC 拥有可用数据的方式是 `pnpm migrate:postgres-to-sqlite`。
   「全新安装 → 创建管理员 + 基础资料」属于用户规范第十八节，本阶段按范围未做。
2. **恢复要求服务已停止**。Windows 下文件被占用会明确报错（不会产生半恢复的库），
   但 UI 尚未提供「备份/恢复」入口（本阶段刻意不改 UI，只保证 service + CLI + 配置可用）。
3. **迁移读取阶段全量进内存**。1,856 行无压力；数十万行需要改成分批/流式。
4. **备份策略只按份数**（默认 30），没有容量上限、没有异地副本、没有加密。
5. **每日自动备份依赖进程启动**。PC 端长期不重启也没关系（同一天只做一次）；
   若要「无论是否启动都备份」，需要操作系统计划任务调用 `pnpm backup daily`。
6. **SQLite smoke 有前置条件**：目标库必须已有基线数据（迁移后的库或既有库）。
   PostgreSQL 的 `pnpm smoke` 同样依赖 seed 数据，两者口径一致。
7. **本会话无真实浏览器 E2E**（见上文说明）；建议下一阶段用 `computer-use` 补一轮。
8. **多进程/多实例**：SQLite 单文件 + WAL 适合单机 PC；不要同时跑两个写进程
   （迁移/恢复/备份 CLI 会与运行中的服务争文件，恢复前务必停服）。

## 下一阶段（先停，不直接进入 Capacitor）

用户明确要求：本阶段完成后**不要立即开始手机同步**。
建议顺序：先补 §18「SQLite 全新安装初始化」（把它做成 `pnpm db:init` / 首次启动向导），
再讨论 Capacitor 外壳与 PC↔手机同步（届时 `SessionStore` / `AuditRepository` 的
设备令牌方案、以及同步冲突策略都需要单独立项）。

Redacted by design: 密码、密钥、数据库凭据与个人数据未写入本文档。
