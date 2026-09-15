# Stage 3.2 / Customer Mobile Repository 交接

日期：2026-09-15

## 当前结论

Stage 3.2 仍在进行中；第一个 Repository 切片 `Customer` 已完成数据层与 Android Native contract。尚未接 Customer 正式 UI，尚未开始 Vehicle adapter。

## 本切片范围

- 增加正式 Mobile 数据库 `autorepair`，Android 实际文件名 `autorepairSQLite.db`。
- Probe 库仍为 `autorepair-mobile-probe`；Customer contract 库为 `autorepair-mobile-customer-contract`，运行后删除。
- Mobile schema version = 1；构建时复用 `001_init.sql` 的 DDL 字符串，但 migration runner、连接、事务和 Repository adapter 均为 Capacitor 原生实现。
- 首次 bootstrap 只写 `app_settings` marker，不生成 demo 业务数据。
- `MobileDatabaseContext` 统一管理 open、PRAGMA、migration、bootstrap、Repository factory、串行 transaction、close/reopen 和前台恢复。
- 当前工厂只暴露 `Pick<Repositories, "customer">`，没有用占位实现伪装其他 Repository 已完成。
- `CustomerRepository` 的 37 项共享 contract 被抽到无 Node/driver 依赖的领域 contract，PG、PC SQLite、Android Native SQLite 共用相同断言。

依赖边界和 A/B/C/D 分类见 `docs/STAGE-3.2-MOBILE-DEPENDENCIES.md`。

## 原生证据

设备：`emulator-5554`，Android API 36 模拟器。

- `pnpm mobile:customer:contract`
  - Android Native Customer：37/37
  - schema：version 1，19 tables，48 explicit indexes，foreign keys on，foreign key violations 0
  - bootstrap counts：Customer/Vehicle/WorkOrder/Payment/Expense 均为 0
  - business transaction：commit true，rollback true
  - migration fault injection：rollback true，未留下半迁移表
  - close/reopen persistence：true
  - force-stop/reopen persistence：true
  - PC SQLite / Android Native SQLite snapshot：完全一致
  - contract DB：执行后删除；正式 DB 与 probe DB 隔离
- `pnpm customer:contract`
  - PostgreSQL / PC SQLite：78 项，失败 0；语义快照完全一致
- 因此 Customer 三轴使用同一 37 项行为断言并得到同一归一化快照。

正式 DB 实测文件：`/data/user/0/com.autorepair.manager/databases/autorepairSQLite.db`，本轮大小 393216 bytes。

## 回归证据

- Mobile typecheck：通过
- Mobile lint：通过
- `pnpm mobile:deps:verify`：shared closure 11 files；forbidden imports 0
- `pnpm mobile:doctor`：CODE + NATIVE TOOLCHAIN READY
- `pnpm mobile:android:build`：BUILD SUCCESSFUL；普通产物不含可执行 Customer contract instrumentation
- `pnpm mobile:sqlite:verify`：source 18/18；Android Native 18/18；force-stop persistence true
- `pnpm mobile:shell:verify`：13/13
- PC typecheck / lint / format:check：通过
- PC build：第一次 webpack WasmHash 内部异常；未改代码立即复跑成功，暂未复现
- `pnpm smoke:postgres`：135/135
- `pnpm smoke:sqlite`：135/135
- PostgreSQL / PC SQLite Repository contracts：Vehicle 75、Catalog 29、Part 37、Inventory 27、WorkOrder 37、Finance 31、User 33、Audit 17，全部通过
- `pnpm plate:contract`：40/40
- 普通 APK：`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`，14744537 bytes
- 普通 App 进程 logcat：fatal 0，plugin error 0；正式库 READY / version 1 / already-ready / 业务初始计数全 0

## 诊断中确认并修复的真实问题

1. 多个 `SQLiteConnection` wrapper 各自执行 consistency check，会把另一个 wrapper 的原生连接当成孤儿移除。现在所有正式库、probe 和 contract 共用一个进程级 connection manager，并先完成正式库初始化再运行 probe。
2. Android SQLCipher 驱动拒绝通过 `execute()` 执行 PRAGMA；现在按驱动要求逐条使用 `query()`。
3. Vite 生产压缩会改写 class constructor name；跨 runtime contract 改用稳定领域错误码 `NOT_FOUND`。
4. Node 与 Android WebView 的默认 locale 不同；contract snapshot 的归一化排序改成确定性的 Unicode 码点顺序。

## 下一切片

等待用户点题后再开始 Vehicle Mobile Repository。不要提前实现 Catalog、Inventory、WorkOrder、Finance、Audit 或任何同步能力。

Stage 3.2 最终验收里的真机完整业务链、重复点击、整机重启和全实体直接读库核对仍未执行；这些不能标记完成。
