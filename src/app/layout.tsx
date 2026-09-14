import type { Metadata, Viewport } from "next";

import "./globals.css";

import { APP_NAME, APP_SHORT_NAME } from "@/lib/env";
import { Toaster } from "@/components/ui/toaster";
import { ServiceWorkerRegister } from "@/components/layout/service-worker-register";

export const metadata: Metadata = {
  title: {
    default: `${APP_SHORT_NAME} · ${APP_NAME}`,
    template: `%s · ${APP_SHORT_NAME}`,
  },
  description: "汽车维修店记账管理系统 —— 工单、客户车辆、配件库存、收款与财务统计",
  applicationName: APP_SHORT_NAME,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: APP_SHORT_NAME,
    statusBarStyle: "default",
  },
  formatDetection: { telephone: true, date: false, address: false, email: false },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
