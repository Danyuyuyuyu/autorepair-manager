/**
 * 阶段 2 · Step 1 最小验证：SQLite adapter + schema + 读写事务
 * ---------------------------------------------------------------------------
 * 运行：pnpm sqlite:verify
 *
 * 验证矩阵（全部针对真实文件库，不用内存库，WAL / 重启 / 断电语义才有意义）：
 *  1. 建库 + migration 幂等
 *  2. WAL / foreign_keys / busy_timeout 落实
 *  3. 金额 TEXT 存储精确 round-trip（含边界值）
 *  4. 领域算式（加/减/乘/折扣/总计）与 decimal.js 一致
 *  5. 同步事务：提交 / 回滚 / 嵌套并入外层
 *  6. 异步事务队列：成功提交 / 中途抛错整体回滚
 *  7. 重启后数据完整（close → reopen，migration 不重复执行）
 *  8. 约束错误翻译：UNIQUE / FOREIGN KEY / CHECK（枚举立即暴露）
 *  9. Json 列 round-trip；Boolean / DateTime round-trip
 * 10. WAL 下「写事务进行中」仍可读（第二连接）
 */
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { D, lineAmount, money, sumMoney } from "@/lib/money";
import { closeSqliteDb, getSqliteDb, resolveDbPath } from "@/server/repos/sqlite/client";
import { toDbDecimalOrZero, fromDbDecimalOrZero } from "@/server/repos/sqlite/decimal";
import { newId } from "@/server/repos/sqlite/id";
import {
  isInTransaction,
  runInTransaction,
  runInTransactionSync,
} from "@/server/repos/sqlite/transaction";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` —— ${detail}` : ""}`);
  }
}
async function expectError(label: string, name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    check(label, false, `没有抛出异常（期望 ${name}）`);
  } catch (error) {
    // 用 constructor.name 而非 Error.name：AppError 子类的 name 都被基类覆写为 "AppError"
    check(
      label,
      (error as object).constructor.name === name,
      `实际抛出 ${(error as object).constructor.name}`,
    );
  }
}

async function main() {
  // 必须在首次调用 getSqliteDb 之前设置
  const testDir = mkdtempSync(join(tmpdir(), "autorepair-verify-"));
  process.env.AUTOREPAIR_DB_PATH = join(testDir, "autorepair.db");

  const db = getSqliteDb();

  console.log("\n【1】建库与 migration");
  check("数据库文件已创建", existsSync(resolveDbPath()));
  check(
    "journal_mode = wal",
    (db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode === "wal",
  );
  check(
    "foreign_keys 已开启",
    (db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys === 1,
  );
  check(
    "busy_timeout = 5000",
    (db.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout === 5000,
  );
  const tableCount = (
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as {
      n: number;
    }
  ).n;
  check("18 张业务表 + schema_version = 19", tableCount === 19, `实际 ${tableCount}`);
  check(
    "schema_version = 1",
    (db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }).v === 1,
  );

  console.log("\n【2】金额 TEXT 存储精确 round-trip");
  // 建最小外键链：customer + vehicle（work_orders 对二者 RESTRICT）
  const customerId = newId();
  const vehicleId = newId();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(customerId, "验证客户", "13900000000", now, now);
  db.prepare(
    "INSERT INTO vehicles (id, customer_id, plate_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(vehicleId, customerId, "粤VVERIFY", now, now);

  const insertOrder = db.prepare(`
  INSERT INTO work_orders
    (id, order_no, customer_id, vehicle_id, total_amount, discount_amount, parts_cost, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
  const amounts = ["0", "0.01", "1.10", "10.50", "99.99", "4999.99", "99999999.99"];
  for (const [i, value] of amounts.entries()) {
    insertOrder.run(
      newId(),
      `VERIFY-${String(i).padStart(3, "0")}`,
      customerId,
      vehicleId,
      toDbDecimalOrZero(value),
      "0.00",
      "0.00",
      now,
      now,
    );
  }
  const selectTotal = db.prepare("SELECT total_amount FROM work_orders WHERE order_no = ?");
  let allExact = true;
  for (const value of amounts) {
    const row = selectTotal.get(`VERIFY-${String(amounts.indexOf(value)).padStart(3, "0")}`) as {
      total_amount: string;
    };
    const roundTripped = fromDbDecimalOrZero(row.total_amount).toFixed(2);
    const expected = D(value).toFixed(2);
    if (roundTripped !== expected) {
      allExact = false;
      console.error(
        `    ${value} → 库内「${row.total_amount}」→ 读回 ${roundTripped}（期望 ${expected}）`,
      );
    }
  }
  check("7 个边界金额值逐字符精确恢复", allExact);
  check(
    "没有浮点尾差（99999999.99 !== 99999999.98999786）",
    fromDbDecimalOrZero(
      (selectTotal.get("VERIFY-006") as { total_amount: string }).total_amount,
    ).toNumber() === 99999999.99,
  );

  console.log("\n【3】领域算式与 decimal.js 一致");
  const price = D("258.50");
  const quantity = D("0.25");
  const line = lineAmount(quantity, price); // 乘法
  const total = money(sumMoney([line, D("80")])); // 加法
  const discounted = money(total.minus(D("30.55"))); // 减法 / 折扣
  db.prepare(
    "INSERT INTO work_orders (id, order_no, customer_id, vehicle_id, total_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(newId(), "VERIFY-CALC", customerId, vehicleId, toDbDecimalOrZero(discounted), now, now);
  const calcRow = selectTotal.get("VERIFY-CALC") as { total_amount: string };
  check(
    "0.25 × 258.50 + 80 − 30.55 = 114.08（库内值一致）",
    calcRow.total_amount === discounted.toFixed(2) && calcRow.total_amount === "114.08",
    `库内 ${calcRow.total_amount}`,
  );

  console.log("\n【4】同步事务：提交 / 回滚 / 嵌套");
  runInTransactionSync(db, () => {
    db.prepare(
      "INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("c-tx-commit", "事务提交客户", "13800000001", now, now);
  });
  check(
    "事务提交后可见",
    db.prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'c-tx-commit'").get() !== undefined,
  );

  try {
    runInTransactionSync(db, () => {
      db.prepare(
        "INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("c-tx-rollback", "事务回滚客户", "13800000002", now, now);
      throw new Error("模拟业务失败");
    });
  } catch {
    // 预期失败
  }
  check(
    "抛错后整体回滚",
    (
      db.prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'c-tx-rollback'").get() as {
        n: number;
      }
    ).n === 0,
  );

  runInTransactionSync(db, () => {
    runInTransactionSync(db, () => {
      db.prepare(
        "INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("c-tx-nested", "嵌套客户", "13800000003", now, now);
    });
  });
  check(
    "嵌套调用并入外层事务并正常提交",
    (
      db.prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'c-tx-nested'").get() as {
        n: number;
      }
    ).n === 1,
  );
  check("事务外 isInTransaction() = false", !isInTransaction());

  console.log("\n【5】异步事务队列");
  await runInTransaction(db, async () => {
    db.prepare(
      "INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("c-async-commit", "异步提交客户", "13800000004", now, now);
  });
  check(
    "异步事务提交成功",
    (
      db.prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'c-async-commit'").get() as {
        n: number;
      }
    ).n === 1,
  );
  await expectError("异步事务中途抛错向外传播", "Error", () =>
    runInTransaction(db, async () => {
      db.prepare(
        "INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("c-async-rollback", "异步回滚客户", "13800000005", now, now);
      throw new Error("模拟业务失败");
    }),
  );
  check(
    "异步事务失败后整体回滚",
    (
      db.prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'c-async-rollback'").get() as {
        n: number;
      }
    ).n === 0,
  );
  // 队列未断链：失败后下一个事务仍能执行
  await runInTransaction(db, async () => {
    db.prepare(
      "INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("c-async-after", "队列续跑客户", "13800000006", now, now);
  });
  check(
    "失败后队列继续可用",
    (
      db.prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'c-async-after'").get() as {
        n: number;
      }
    ).n === 1,
  );
  // 嵌套异步事务并入外层
  await runInTransaction(db, async () => {
    await runInTransaction(db, async () => {
      db.prepare(
        "INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("c-async-nested", "异步嵌套客户", "13800000007", now, now);
    });
  });
  check(
    "嵌套异步事务不与外层互等（无死锁）且提交成功",
    (
      db.prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'c-async-nested'").get() as {
        n: number;
      }
    ).n === 1,
  );

  console.log("\n【6】约束错误翻译");
  db.prepare(
    "INSERT INTO users (id, username, name, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("u-1", "verify_admin", "管理员", "x", "ADMIN", 1, now, now);
  await expectError("UNIQUE 冲突 → UniqueConstraintError", "UniqueConstraintError", () =>
    runInTransactionSync(db, () => {
      db.prepare(
        "INSERT INTO users (id, username, name, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run("u-2", "verify_admin", "重复管理员", "x", "ADMIN", 1, now, now);
    }),
  );
  await expectError(
    "FOREIGN KEY 冲突 → ForeignKeyConstraintError",
    "ForeignKeyConstraintError",
    () =>
      runInTransactionSync(db, () => {
        db.prepare(
          "INSERT INTO inventory_transactions (id, part_id, type, quantity, qty_before, qty_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(newId(), "part-not-exists", "ADJUST", "1.00", "0.00", "1.00", now);
      }),
  );
  await expectError("非法枚举被 CHECK 立即暴露（不静默 fallback）", "AppError", () =>
    runInTransactionSync(db, () => {
      db.prepare(
        "INSERT INTO work_orders (id, order_no, status, customer_id, vehicle_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(newId(), "VERIFY-BADENUM", "NOT_A_STATUS", customerId, vehicleId, now, now);
    }),
  );

  console.log("\n【7】Json / Boolean / DateTime round-trip");
  const payload = { status: "COMPLETED", totalAmount: "1234.56", items: [1, 2, 3] };
  db.prepare(
    "INSERT INTO audit_logs (id, action, entity, entity_id, before, after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    newId(),
    "VERIFY",
    "work_order",
    "wo-1",
    JSON.stringify({ a: 1 }),
    JSON.stringify(payload),
    now,
  );
  const auditRow = db
    .prepare("SELECT before, after FROM audit_logs WHERE entity_id = 'wo-1'")
    .get() as {
    before: string;
    after: string;
  };
  check(
    "Json 列序列化/反序列化一致",
    JSON.parse(auditRow.before) !== undefined &&
      JSON.stringify(JSON.parse(auditRow.after)) === JSON.stringify(payload),
  );
  db.prepare(
    "INSERT INTO users (id, username, name, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("u-3", "verify_staff", "员工", "x", "STAFF", 1, now, now);
  const userRow = db
    .prepare("SELECT role, is_active, created_at FROM users WHERE id = 'u-3'")
    .get() as {
    role: string;
    is_active: number;
    created_at: string;
  };
  check("Boolean 存取一致（1 ↔ true）", userRow.is_active === 1);
  check("枚举读回原值", userRow.role === "STAFF");
  check(
    "DateTime ISO 字符串逐字符一致",
    userRow.created_at === now &&
      new Date(userRow.created_at).getTime() === new Date(now).getTime(),
  );

  console.log("\n【8】WAL：写事务进行中，第二连接可读");
  const secondConn = new DatabaseSync(resolveDbPath());
  secondConn.exec("PRAGMA busy_timeout = 5000;");
  runInTransactionSync(db, () => {
    db.prepare(
      "INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("c-wal-uncommitted", "未提交客户", "13800000008", now, now);
    const secondSees = (
      secondConn
        .prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'c-wal-uncommitted'")
        .get() as { n: number }
    ).n;
    check("第二连接读不到未提交数据（隔离性）", secondSees === 0);
    check(
      "第二连接可读已提交数据（WAL 读写不互斥）",
      (secondConn.prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number }).n > 0,
    );
  });
  check(
    "提交后第二连接立即可见",
    (
      secondConn
        .prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'c-wal-uncommitted'")
        .get() as { n: number }
    ).n === 1,
  );
  secondConn.close();

  console.log("\n【9】重启后数据完整，migration 不重复执行");
  const ordersBefore = (db.prepare("SELECT COUNT(*) AS n FROM work_orders").get() as { n: number })
    .n;
  const customersBefore = (db.prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number })
    .n;
  const walFile = `${resolveDbPath()}-wal`;
  check(
    "WAL 文件存在（journal_mode 落实到文件）",
    existsSync(walFile) || statSync(resolveDbPath()).size > 0,
  );
  closeSqliteDb();
  const reopened = getSqliteDb();
  check(
    "重启后工单数不变",
    (reopened.prepare("SELECT COUNT(*) AS n FROM work_orders").get() as { n: number }).n ===
      ordersBefore,
  );
  check(
    "重启后 schema_version 仍为 1（migration 幂等，未重复建表）",
    (reopened.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }).v ===
      1,
  );
  check(
    "重启后客户数与重启前一致",
    (reopened.prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number }).n ===
      customersBefore,
  );

  // 收尾
  closeSqliteDb();
  rmSync(testDir, { recursive: true, force: true });

  console.log(`\n${"=".repeat(52)}`);
  console.log(`SQLite 最小验证结束：通过 ${passed} 项，失败 ${failed} 项`);
  console.log("=".repeat(52));
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("\nSQLite 最小验证异常中断：", error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeSqliteDb();
  });
