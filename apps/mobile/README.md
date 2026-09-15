# 汽修管家 Mobile Runtime

`apps/mobile` 是独立的 React + Vite + Capacitor 静态客户端。它不启动 Next.js、不配置
`server.url`，也不连接 PC 或云端；Android 包只加载 `dist` 中的本地资源。

## 常用命令

从仓库根目录运行：

```powershell
pnpm mobile:dev
pnpm mobile:build
pnpm mobile:sync
pnpm mobile:doctor
pnpm mobile:android:build
pnpm mobile:sqlite:verify
pnpm mobile:deps:verify
pnpm mobile:shell:verify
```

`mobile:sqlite:verify` 先检查 18 项探针源码契约；只有存在 adb、在线设备和已构建 APK 时，
才会安装应用并等待原生探针日志。源码 18/18 不能替代 Native SQLite 运行结果。

## 运行时边界

- 浏览器开发只显示 `Native SQLite unavailable in browser development mode`，没有 Web 存储 fallback。
- Android 启动时运行 `autorepair-mobile-probe`，验证参数绑定、事务、close/reopen、中文、ISO 时间和
  Decimal TEXT round-trip；“我的”页可重跑或清理 probe DB。
- PC `node:sqlite` 代码不进入 Mobile bundle。未来的 Mobile Repository Adapter 属于 Stage 3.2。
- `com.autorepair.manager` 是当前开发 applicationId；正式发布前可按 ADR-019 整体确认一次。
