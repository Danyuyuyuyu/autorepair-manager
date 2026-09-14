"use client";

import * as React from "react";
import { Share2, Smartphone, X } from "lucide-react";

/**
 * PWA 安装引导。
 * 只在浏览器支持「安装」且尚未安装时显示，避免打扰已安装用户。
 */
export function PwaHint() {
  const [visible, setVisible] = React.useState(false);
  const [isIOS, setIsIOS] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (standalone) return;

    const ua = window.navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua));
    setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div className="rounded-card border-info-border bg-info-soft border p-4">
      <div className="flex items-start gap-3">
        <span className="bg-card text-info-strong grid size-9 shrink-0 place-items-center rounded-lg">
          <Smartphone className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-info-strong text-sm font-semibold">添加到手机桌面</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {isIOS ? (
              <>
                点击浏览器底部「分享」按钮 <Share2 className="inline size-3.5" />
                ，选择「添加到主屏幕」， 即可像 App 一样全屏使用。
              </>
            ) : (
              <>点击浏览器菜单中的「安装应用 / 添加到主屏幕」，即可像 App 一样全屏使用。</>
            )}
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭提示"
          onClick={() => setVisible(false)}
          className="text-muted-foreground hover:bg-card grid size-8 shrink-0 place-items-center rounded-lg transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
