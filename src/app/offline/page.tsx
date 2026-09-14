import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "网络连接异常" };

/** PWA 离线兜底页（Service Worker 在网络不可用时返回） */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="bg-warning-soft text-warning-strong grid size-16 place-items-center rounded-2xl">
        <WifiOff className="size-8" />
      </span>
      <div className="space-y-1">
        <h1 className="text-foreground text-lg font-semibold">网络连接异常</h1>
        <p className="text-muted-foreground text-sm">
          请检查手机网络或 Wi-Fi 是否正常，恢复后重新打开即可继续使用。
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">重新进入</Link>
      </Button>
      <p className="text-subtle-foreground text-xs">
        为保证账目准确，本系统不会在离线状态下写入数据。
      </p>
    </div>
  );
}
