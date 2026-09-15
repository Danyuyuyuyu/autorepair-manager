import { ClipboardList, Home, Package, UserCircle, Users } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { useMobileRuntime } from "../mobile/mobile-runtime-provider";

const NAV_ITEMS = [
  { to: "/", label: "首页", icon: Home, end: true },
  { to: "/orders", label: "工单", icon: ClipboardList, end: false },
  { to: "/customers", label: "客户", icon: Users, end: false },
  { to: "/inventory", label: "库存", icon: Package, end: false },
  { to: "/settings", label: "我的", icon: UserCircle, end: false },
] as const;

export function MobileAppShell() {
  const { lifecycleState, keyboardOpen } = useMobileRuntime();

  return (
    <div className="mobile-shell" data-keyboard-open={keyboardOpen || undefined}>
      <header className="app-header">
        <div>
          <p className="app-kicker">AUTOREPAIR · LOCAL</p>
          <h1>汽修管家</h1>
        </div>
        <span className="runtime-pill" aria-label={`应用状态：${lifecycleState}`}>
          <i aria-hidden /> {lifecycleState === "foreground" ? "本机运行" : "后台"}
        </span>
      </header>

      <main className="app-content">
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="主导航">
        <div className="bottom-nav-inner">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className="nav-item">
              <Icon size={22} strokeWidth={1.9} aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <div id="mobile-toast-layer" className="overlay-layer" aria-live="polite" />
      <div id="mobile-sheet-layer" className="overlay-layer" />
      <div id="mobile-dialog-layer" className="overlay-layer" />
    </div>
  );
}
