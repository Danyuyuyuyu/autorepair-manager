-- =============================================================================
-- 001_init.sql —— 从 prisma/schema.prisma 机械派生，不重新设计
-- -----------------------------------------------------------------------------
-- 派生规则（与 ADR-014 一致，主键 / 外键 / nullable / 默认值 / 唯一约束逐列对照）：
-- 1. 主键 TEXT（保留原 ID，导入时不得重新生成）
-- 2. Decimal(14,2) / Decimal(12,2) / Decimal(6,2) → TEXT，存规范十进制字符串
--    （"1234.56"）。不用 REAL/NUMERIC：浮点无法保证十进制精确 round-trip。
--    排序需要时用 CAST(col AS REAL)，比较一律在领域层用 decimal.js。
-- 3. 枚举 → TEXT + CHECK IN (...)：错误枚举值在写入时立即暴露，禁止静默 fallback
-- 4. DateTime → TEXT（ISO 8601 UTC，含毫秒），字典序 = 时间序
-- 5. Boolean → INTEGER（0/1）
-- 6. Json → TEXT（JSON 字符串，序列化/反序列化在仓储层完成）
-- 7. 外键动作与 Prisma 一致：Cascade / SetNull / Restrict
-- 8. updated_at 由适配层在每次写入时设置（Prisma @updatedAt 语义），无数据库默认值
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 账号 / 会话 / 员工
-- -----------------------------------------------------------------------------

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'STAFF' CHECK (role IN ('ADMIN', 'STAFF')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_deleted_at ON users (deleted_at);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE employees (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT,
  position     TEXT,
  is_technician INTEGER NOT NULL DEFAULT 1,
  user_id      TEXT UNIQUE REFERENCES users (id) ON DELETE SET NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  remark       TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX idx_employees_name ON employees (name);
CREATE INDEX idx_employees_is_active ON employees (is_active);

-- -----------------------------------------------------------------------------
-- 客户 / 车辆
-- -----------------------------------------------------------------------------

CREATE TABLE customers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  wechat     TEXT,
  address    TEXT,
  remark     TEXT,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_customers_phone ON customers (phone);
CREATE INDEX idx_customers_name ON customers (name);
CREATE INDEX idx_customers_created_at ON customers (created_at);

CREATE TABLE vehicles (
  id              TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  plate_number    TEXT NOT NULL,
  brand           TEXT,
  model           TEXT,
  year            INTEGER,
  vin             TEXT,
  engine_no       TEXT,
  current_mileage INTEGER,
  last_service_at TEXT,
  next_service_at TEXT,
  remark          TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE INDEX idx_vehicles_plate_number ON vehicles (plate_number);
CREATE INDEX idx_vehicles_vin ON vehicles (vin);
CREATE INDEX idx_vehicles_customer_id ON vehicles (customer_id);
CREATE INDEX idx_vehicles_next_service_at ON vehicles (next_service_at);

-- -----------------------------------------------------------------------------
-- 维修工单
-- -----------------------------------------------------------------------------

CREATE TABLE work_orders (
  id               TEXT PRIMARY KEY,
  order_no         TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'PENDING_INTAKE'
    CHECK (status IN ('PENDING_INTAKE', 'IN_PROGRESS', 'PENDING_QC', 'PENDING_PAYMENT', 'COMPLETED', 'CANCELLED')),
  customer_id      TEXT NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  vehicle_id       TEXT NOT NULL REFERENCES vehicles (id) ON DELETE RESTRICT,
  mileage          INTEGER,
  fault_description TEXT,
  remark           TEXT,
  technician_id    TEXT REFERENCES employees (id) ON DELETE SET NULL,
  created_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  service_amount   TEXT NOT NULL DEFAULT '0.00',
  parts_amount     TEXT NOT NULL DEFAULT '0.00',
  labor_amount     TEXT NOT NULL DEFAULT '0.00',
  other_amount     TEXT NOT NULL DEFAULT '0.00',
  discount_amount  TEXT NOT NULL DEFAULT '0.00',
  total_amount     TEXT NOT NULL DEFAULT '0.00',
  paid_amount      TEXT NOT NULL DEFAULT '0.00',
  parts_cost       TEXT NOT NULL DEFAULT '0.00',
  completed_at     TEXT,
  cancelled_at     TEXT,
  cancel_reason    TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);
CREATE INDEX idx_work_orders_status ON work_orders (status);
CREATE INDEX idx_work_orders_created_at ON work_orders (created_at);
CREATE INDEX idx_work_orders_customer_id ON work_orders (customer_id);
CREATE INDEX idx_work_orders_vehicle_id ON work_orders (vehicle_id);
CREATE INDEX idx_work_orders_technician_id ON work_orders (technician_id);
CREATE INDEX idx_work_orders_completed_at ON work_orders (completed_at);

CREATE TABLE work_order_items (
  id           TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders (id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('SERVICE', 'PART', 'LABOR', 'OTHER')),
  item_ref_id  TEXT,
  name         TEXT NOT NULL,
  spec         TEXT,
  unit         TEXT,
  quantity     TEXT NOT NULL DEFAULT '1.00',
  unit_price   TEXT NOT NULL DEFAULT '0.00',
  cost_price   TEXT NOT NULL DEFAULT '0.00',
  amount       TEXT NOT NULL DEFAULT '0.00',
  remark       TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_work_order_items_work_order_id ON work_order_items (work_order_id);
CREATE INDEX idx_work_order_items_type ON work_order_items (type);
CREATE INDEX idx_work_order_items_item_ref_id ON work_order_items (item_ref_id);

-- -----------------------------------------------------------------------------
-- 收款 / 支出
-- -----------------------------------------------------------------------------

CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  work_order_id TEXT REFERENCES work_orders (id) ON DELETE RESTRICT,
  customer_id  TEXT REFERENCES customers (id) ON DELETE SET NULL,
  source       TEXT NOT NULL DEFAULT 'WORK_ORDER' CHECK (source IN ('WORK_ORDER', 'MANUAL')),
  category     TEXT NOT NULL DEFAULT 'REPAIR_SERVICE'
    CHECK (category IN ('REPAIR_SERVICE', 'PART_SALE', 'LABOR', 'OTHER')),
  amount       TEXT NOT NULL,
  method       TEXT NOT NULL DEFAULT 'CASH'
    CHECK (method IN ('CASH', 'WECHAT', 'ALIPAY', 'BANK_CARD', 'OTHER')),
  occurred_at  TEXT NOT NULL,
  operator_id  TEXT REFERENCES users (id) ON DELETE SET NULL,
  remark       TEXT,
  created_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX idx_payments_work_order_id ON payments (work_order_id);
CREATE INDEX idx_payments_occurred_at ON payments (occurred_at);
CREATE INDEX idx_payments_customer_id ON payments (customer_id);
CREATE INDEX idx_payments_deleted_at ON payments (deleted_at);

CREATE TABLE expenses (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL
    CHECK (category IN ('PART_PURCHASE', 'RENT', 'UTILITY', 'SALARY', 'TOOL_EQUIPMENT', 'LOGISTICS', 'OTHER')),
  amount      TEXT NOT NULL,
  method      TEXT NOT NULL DEFAULT 'CASH'
    CHECK (method IN ('CASH', 'WECHAT', 'ALIPAY', 'BANK_CARD', 'OTHER')),
  occurred_at TEXT NOT NULL,
  supplier_id TEXT REFERENCES suppliers (id) ON DELETE SET NULL,
  work_order_id TEXT REFERENCES work_orders (id) ON DELETE SET NULL,
  operator_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  remark      TEXT,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX idx_expenses_occurred_at ON expenses (occurred_at);
CREATE INDEX idx_expenses_category ON expenses (category);
CREATE INDEX idx_expenses_deleted_at ON expenses (deleted_at);

-- -----------------------------------------------------------------------------
-- 配件 / 库存
-- -----------------------------------------------------------------------------

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('PART', 'SERVICE', 'EXPENSE', 'INCOME')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, name)
);
CREATE INDEX idx_categories_kind ON categories (kind);

CREATE TABLE parts (
  id          TEXT PRIMARY KEY,
  code        TEXT,
  name        TEXT NOT NULL,
  spec        TEXT,
  brand       TEXT,
  unit        TEXT NOT NULL DEFAULT '个',
  category_id TEXT REFERENCES categories (id) ON DELETE SET NULL,
  supplier_id TEXT REFERENCES suppliers (id) ON DELETE SET NULL,
  cost_price  TEXT NOT NULL DEFAULT '0.00',
  sale_price  TEXT NOT NULL DEFAULT '0.00',
  is_active   INTEGER NOT NULL DEFAULT 1,
  remark      TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX idx_parts_name ON parts (name);
CREATE INDEX idx_parts_code ON parts (code);
CREATE INDEX idx_parts_category_id ON parts (category_id);
CREATE INDEX idx_parts_is_active ON parts (is_active);

CREATE TABLE inventories (
  id            TEXT PRIMARY KEY,
  part_id       TEXT NOT NULL UNIQUE REFERENCES parts (id) ON DELETE CASCADE,
  quantity      TEXT NOT NULL DEFAULT '0.00',
  safe_quantity TEXT NOT NULL DEFAULT '0.00',
  avg_cost      TEXT NOT NULL DEFAULT '0.00',
  location      TEXT,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_inventories_quantity ON inventories (quantity);

CREATE TABLE inventory_transactions (
  id           TEXT PRIMARY KEY,
  part_id      TEXT NOT NULL REFERENCES parts (id) ON DELETE RESTRICT,
  type         TEXT NOT NULL
    CHECK (type IN ('PURCHASE_IN', 'WORKORDER_OUT', 'RETURN_IN', 'ADJUST', 'STOCKTAKE')),
  quantity     TEXT NOT NULL,
  qty_before   TEXT NOT NULL,
  qty_after    TEXT NOT NULL,
  unit_cost    TEXT,
  amount       TEXT,
  work_order_id TEXT REFERENCES work_orders (id) ON DELETE SET NULL,
  operator_id  TEXT REFERENCES users (id) ON DELETE SET NULL,
  remark       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_inventory_transactions_part_id_created_at ON inventory_transactions (part_id, created_at);
CREATE INDEX idx_inventory_transactions_work_order_id ON inventory_transactions (work_order_id);
CREATE INDEX idx_inventory_transactions_type ON inventory_transactions (type);

CREATE TABLE suppliers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  contact    TEXT,
  phone      TEXT,
  address    TEXT,
  remark     TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_suppliers_name ON suppliers (name);

-- -----------------------------------------------------------------------------
-- 维修项目目录
-- -----------------------------------------------------------------------------

CREATE TABLE service_items (
  id            TEXT PRIMARY KEY,
  code          TEXT,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'SERVICE' CHECK (kind IN ('SERVICE', 'PART', 'LABOR', 'OTHER')),
  category_id   TEXT REFERENCES categories (id) ON DELETE SET NULL,
  unit          TEXT NOT NULL DEFAULT '项',
  default_price TEXT NOT NULL DEFAULT '0.00',
  default_hours TEXT,
  cost_price    TEXT NOT NULL DEFAULT '0.00',
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  remark        TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_service_items_name ON service_items (name);
CREATE INDEX idx_service_items_kind ON service_items (kind);
CREATE INDEX idx_service_items_is_active ON service_items (is_active);

-- -----------------------------------------------------------------------------
-- 审计日志 / 系统设置
-- -----------------------------------------------------------------------------

CREATE TABLE vehicle_service_records (
  id                  TEXT PRIMARY KEY,
  vehicle_id          TEXT NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
  work_order_id       TEXT REFERENCES work_orders (id) ON DELETE SET NULL,
  serviced_at         TEXT NOT NULL,
  mileage             INTEGER,
  description         TEXT NOT NULL,
  next_service_at     TEXT,
  next_service_mileage INTEGER,
  created_by          TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_vsr_vehicle_id_serviced_at ON vehicle_service_records (vehicle_id, serviced_at);
CREATE INDEX idx_vsr_work_order_id ON vehicle_service_records (work_order_id);

CREATE TABLE audit_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  user_name  TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  summary    TEXT,
  before     TEXT,
  after      TEXT,
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_logs_entity_entity_id ON audit_logs (entity, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at);
CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
