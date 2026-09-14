"use client";

import * as React from "react";

/** 防抖值 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/** 媒体查询（SSR 安全：首次渲染返回 false） */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** 桌面端断点（>= 1024px） */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}

/** 开关状态（常用于 Dialog / Sheet / ConfirmDialog） */
export function useDisclosure(initial = false) {
  const [open, setOpen] = React.useState(initial);
  return {
    open,
    setOpen,
    onOpen: React.useCallback(() => setOpen(true), []),
    onClose: React.useCallback(() => setOpen(false), []),
    onToggle: React.useCallback(() => setOpen((v) => !v), []),
  };
}

/** 挂载标记：避免 SSR / CSR 不一致的弹层渲染 */
export function useMounted() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}
