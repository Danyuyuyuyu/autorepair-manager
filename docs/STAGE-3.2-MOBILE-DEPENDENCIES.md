# Stage 3.2 Mobile 业务依赖图

> 本文冻结 Stage 3.2 的跨端 seam。首个实现切片只覆盖正式 Mobile DB 基座与
> `CustomerRepository`；Vehicle 及后续 Repository 不在本切片实现。

## 依赖图

```text
Mobile React UI
    │ 只调用 Domain / Service interface
    ▼
共享 Domain、Repository Contract、money、纯 validation
    │
    ▼
MobileDatabaseContext
    ├── connection / lifecycle reopen
    ├── versioned migration / bootstrap
    ├── transaction(async repos => ...)
    └── repository factory
            │
            └── Customer Mobile SQLite Adapter（本切片）
                    │
                    ▼
             @capacitor-community/sqlite
                    │
                    ▼
              Android Native SQLite
```

PC 与 Mobile 在 `src/domain/repositories.ts` 的 interface seam 汇合；数据库驱动、连接、
transaction 和 migration implementation 不共享。

## A：可以直接共享

- `src/domain/enums.ts`
- `src/domain/entities.ts`
- `src/domain/rows.ts`
- `src/domain/repositories.ts`
- `src/lib/money.ts`
- `src/lib/plate.ts`
- `src/lib/validation/*` 中不依赖框架的 schema

这些模块的依赖闭包只允许普通浏览器依赖，例如 `decimal.js`、`zod`。现有
`pnpm mobile:deps:verify` 负责拦截 `next/*`、`server-only`、`node:*`、Prisma 和
`@/server/*`。

## B：去掉 server-only 装配后可以共享

- Customer Repository contract 的断言与快照：从 Node runner 中抽到共享 contract
  module，PostgreSQL、PC SQLite、Mobile SQLite 使用同一组 37 项断言。
- 存储错误类型：`NotFoundError`、`UniqueConstraintError`、
  `ForeignKeyConstraintError`、`ConcurrentModificationError` 属于 Repository seam，
  应由共享 Domain 定义；Server Action 的 Zod/ActionResult 包装仍留在 PC。
- `src/server/repos/sqlite/migrations/001_init.sql` 的 DDL 是当前 SQLite schema 契约；Mobile
  只在构建时把它作为 raw SQL 字符串打包，复用结构定义，不加载其目录中的任何 TypeScript
  implementation。这样避免复制一份会漂移的 schema，同时不共享数据库驱动。
- `src/server/services/*` 内的纯业务部分后续按 Repository 顺序抽取；本切片不搬运整个
  Customer server service，因为它仍组合 PC Session、Audit、serializer 和默认 context。

## C：PC 专属

- Next.js 页面、Server Actions、`cookies()` / `headers()` / Session
- `server-only`
- Prisma client 与 PostgreSQL adapter
- `node:sqlite` client、transaction、migration runner、backup/restore
- PC FirstRunBootstrap 和 PC 文件路径策略
- PC serializer / DTO 装配

这些模块不得进入 Mobile bundle，也不得被 Mobile adapter 间接 import。

## D：Mobile 重新实现的 Adapter

- Capacitor SQLite connection 与 PRAGMA
- Mobile versioned migration runner
- Mobile bootstrap marker 与空业务库校验
- 单连接 transaction queue；transaction 回调中的 Repository 共享同一连接
- Mobile repository factory；未迁移槽位 fail-fast
- Customer SQLite query/mapping/error translation
- Android Native contract runner 与机器可判定日志

## 正式数据库与测试数据库

- 正式业务 DB：`autorepair`（Android 文件名由插件落为
  `autorepairSQLite.db`）。
- Stage 3.1 probe DB：`autorepair-mobile-probe`，继续严格隔离。
- Customer contract DB：`autorepair-mobile-customer-contract`，只用于 Android contract，
  验证结束后删除，不把 fixture 写入正式业务 DB。

## 首切片验收边界

1. 正式 DB migration 到 schema version 1，schema 与 PC SQLite `001_init.sql` 等价。
2. Mobile bootstrap 只写完成 marker，不创建 demo Customer/Vehicle/WorkOrder/Payment/Expense。
3. `CustomerRepository` 37 项共享断言在 Android Native SQLite 通过。
4. PostgreSQL / PC SQLite 继续通过原 contract，并与 Mobile 快照一致。
5. contract DB force-stop/reopen 后能读到已提交标记；正式业务 DB 与 probe DB 不受污染。
6. 通过 Mobile 与 PC 门禁后提交；不开始 Vehicle。
