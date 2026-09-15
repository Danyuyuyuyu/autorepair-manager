import { CarFront, ClipboardCheck, Database, PackageSearch, UserRoundSearch } from "lucide-react";
import React from "react";
import { createPortal } from "react-dom";

import { useMobileRuntime } from "../mobile/mobile-runtime-provider";
import { SqliteProbePanel } from "../native/sqlite-probe-panel";

function PlaceholderPage({
  eyebrow,
  title,
  description,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof CarFront;
}) {
  return (
    <section className="page-stack">
      <div className="page-title">
        <span className="page-icon">
          <Icon size={23} aria-hidden />
        </span>
        <div>
          <p>{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="placeholder-card">
        <span>Stage 3.1</span>
        <h3>移动运行壳已就位</h3>
        <p>{description}</p>
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <section className="page-stack">
      <div className="welcome-copy">
        <p>今天的工位</p>
        <h2>先让移动端站稳，业务随后进场。</h2>
      </div>
      <div className="bay-track" aria-label="移动端建设进度">
        <div className="bay-track-line" />
        <article className="bay is-ready">
          <span>01</span>
          <strong>运行壳</strong>
          <small>本地资源</small>
        </article>
        <article className="bay is-ready">
          <span>02</span>
          <strong>原生桥</strong>
          <small>SQLite 探针</small>
        </article>
        <article className="bay">
          <span>03</span>
          <strong>业务仓储</strong>
          <small>Stage 3.2</small>
        </article>
      </div>
      <div className="offline-note">
        <CarFront size={22} aria-hidden />
        <div>
          <strong>无需连接电脑或云端</strong>
          <p>此壳只加载安装包内的静态资源。</p>
        </div>
      </div>
    </section>
  );
}

export function OrdersPage() {
  return (
    <PlaceholderPage
      eyebrow="WORK ORDERS"
      title="工单"
      description="正式工单数据与操作留到 Stage 3.2。"
      icon={ClipboardCheck}
    />
  );
}

export function CustomersPage() {
  return (
    <PlaceholderPage
      eyebrow="CUSTOMERS"
      title="客户"
      description="客户、车辆仓储尚未接入本机数据库。"
      icon={UserRoundSearch}
    />
  );
}

export function InventoryPage() {
  return (
    <PlaceholderPage
      eyebrow="INVENTORY"
      title="库存"
      description="库存规则保持冻结，本阶段只验证移动运行环境。"
      icon={PackageSearch}
    />
  );
}

export function SettingsPage() {
  return (
    <section className="page-stack">
      <div className="page-title">
        <span className="page-icon">
          <Database size={23} aria-hidden />
        </span>
        <div>
          <p>RUNTIME</p>
          <h2>我的</h2>
        </div>
      </div>
      <SqliteProbePanel />
      <label className="keyboard-check">
        <span>键盘避让检查</span>
        <input placeholder="点此唤起软键盘" inputMode="text" />
      </label>
      <NativeInteractionDiagnostics />
    </section>
  );
}

function NativeInteractionDiagnostics() {
  const { registerOverlayCloser } = useMobileRuntime();
  const [overlay, setOverlay] = React.useState<"sheet" | "dialog" | null>(null);

  React.useEffect(() => {
    if (!overlay) return;
    return registerOverlayCloser(() => setOverlay(null));
  }, [overlay, registerOverlayCloser]);

  const targetId = overlay === "sheet" ? "mobile-sheet-layer" : "mobile-dialog-layer";
  const target = overlay ? document.getElementById(targetId) : null;

  return (
    <>
      <section className="native-interaction-check" aria-label="原生交互诊断">
        <div>
          <span>NATIVE INTERACTION</span>
          <strong>Android Back 覆盖层检查</strong>
        </div>
        <div className="native-interaction-actions">
          <button type="button" onClick={() => setOverlay("sheet")}>
            打开诊断 Sheet
          </button>
          <button type="button" onClick={() => setOverlay("dialog")}>
            打开诊断 Dialog
          </button>
        </div>
      </section>
      {target &&
        createPortal(
          <div className={`diagnostic-overlay is-${overlay}`} data-diagnostic-overlay={overlay}>
            <div className="diagnostic-backdrop" aria-hidden />
            <section role="dialog" aria-modal="true" aria-label={`诊断 ${overlay}`}>
              <span>STAGE 3.1-N</span>
              <strong>{overlay === "sheet" ? "诊断 Sheet 已打开" : "诊断 Dialog 已打开"}</strong>
              <p>按 Android Back 应只关闭此覆盖层。</p>
              <button type="button" onClick={() => setOverlay(null)}>
                关闭
              </button>
            </section>
          </div>,
          target,
        )}
    </>
  );
}
