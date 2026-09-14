# Handoff: AutoRepair Manager — 新建工单「车牌片段联想」切片

> 本文档只记录**操作状态与陷阱**。决策理由、代价与遗留全部在
> `docs/DECISIONS.md` 的 **ADR-017**，改动明细与验证清单在提交 `da858ca` 的信息与 diff 里，
> 两者都不在此复述。

## Suggested skills

- **`code-review`** —— 首选。提交 `da858ca` **尚未推送**，正是双轴 review（Standards + Spec）
  的好对象；Spec 侧读本文 + ADR-017。推之前先跑它。
- **`diagnosing-bugs`** —— 真人手机验证若发现手感问题（防抖、滚动、软键盘遮挡、候选不顺），
  按诊断循环走，不要凭猜改。
- **`domain-modeling`** —— 若下一片要补 ADR / 动领域术语。`docs/DECISIONS.md` 下一号是 **ADR-018**。
- **`frontend-design`** —— 若要继续打磨候选列表视觉。
- **不要**调用 `handoff`（本文即其产出）。

## 这个切片是什么

新建维修工单里「输入部分车牌 → 内联候选 → 点选锁定」，以及配套的防重复建档闸门。
原本这一步是「精确匹配 + 手动点查询」，输错一个字就会被当成新车牌**直接建一辆新车**。
决策与取舍见 **ADR-017**；改动明细见 **`da858ca`**。

## 当前状态（交接时的真实状态）

- 工作区 `E:\autorepair-manager`，分支 `main`，**工作树干净**。
- 最新提交 **`da858ca`**，**没有 push**：`main` 领先 `origin/main` 1 个提交。
  用户明确要求的顺序是「先 commit，等他真机验过手感再 push」。
- 本地生产服务器**仍在运行**（`pnpm start`，端口 3000）：
  `http://localhost:3000` 与 `http://192.168.2.14:3000` 均实测 200，跑的是本次改动后的构建。
- 内置 PostgreSQL **已停止**（端口 55432 空闲）。再跑 Prisma 侧契约需要重新拉起。
- 用户尚未反馈真机验证结果。

## 不要做的事

1. **不要 push**，直到用户明确说手机上手感 OK。
2. **不要开始 Capacitor / 手机同步 / 原生壳**（用户的长期约束：一次一片）。
3. **不要清理**库里的测试数据（切片决策 Q17），也**不要顺手修** ADR-017 里已登记的两条遗留
   ——它们是被有意留下的，改之前先问。
4. **不要改**工单业务规则、财务公式、库存规则、权限、Session、Audit（除非发现真实缺陷）。

## 环境与命令行陷阱（都是本次实测踩到过的）

1. **`pnpm db:start` 必须用后台任务启动**。它是前台进程，直接在普通 pwsh 调用里跑，
   调用一结束整个进程树就被杀掉，PG 随之消失，表现为
   `Can't reach database server at localhost:55432`。用 `run_in_background: true`，
   再 `Start-Sleep` 后探端口 55432 确认。
2. **端口 3000 常被上一次会话遗留的 `next start` 占住**，新服务会 `EADDRINUSE` 退出，
   而旧进程可能还在用旧构建。`Get-NetTCPConnection -LocalPort 3000 -State Listen`
   找到 `OwningProcess` 后 `Stop-Process -Force`，再重新起。
3. **`pnpm e2e:plate` 需要先 `pnpm build` 并在跑的服务**。它用 `playwright-core` +
   本机 Edge/Chrome（`channel: "msedge"` 回退到 `chrome`），**不下载浏览器**。
4. **Playwright 的 `getByRole(..., { name })` 是子串匹配**。空态大卡片按钮的文案里含
   「保存工单」，所以保存按钮的定位器必须写 `{ name: "保存工单", exact: true }`。
5. **PowerShell 里不要用 `\` 换行续行**（那是 bash）。`git add a b \` 会报
   `fatal: \: '\' is outside repository at ...`；路径写成一行。
6. **在 TS 模板字符串里嵌 PowerShell 要转义 `$`**：`${env:ProgramFiles(x86)}`、`${变量}`
   会被 JS 当插值。用「行数组 join」拼命令最省事。
7. **只读查生产库**：`node:sqlite` 的 `new DatabaseSync(path, { readOnly: true })`；
   临时脚本写到 `$env:TEMP` 并在同一条命令里删掉，别落进仓库。
8. **`pnpm smoke:sqlite` 会往本地真实 SQLite 库写 SMOKE 数据**（既有行为，不是本次引入）。
   两次 smoke 后车辆数 65 → 67。
9. 改完文件后如需再编辑，注意先 `read` 一次：仓库跑过 `pnpm format` 后文件会变。

## 实测数据基线（2026-09-15，只读扫描）

| 项           | 值                                                         |
| ------------ | ---------------------------------------------------------- |
| SQLite 库    | `%LOCALAPPDATA%\AutoRepairManager\data\autorepair.db`      |
| vehicles     | 67                                                         |
| 未删除工单   | 102                                                        |
| 非归一化车牌 | 1 条：`CAT1789391318098-plate`（详见 ADR-017 的代价/遗留） |

登录用本机默认管理员账号，见 `README.md` 的「默认账号」一节（本文不记录口令）。

## 验证矩阵

跑法与期望值见 **ADR-017 的「验证」段** 与提交 `da858ca` 的信息。交接时的实测结果：
`plate:contract` 40/40、`vehicle:contract` 75/75（含 PG/SQLite 语义快照一致）、
`e2e:plate` 真实浏览器 19/19、`smoke:sqlite` 与 `smoke:postgres` 均 135/135、
其余 12 个既有契约全部通过、typecheck / lint / format:check / build 全绿。

## 关键文件

新增：`src/lib/plate.ts`（纯函数：归一化 / 格式闸门 / 候选排序 / 通配符摘除）、
`src/features/work-orders/components/vehicle-plate-suggest.tsx`（内联候选组件）、
`scripts/plate-suggest-contract.ts`、`scripts/e2e-work-order-plate.ts`。

修改：`create-work-order-form.tsx`（接线 + 保存闸门）、`domain/rows.ts`（候选行扩字段）、
`server/repos/prisma/party.ts` 与 `server/repos/sqlite/vehicle.ts`（同一语义的两种实现）、
`server/services/vehicle.service.ts`、`server/actions/vehicle.actions.ts`、
`lib/validation/work-order.ts`、`scripts/vehicle-repository-contract.ts`、
`package.json`（`plate:contract` / `e2e:plate`）、`docs/DECISIONS.md`（ADR-017）。

## 下一步（按优先级）

1. 等用户真机验证 `http://192.168.2.14:3000` → 反馈手感。有问题走 `diagnosing-bugs`。
2. 用户点头后 `git push`（`main` → `origin/main`）。
3. 可选：push 前先跑 `code-review` 看 `da858ca`。
4. 不要自动进入下一切片 —— 等用户点题。

## 用户偏好

中文回答；先给动作再给证据；**没实测的项不许标 ✅**；一次只做一个切片；
改完倾向 commit；不接受「看起来没问题」这种结论，要命令输出或脚本断言当证据。
