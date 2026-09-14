/**
 * 过期会话清理 —— 调度与触发点
 * ---------------------------------------------------------------------------
 * Step 4 已经把 `SessionStore.pruneExpired()` 落到 PostgreSQL / SQLite 两套适配器
 * 并纳入 `pnpm session:contract`，但**当时没有任何调用点**：过期行只能靠
 * `findValid()` 在「本人再次带着旧 Cookie 访问」时被逐个删除。
 * 结果是从此不再登录的账号会在 `sessions` 表里长期留下记录，只增不减。
 *
 * 本模块负责「什么时候真的去清理」，不重复实现任何存储语义：
 *
 *   1. 登录成功（`loginAction`）→ `maybePruneExpiredSessions()`
 *      进程内按 `SESSION_PRUNE_INTERVAL_MS` 节流，绝大多数登录不会写库；
 *      清理失败只 warn，绝不让登录失败。
 *   2. 运维 / 定时任务 → `pruneExpiredSessions()`（`pnpm session:prune`）
 *      无条件执行一次，错误向上抛，退出码非 0 便于 cron 报警。
 *
 * 节流状态是**进程内**的，多实例部署时各实例各自计时 —— 这是有意为之：
 * 清理是幂等的 `DELETE ... WHERE expires_at < now`（两边都有 expires_at 索引），
 * 重复执行只是多一次空写，为此引入分布式锁反而增加故障面。
 *
 * 存储实现从 `@/server/context` **惰性**取得，因此本模块可以在没有数据库、
 * 没有 APP_STORAGE 的前提下被契约脚本直接 import 并测试调度语义。
 */
import type { SessionStore } from "@/server/auth/session-store";

/** 自动清理的最小间隔（1 小时）：纯维护动作，没必要每次登录都写一次库 */
export const SESSION_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

type PruneStore = Pick<SessionStore, "pruneExpired">;

export interface SessionPruneSchedulerOptions {
  /** 存储：直接给实例，或给惰性取值函数（应用侧避免 import 即装配存储） */
  store: PruneStore | (() => Promise<PruneStore>);
  /** 自动清理间隔，默认 1 小时 */
  intervalMs?: number;
  /** 时钟注入点（契约脚本用，默认 Date.now） */
  now?: () => number;
  /** 自动清理失败回调；不传则静默吞掉（登录路径不允许被清理失败带崩） */
  onError?: (error: unknown) => void;
}

export interface SessionPruneScheduler {
  /** 到期才清理：未到期返回 null；失败经 onError 上报后返回 null，不抛错 */
  maybePrune(): Promise<number | null>;
  /** 立即清理一次：不受节流影响，失败向上抛（运维脚本要真实退出码） */
  pruneNow(): Promise<number>;
}

export function createSessionPruneScheduler(
  options: SessionPruneSchedulerOptions,
): SessionPruneScheduler {
  const intervalMs = options.intervalMs ?? SESSION_PRUNE_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let lastRunAt: number | null = null;

  async function resolveStore(): Promise<PruneStore> {
    return typeof options.store === "function" ? await options.store() : options.store;
  }

  return {
    async maybePrune() {
      const startedAt = now();
      if (lastRunAt !== null && startedAt - lastRunAt < intervalMs) return null;

      // 先记时间再 await：并发登录同时到期时只会有一次真正落库
      lastRunAt = startedAt;
      try {
        return await (await resolveStore()).pruneExpired(new Date(startedAt));
      } catch (error) {
        // 清理是尽力而为的维护动作，失败不能影响调用方（登录 / 页面渲染）
        options.onError?.(error);
        return null;
      }
    },

    async pruneNow() {
      return (await resolveStore()).pruneExpired(new Date(now()));
    },
  };
}

/** 应用级调度器：存储随 APP_STORAGE 走 context 装配（PG / SQLite 同一入口） */
const scheduler = createSessionPruneScheduler({
  store: async () => (await import("@/server/context")).sessionStore,
  onError: (error) => {
    console.warn("[auth] 过期会话清理失败（已忽略，不影响本次请求）：", error);
  },
});

/** 请求路径（登录成功）调用：节流 + 失败静默 */
export function maybePruneExpiredSessions(): Promise<number | null> {
  return scheduler.maybePrune();
}

/** 运维脚本调用：立即清理一次，错误向上抛 */
export function pruneExpiredSessions(): Promise<number> {
  return scheduler.pruneNow();
}
