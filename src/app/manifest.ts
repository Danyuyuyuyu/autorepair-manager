import type { MetadataRoute } from "next";

import { APP_NAME, APP_SHORT_NAME } from "@/lib/env";

/**
 * PWA Manifest
 * 手机浏览器「添加到主屏幕」后以 standalone 模式运行。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: "汽车维修店记账管理系统 —— 工单、客户车辆、配件库存、收款与财务统计",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f5f7",
    theme_color: "#2563eb",
    lang: "zh-CN",
    dir: "ltr",
    categories: ["business", "productivity", "finance"],
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "新建维修工单",
        short_name: "新建工单",
        url: "/work-orders/new",
        description: "快速创建一张维修工单",
      },
      {
        name: "收一笔款",
        short_name: "收款",
        url: "/work-orders?status=UNPAID",
        description: "查看待收款工单",
      },
      {
        name: "配件入库",
        short_name: "入库",
        url: "/inventory?action=purchase",
        description: "采购入库登记",
      },
    ],
  };
}
