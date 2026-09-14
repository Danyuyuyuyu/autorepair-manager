import type { DatabaseSync } from "node:sqlite";
import { translateSqliteError } from "./errors";

/**
 * SQLite 事务
 * ---------------------------------------------------------------------------
 * PostgreSQL 的 `SELECT ... FOR UPDATE` 行锁在 SQLite 里不存在，也不需要：
 * SQLite 写事务本身就是库级排他锁。本模块用 `BEGIN IMMEDIATE` 实现 ——
 * 事务一开始就取写锁，事务内的「读-算-写」对其他写者完全原子，
 * 不会出现负库存或重复扣减（原 FOR UPDATE 的全部语义由它承担）。
 *
 * 两层 API：
 * 1. `runInTransactionSync(fn)` —— 同步核心。node:sqlite 是同步驱动，
 *    仓储实现内部全走它。支持嵌套调用（内层并入外层事务，不产生 SAVEPOINT）。
 * 2. `runInTransaction(fn)` —— 异步队列版。与业务层的
 *    `transaction((repos) => Promise<T>)` 签名对齐：事务串行排队，
 *    任何一步失败整体回滚。
 *
 * 并发模型说明：单连接 + 事务串行队列。单用户 PC 场景下写入并发极低，
 * 排队足以保证正确性；`busy_timeout` 兜底外部进程（如手工开 sqlite3 CLI）
 * 短暂持锁的情况。
 */

/** 同步核心：嵌套调用并入外层事务 */
let txDepth = 0;

export function runInTransactionSync<T>(db: DatabaseSync, fn: () => T): T {
  if (txDepth > 0) {
    // 已在事务中：直接执行，由最外层统一 COMMIT / ROLLBACK
    return fn();
  }

  db.exec("BEGIN IMMEDIATE");
  txDepth += 1;
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // 事务可能已因错误自动回滚
    }
    throw translateSqliteError(error);
  } finally {
    txDepth -= 1;
  }
}

/** 异步事务队列：保证同一时刻最多一个事务在打开状态 */
let queue: Promise<unknown> = Promise.resolve();

export function runInTransaction<T>(db: DatabaseSync, fn: () => Promise<T>): Promise<T> {
  // 嵌套调用：并入外层事务（与同步核心语义一致），否则外层等内层、内层等队列 = 死锁
  if (isInTransaction()) {
    return fn();
  }

  const run = queue.then(
    () =>
      new Promise<T>((resolve, reject) => {
        try {
          db.exec("BEGIN IMMEDIATE");
        } catch (error) {
          reject(translateSqliteError(error));
          return;
        }
        txDepth += 1;
        fn().then(
          (result) => {
            try {
              db.exec("COMMIT");
              resolve(result);
            } catch (error) {
              reject(translateSqliteError(error));
            } finally {
              txDepth -= 1;
            }
          },
          (error) => {
            try {
              db.exec("ROLLBACK");
            } catch {
              // 事务可能已因错误自动回滚
            }
            txDepth -= 1;
            reject(translateSqliteError(error));
          },
        );
      }),
  );

  // 失败不能断链：把结果吞进队列，只透传给调用方
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 当前是否处于打开的事务中（测试与断言用） */
export function isInTransaction(): boolean {
  return txDepth > 0;
}
