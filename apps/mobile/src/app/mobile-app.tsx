import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { MobileAppShell } from "./mobile-app-shell";
import { CustomersPage, HomePage, InventoryPage, OrdersPage, SettingsPage } from "./pages";
import { MobileDatabaseProvider } from "../data/mobile-database-provider";
import { MobileRuntimeProvider } from "../mobile/mobile-runtime-provider";

export function MobileApp() {
  return (
    <HashRouter>
      <MobileRuntimeProvider>
        <MobileDatabaseProvider>
          <Routes>
            <Route element={<MobileAppShell />}>
              <Route index element={<HomePage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </MobileDatabaseProvider>
      </MobileRuntimeProvider>
    </HashRouter>
  );
}
