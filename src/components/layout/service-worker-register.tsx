"use client";

import * as React from "react";

/**
 * 注册 PWA Service Worker。
 * 仅在 https / localhost 下生效（浏览器限制）。
 */
export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch (error) {
        console.warn("[pwa] Service Worker 注册失败", error);
      }
    };

    void register();
  }, []);

  return null;
}
