# 关键设计决策记录（ADR）

记录「为什么这样做」，避免后续维护者把刻意为之的设计当成疏漏改掉。

---

## ADR-001 · 工单项使用单表 + 类型字段，而非 WorkOrderPart / WorkOrderLabor 分表

**背景**：需求中列出了 `WorkOrderItem`，并建议按实际情况补充 `WorkOrderPart` / `WorkOrderLabor`。

**决策**：只保留 `work_order_items` 一张表，通过 `type`（`SERVICE | PART | LABOR | OTHER`）区分。

**理由**：

1. 四类工单项的字段完全一致（名称、规格、数量、单价、成本、金额），分表会带来四份重复的 CRUD 代码。
2. 金额汇总、排序、打印小票都是「按工单取所有行」，分表后每次都要 4 次查询 + 内存合并。
3. 排序需要跨类型交错（比如「先工时、再配件」），分表无法用单一 `sortOrder` 表达。
4. 未来新增类型（如「外协加工费」）只需加枚举值，不必新增表与迁移。

**代价**：配件相关的库存联动要在类型判断里区分处理——这一点已通过 `insertItem` / `removeWorkOrderItem` 等函数集中收敛，没有散落。

---

## ADR-002 · 收款与支出分两张表（`payments` / `expenses`），台账在 service 层合并

**背景**：统一成单表 + `direction` 在很多系统里更「优雅」。

**决策**：保留 `payments`（收入）与 `expenses`（支出）两张表。

**理由**：

1. 两者业务语义差异大：收款必须能关联工单、参与「已收/未收」计算；支出关联的是供应商与固定成本科目。
2. 收入分类（维修/配件/工时/其他）与支出分类（房租/水电/工资…）完全不同，合成单表后 `category` 字段的合法性只能靠代码保证，数据库层失去约束。
3. 报表需要的「统一流水」视图由 `finance.service.ts` 的 `listCashFlow()` 合并输出，重复代码仅此一处。

---

## ADR-003 · 客户手机号、车牌号不做数据库唯一约束

**背景**：直觉上手机号与车牌应该唯一，很多系统会加 `@unique`。

**决策**：只建索引，不做唯一约束；唯一性在 service 层判断并给出可读提示。

**理由**：

1. **与软删除冲突**：客户被软删除后，其手机号仍占用唯一索引，新客户无法用同一号码建档。PostgreSQL 的部分唯一索引（`WHERE deleted_at IS NULL`）可以解决，但 Prisma 无法声明，必须手写迁移，长期维护成本高。
2. **现实场景需要**：夫妻共用一台车与一个手机号、车辆过户后新车主要用原车牌，硬唯一会直接拒绝真实业务。
3. 体验更好：`createCustomer` 检测到重复时返回「手机号 138xxxx 已存在客户「张三」，请直接搜索使用」，比数据库抛出的 P2002 友好得多。

**代价**：唯一性依赖应用层，绕过 service 直接写库可能产生重复数据——因此数据写入一律经过 service（见 CONVENTIONS）。

---

## ADR-004 · 金额与数量使用 Decimal，且只在 `lib/money.ts` 中运算

**背景**：JS 浮点数在金额场景会产生 `0.1 + 0.2 = 0.30000000000000004` 一类误差。

**决策**：

- 数据库：金额 `Decimal(14,2)`，数量 `Decimal(12,2)`。
- 代码：统一走 `src/lib/money.ts`（基于 decimal.js），对外输出为保留 2 位小数的字符串。
- 跨端传输：DTO 中所有金额都是 `string`，客户端**只格式化不运算**。

**理由**：浮点误差在记账系统里会累积成对不上账的差额；把运算收敛到单一模块，也保证「优惠不超过小计」「未收金额不为负」等规则只有一份实现。

**代价**：`Decimal` 不能直接序列化给 React 客户端组件，因此需要 `server/serializers.ts` 做显式转换——这是有意为之的边界，反而让「哪里碰了金额」一目了然。

---

## ADR-005 · 工单项价格快照，工单不直接引用目录价格

**背景**：`parts` / `service_items` 是目录，工单是历史凭证。

**决策**：`work_order_items` 冗余存储 `name / spec / unit / unit_price / cost_price`，`item_ref_id` 仅作溯源线索，不建外键。

**理由**：

1. 配件调价后，历史工单金额必须保持不变，否则报表与已收款项全部失真。
2. `item_ref_id` 不建外键，配件被删除（软删）时不会破坏历史工单，也不会因外键约束导致删除失败。

**代价**：目录改名不会回溯到历史工单——这正是期望行为。

---

## ADR-006 · 库存拆成 Part / Inventory / InventoryTransaction 三层

**决策**：

- `parts`：配件档案（名称、规格、进货价、销售价）
- `inventories`：当前库存数量、安全库存、移动加权平均成本（与 Part 一对一）
- `inventory_transactions`：所有变动的流水，记录变动前后数量，只增不改

**理由**：

1. 库存数量是高频更新的热字段，与档案分表可减少写放大与行锁冲突。
2. 账实必须可对：任何数量变化都必须有对应流水，`qtyBefore/qtyAfter` 让任何时点的库存都能被反推验证。
3. `SELECT ... FOR UPDATE` 行锁加在 `inventories` 单行上，比锁整个 `parts` 表更细粒度，避免并发开单时互相阻塞。

**代价**：读取配件列表需要 join 库存表——已通过 `partListSelect` 统一处理。

---

## ADR-007 · 自建会话鉴权，不使用 NextAuth

**决策**：`users` + `sessions` 两张表，登录后签发 32 字节随机 token，Cookie 中存原文（httpOnly + SameSite=Lax + 生产环境 Secure），数据库中**只存 token 的 SHA-256 哈希**。

**理由**：

1. 需求只需要「管理员 / 员工」两种角色，NextAuth 的 OAuth、Adapter 体系属于净增复杂度。
2. 会话存库即可**主动吊销**（停用账号、重置密码时立即清除全部会话），这是纯 JWT 方案做不到的。
3. 数据库泄露时攻击者无法直接拿到可用 token。

**代价**：每次请求要查一次会话表——已用 React `cache()` 保证单次请求只查一次。

过期会话清理在 Step 5 才真正接入（此前 `pruneExpiredSessions()` 没有任何调用点，
从不再登录的账号会在 `sessions` 表里长期留痕）。现在有两个触发点，实现在
`src/server/auth/session-prune.ts`：

- **登录成功**：`maybePruneExpiredSessions()`，进程内按 1 小时节流，失败只 warn，
  绝不让清理失败影响登录；
- **运维 / 定时任务**：`pnpm session:prune`，无条件执行一次、失败非 0 退出码。

清理是 `expires_at` 索引上的幂等 `DELETE`，所以**有意不加分布式锁**：
多实例各自计时、重复清理只是多一次空写，为它引入锁反而增加故障面。

---

## ADR-008 · 移动端用原生 `<input type="date">` 而不是自研日期组件

**决策**：`DatePicker` 组件内部使用原生 date input，仅叠加日历图标与「今天/昨天/前天」快捷选项。

**理由**：手机端操作系统原生日历滚轮的体验、可访问性、多语言都优于自研组件，且零 JS 体积。真正需要自定义的只有桌面端，而桌面端 `<input type="date">` 表现同样合格。

**代价**：无法限制到「只允许选择某几个日期」这类复杂规则——当前业务不需要。

---

## ADR-009 · 库存不足不是错误，而是可预期的业务失败

**决策**：`applyStockChange` 在库存不足时抛出 `BusinessRuleError`，由 `safeAction` 转换为

> 当前库存不足，无法出库。（现有 3.00，需要 5.00）

**理由**：这类失败店员每天都会遇到，文案必须包含**现有量与实际需求量**，否则店员无法判断是「记错库存」还是「真的没货」。禁止静默失败，也禁止用「操作失败」这种无信息文案。

---

## ADR-010 · PWA 不缓存业务数据

**决策**：Service Worker 只缓存静态资源与页面外壳，POST（Server Action）一律直连网络；离线时返回 `/offline` 页并明确提示「为保证账目准确，本系统不会在离线状态下写入数据」。

**理由**：维修店网络环境不稳，如果允许离线写入再同步，会产生金额与库存的合并冲突。第一版选择「宁可不可用，也不能算错账」。后续如需离线开单，应基于「服务器为准 + 冲突检测」单独设计，而不是简单加一层队列。

---

## ADR-011 · 员工数据分 `users`（登录账号）与 `employees`（员工档案）

**决策**：两个独立实体，`employees.user_id` 可选关联到 `users`。

**理由**：店里常有「不登录系统但需要被指派工单、统计工作量」的技师（如钣金师傅）。把二者合并会迫使每个技师都必须有登录账号，既增加管理成本也存在安全风险。

**代价**：新增技师时要多填一次姓名——已在「设置 → 技师档案」中做成一步操作，并支持事后绑定账号。

---

## ADR-012 · 状态机允许「待质检 → 已完成」这条捷径

**背景**：需求给出的主链路是 待接车 → 维修中 → 待质检 → 待付款 → 已完成。

**决策**：在严格遵守主链路的前提下，额外允许两个捷径：

- `待质检 → 已完成`：质检通过且款项已结清时直接交车
- `待质检 / 待付款 → 维修中`：质检不合格或客户追加项目时返工

**理由**：这是被集成测试（`pnpm smoke`）暴露出来的真实缺陷。

店里很常见两种场景：客户进店先付款，或者月结 / 保修单根本不涉及收款。
这两种情况下工单走到「待质检」时钱已经收完了，如果强制必须先切到「待付款」，
店员就被迫把一个无款可收的工单标成「待付款」，然后在语义错误的状态下点完成——
**状态字段从此不再可信，报表按状态做的统计也跟着失真**。

**代价**：状态图不再是纯线性，需要在 `WORK_ORDER_STATUS_FLOW` 里显式维护。
好处是所有流转规则集中在一处，UI 只展示「允许流转到」的状态，不会出现非法跳转。

---

## ADR-013 · service 层只依赖纯权限判断，不依赖 `next/navigation`

**背景**：最初 `guard.ts` 同时放了页面守卫（用 `redirect`）和纯权限判断（`canModifyWorkOrder`）。

**问题**：`work-order.service.ts` 需要 `canModifyWorkOrder` 做「员工只能改自己的单」判断，
于是把 `next/navigation` 一并拖进了整个领域层。后果是
**service 只能在 Next 运行时里跑**——写 CLI 自检脚本、跑集成测试都会直接崩在
`React.createContext is not a function` 上。

**决策**：拆成两个文件：

| 文件                         | 内容                                                                            | 允许依赖                          |
| ---------------------------- | ------------------------------------------------------------------------------- | --------------------------------- |
| `server/auth/permissions.ts` | `isAdmin` / `canModifyWorkOrder` / `canViewFinance` / `isTerminalStatus`        | 纯函数，无框架 API                |
| `server/auth/guard.ts`       | `requireUser` / `requireAdminPage` / `requireUserAction` / `requireAdminAction` | `next/navigation`、`next/headers` |

service 层**只允许** import `permissions.ts`。

**收益**：领域逻辑与框架解耦后，`scripts/smoke-test.ts` 可以脱离 Next 直接调用 service 层，
对真实的 PostgreSQL 跑完整业务链路（建单 → 扣库存 → 收款 → 完工 → 取消回滚），
30 项断言在秒级完成。这条约束由 ESLint 之外的人工约定保证，改动 service 时请留意。

---

## ADR-014 · 领域层不依赖 Prisma，存储能力由仓储接口提供

**背景**：目标是让手机端（Capacitor + SQLite）成为主数据源、PC 端作从属副本。
手机端要复用「建单算钱、扣库存、状态流转」这套业务逻辑，而 **Prisma 在 Capacitor 的
WebView 里跑不起来**。若让手机端另写一套业务逻辑，等于把金额计算和库存规则复制一遍——
这正是本项目一开始极力避免的错误来源。

**被否掉的方案**：在 JS 里重新实现一遍 Prisma 的查询 API（where/select/include/orderBy/
aggregate/groupBy…）套在 SQLite 上。理由：那是重写一个 ORM，几千行代码，任何一处细微
不一致都会变成**静默的账目错误**，而且没人能审得完。

**决策**：抽出仓储层，业务逻辑只依赖接口。

```
domain 实体/行类型  ←  业务服务（事务、规则、审计）
        ↑                    ↓ 只依赖接口
   src/domain/repositories.ts
        ↓ 三套实现
  Prisma(PG) | Prisma(SQLite) | 原生 SQLite(手机)
```

四个关键约束：

1. **行类型必须手写**。原先 `WorkOrderListRow` 等由 `Prisma.XGetPayload<...>` 推导，
   这是后端耦合的真正根。改为 `src/domain/rows.ts` 手写接口。
   为防漂移，`src/server/repos/prisma/type-assertions.ts` 用类型约束在**编译期**证明
   Prisma 推导结果满足领域类型（已实测：把 `totalAmount` 从 Decimal 改成 string 会立刻报错）。
2. **枚举不 import `@prisma/client`**。`src/domain/enums.ts` 用「字面量联合 + as const 数组」
   定义，运行时是普通字符串，SQLite / 内存实现都能直接用。
3. **事务由 `transaction(fn)` 提供**，回调里拿到的仓储绑定同一事务。业务层不出现
   `$transaction` / `BEGIN` 等任何后端概念。PostgreSQL 用 `$transaction`，
   SQLite 用 `BEGIN IMMEDIATE`。
4. **驱动错误在适配层翻译**。仓储实现用 Proxy 包住全部方法，把 P2002/P2003/P2025/P2034
   翻译成 `UniqueConstraintError` / `ForeignKeyConstraintError` 等领域异常。
   因此 `server/errors.ts` 不再 import Prisma —— 否则手机端无法复用错误处理。

**注意**：`work-order.service.ts` 里的工单号重试，原先判断的是 Prisma 的 `P2002` 错误码，
现在判断的是领域异常 `UniqueConstraintError`。**这不是等价改写，而是必要的解耦**：
业务层不能认识驱动错误码。

**代价 / 遗留**：

- 迁移是**逐服务推进**的，接口只声明已迁移服务真正用到的方法，不做投机性声明。
  过渡期通过 `server/context.ts` 的 `reposFor(client)` 桥接。
- **当前进度：11 个业务 service 已全部迁移完毕**，`src/server/services/` 下不再出现
  `prisma`。校验方式：`grep -rln 'from "@/server/db"' src/server/services` 应为空。
- **不在本次范围内（有意保留直连）**：`src/server/auth/session.ts`、`auth/audit.ts`、
  `actions/auth.actions.ts`。它们操作的是会话与登录日志这类**基础设施表**，
  手机端的会话机制与 PC 端不同（没有服务端 session 表），复用同一套仓储接口
  没有意义，硬抽只会增加无用的间接层。
- **页面与 action 层也不允许直连**：`src/app/(app)/inventory/page.tsx` 曾直接
  `prisma.part.count()`、`actions/vehicle.actions.ts` 曾直接 `prisma.customer.findFirst()`，
  已分别收敛为 `countActiveParts()` 与 `findCustomerIdByPhone()`。
  判据：`grep -rln 'from "@/server/db"' src` 只应命中 `server/repos/create-repositories.ts`
  （PostgreSQL 分支）与 `server/repos/prisma/client.ts`。
  （Step 4/5 之后 auth 三文件也已收口：会话走 `SessionStore`，登录日志走 `AuditRepository`。）

**Step 5 补充：SQLite 已可作为唯一存储运行**。`APP_STORAGE=sqlite` 下 10 个业务 Repository、
Audit、SessionStore 全部使用 node:sqlite；共享冒烟套件 `pnpm smoke:sqlite` 与 PostgreSQL
各跑一遍 135/135。数据库专属的直接检查（冒烟脚本里那几处「直接看库」）收敛在
`scripts/smoke-inspector.ts` 的两个实现里，断言本身与存储无关。

---

## ADR-015 · PostgreSQL → SQLite 迁移不用文件复制，且必须逐行对账

**背景**：PC 端要脱离 PostgreSQL 单机运行，已有客户的 PostgreSQL 数据必须能搬过去。
直觉方案是「把库导成 SQL 文件再灌进去」或「用某种 dump 工具」。

**决策**：自建迁移工具（`pnpm migrate:postgres-to-sqlite`），流程固定为
**读取 PostgreSQL → 领域类型转换 → 单个 SQLite 事务写入 → 七层校验**。

**理由**：

1. **两边 schema 不同形**：PostgreSQL 的 Decimal 是 numeric、DateTime 是 timestamp，
   SQLite 侧是手工写的 snake_case DDL（金额 TEXT、日期 TEXT ISO、布尔 INTEGER）。
   任何「通用导库」都要处理这层映射，交给工具猜不如显式写出来。
2. **原 ID 必须保留**。重新生成主键会让历史关系（工单→客户/车辆、流水→工单）全部断裂，
   且无法与旧系统对账。迁移工具从 Prisma DMMF 取字段、从 `PRAGMA table_info` 取列，
   两边双向覆盖校验，宁可失败也不静默错列。
3. **顺序来自真实外键图**，不是手写清单：拓扑排序保证父表先写，FK 开启下插入即校验。
4. **只比总量是假验收**。总营业额相同、单张工单金额错位是完全可能的。
   因此校验分七层：逐表 Count → `foreign_key_check` → 逐条外键的孤儿检查 →
   业务聚合对账 → 全表逐行逐列对账 → 工单专项（含未收）→ 配件库存专项（含估值），
   外加金额/日期边界样本。任何一项不一致，迁移即失败（非 0 退出码）。

**代价**：读取阶段把所有行读进内存（本项目 1,856 行毫无压力；几十万行需要改成分批）。
目标库已有数据时**拒绝静默覆盖**，必须显式 `--force`，且覆盖前自动生成 pre-migration 备份；
覆盖时在同一事务内先按外键反序清空业务表，失败则整体回滚到覆盖前。

---

## ADR-016 · SQLite 备份用 Online Backup API，恢复永不直接覆盖

**背景**：WAL 模式下，直接复制 `autorepair.db` 会丢掉还在 `-wal` 里的最近提交 ——
这类备份「看起来成功、恢复时才发现少了半天账」，是最危险的一种失败。

**决策**：

1. **备份**：用 `node:sqlite` 的 `backup()`（SQLite Online Backup API）产出单一、一致的文件；
   创建后立刻 `PRAGMA integrity_check` + `foreign_key_check` + 业务表齐备 + schema 版本校验，
   任何一项不过就**删除该备份并报错**，绝不把坏备份标记为成功。
2. **恢复**：先校验备份 → 自动生成 `-prerestore` 备份 → 关闭连接 → 把当前库移到一边 →
   清除 `-wal`/`-shm` → 拷入备份 → 校验新库 → 重开连接（含 migration）→ 才删除临时文件。
   任何一步失败都回滚到恢复前状态；备份校验不通过直接拒绝恢复。
3. **保留策略**：默认保留最近 30 份；启动时（`APP_STORAGE=sqlite`）自动做一次「每日备份」。

**理由**：备份/恢复是唯一「平时看不出来、出事时决定生死」的功能，所以宁愿多写一层校验、
多留一份 pre-restore，也不要一个「看起来有备份」的假象。恢复失败必须还能回到恢复前。

**代价 / 遗留**：恢复要求服务已停止（Windows 文件占用会明确报错，而不是产生半恢复的库）；
保留策略只按份数，没有容量上限、也没有异地副本；备份目录与数据库路径只能通过环境变量配置，
UI 尚未提供入口（本阶段刻意不改 UI）。

---

## ADR-017 · 车牌片段联想只做「匹配与排序」，不改变建档规则

**背景**：新建工单第一步是输车牌。原来的实现是**精确匹配 + 手动点查询**：
输错一个字就是「未找到」，然后系统会拿这个车牌**直接建一辆新车**
（`work-order.service.ts` 建档分支没有查重、schema 也没做格式校验）。
结果是同一辆车因为一个错字被建成两条档案 —— 这是本系统最隐蔽的数据分裂来源。

**决策**：

1. **归一化只做无损改写**：全角转半角、去掉空白与 `· ・ - _`、统一大写
   （`src/lib/plate.ts` 的 `normalizePlate`）。**不猜车牌结构** ——
   不自动补省份简称、不对新能源/港澳/军牌做特判。
   同一个函数被前端输入框、zod 校验、两种存储的匹配共用，避免出现
   「搜得到但存不进去」或「存进去但搜不到」。
2. **查询与联想不校验格式，只有新建车辆才校验**：联想必须允许半截输入；
   落库前才用 `isPlausiblePlate`（汉字省份 + 字母 + 5~6 位字母数字，覆盖普通 7 位与新能源 8 位）
   拦一道。校验点放在 **Server Action 的 schema** 上，所以绕过 UI 直接调 action 也拦得住。
   - 代价：临时牌、港澳牌这类非标车牌**建不进去**。这是明确接受的取舍 ——
     宁可少一道闸，也不猜车牌结构、更不愿意挡住真实业务。
3. **「新建车辆」必须显式点击**，且只有车牌格式合法时才能点；未确认车辆的工单**不许保存**。
   这是本次改动里唯一的业务硬约束，因为它直接对应「防重复建档」这个目标。
4. **建档前用「去掉最后一位」再查一次**：错一位（`粤A1234S` vs `粤A12345`）是最常见的
   重复建档来源，而 `contains` 匹配在原关键字上抓不到它（`粤A12345` 并不包含 `粤A1234S`）。
   所以建档前拿 `keyword.slice(0, -1)` 再联想一次，查到相近车牌就先摆出来确认。
5. **排序放在业务层，用纯函数**：`rankPlateCandidates` 做「前缀命中 > 最近进厂 > 档案更新时间」，
   仓储只按 `updatedAt` 倒序取一个**放大的窗口**。因为 Prisma 的 `orderBy` 无法表达
   「前缀优先」这类 CASE 排序，硬写进 SQL 会让 PostgreSQL 与 SQLite 两种实现行为分叉。
6. **排序结果不落库**：`suggestByPlate` 只被人用、不写库；「最近进厂」= 未删除工单里
   最大的 `createdAt`（不是 `vehicles.last_service_at` —— 那个只在保养记录里更新，
   不代表最近进厂）。
7. **不做模糊/编辑距离匹配**：车牌错一位就是另一辆车，把 `粤A12345` 与 `粤A1234S`
   混在一起给前台选，比搜不到更危险。
8. **不加数据库唯一约束**：车牌唯一性仍然只由 service 校验（见 ADR-003），
   且**没有**给 `createWorkOrder` 的建档分支补查重 —— 那会破坏「新车第一次进店一次建完」
   这个核心场景。本次只做「schema 格式闸门 + UI 显式确认」。

**理由**：车牌是这间店唯一可靠的车辆标识，而它同时是**手输**的。
所有改动都指向同一件事：让「输错的代价」在**建档之前**暴露出来。

**代价 / 遗留**：

1. `createWorkOrder` 的建档分支仍**没有**与车辆模块 `createVehicle` 对齐的重复校验 ——
   同一个动作在两条路径上行为不一致（**已知问题，本次不修**）。
2. `searchSuggestions` / `suggestByPlate` 的原始用途（跨实体联想）与现在工单页的用途
   已经分叉，`searchSuggestions` 目前**没有任何调用方**（**已知问题，本次不修**）。
3. 排序窗口是 `limit × 3`（上限 30），极端情况下窗口外的前缀命中会被截断。
   以实际数据量（数十辆车）不构成问题；数据量上来后需要改成 SQL 侧精确排序。
4. 「还有 N 条」只给出「还有更多，请继续输入」，不给精确条数 ——
   取数窗口有上限，精确条数本来就不保证。

**验证**：`pnpm plate:contract`（纯函数 40 项）、`pnpm vehicle:contract`（两种存储 75 项，
含 PostgreSQL/SQLite 语义快照一致）、`pnpm e2e:plate`（真实浏览器 19 项，**不点保存**、不写业务数据）。

---

## ADR-018 · Fresh Install 只在可证明为空时创建管理员，异常状态一律拒绝猜测

**背景**：SQLite 单机版过去只会建 schema，正式管理员仍依赖开发 seed；而 seed 同时包含员工、
目录、库存和演示业务，不能用于客户机器。单看 `autorepair.db` 是否存在也无法区分零字节文件、
迁移中断、恢复库和已有真实数据。

**决策**：

1. 启动 seam 固定为「明确路径建目录 → SQLite PRAGMA → migration → FirstRunBootstrap」。
   Migration 只管结构；Bootstrap 只管首个管理员与 `app_settings` 中的
   `system.bootstrap.completed=1`；开发 seed / smoke fixture 继续独立。
2. Bootstrap 的状态语义是：schema 或 marker 异常为 **BROKEN**；无 marker、无用户且所有业务表
   都为空为 **UNINITIALIZED**；管理员与 marker 正在同一事务写入时为 **INITIALIZING**；
   marker 可识别且至少有一名启用管理员为 **READY**。`INITIALIZING` 不持久化为中间 marker，
   因为事务失败会同时回滚管理员和 marker。
3. 真正空库必须提供并通过现有账号/密码规则的 `BOOTSTRAP_ADMIN_USERNAME` 与
   `BOOTSTRAP_ADMIN_PASSWORD`；密码只写 bcrypt hash，日志不输出账号凭据或 hash。
   初始化完成后不再读取这些变量，因此重启不会改名、改密码或新增管理员。
4. 兼容 Stage 2 既有库与旧备份：无 marker 但已有启用管理员时，只补 marker，绝不修改账号与
   业务数据。反之，只要存在用户或任一业务表有数据却没有启用管理员，就 fail-fast；管理员恢复
   必须未来另做显式流程，不能借 bootstrap 猜测。
5. 管理员与 marker 使用 `BEGIN IMMEDIATE` 单事务写入。Migration 仍按文件各自事务推进；所以
   bootstrap 配置错误时可能留下一个**完整、可重试的 schema-only 数据库**，但不会留下半个管理员
   或错误完成标记。
6. 空白新库不立即创建每日备份；首次产生业务数据后，既有每日备份机制在后续启动时照常工作。
   BackupService / Restore 语义不改，恢复后的 READY 库不会再次 bootstrap。

**代价 / 遗留**：被停用/删除了全部管理员的既有库会拒绝启动，当前没有自动恢复入口；首次启动
依赖部署者安全传入管理员凭据，尚无交互式首次设置 UI；Windows 实测拒绝写 ACL 时能 fail-fast，
但安装器最终选择的数据目录及企业域策略组合仍需在打包阶段复验。

**验证**：`pnpm fresh-install:verify` 使用受路径守卫保护的系统临时目录，在 PostgreSQL 明确不可达时
覆盖空目录、零字节 DB、未完成 migration、schema-only、事务故障回滚、三次幂等启动、旧库认领、
已有数据保护、异常 marker、不可用目录、登录会话、客户→车辆→工单→收款、Audit、Backup、Restore，
当前为 82/82（Windows 下包含真实拒绝写 ACL）；正式 bootstrap 的初始行数只有 `users=1`、
`app_settings=1`，其余业务表均为 0。`pnpm build && pnpm e2e:fresh-install` 另用真实生产进程与
本机 Edge 验证首次进入登录页、登录 Action、Session 持久化及不创建空备份，当前为 11/11。

---

## ADR-019 · PC 与 Mobile 共享领域契约，不共享运行时和数据库驱动

**背景**：PC 应用依赖 Next.js Server Actions、Node Runtime 与 `node:sqlite`，这些能力不能在
Capacitor WebView 内离线运行；把 Mobile 指向 PC/云端 URL 又会让手机失去独立离线能力。

**决策**：PC 继续使用 Next.js，不为移动端改造成 Vite。Mobile 位于 `apps/mobile`，使用独立的
React + Vite 静态客户端，由 Capacitor 8 打包本地资源，禁止配置远端 `server.url`。Mobile 数据库
固定使用 Android Native SQLite；`com.autorepair.manager` 是当前唯一 applicationId，正式发布前仍可
整体确认一次。PC `node:sqlite` 与未来 Mobile SQLite 是同一 Repository seam 下的不同 Adapter；
两端只共享不依赖 `next/*`、`server-only`、`node:*`、Prisma 的 Domain 类型、Repository Contract、
金额与纯校验，不共享数据库驱动实现。

**代价 / 遗留**：Mobile 必须维护自己的静态路由、系统 UI 生命周期和 SQLite Adapter；Stage 3.1
只用 `autorepair-mobile-probe` 验证原生桥，正式 Mobile Repository 与业务 schema 留到 Stage 3.2。
