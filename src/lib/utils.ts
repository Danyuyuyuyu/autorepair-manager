import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind 类名合并工具 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 生成稳定 key */
export function keyOf(...parts: (string | number | null | undefined)[]) {
  return parts.filter(Boolean).join("-");
}

/** 等待（用于调试） */
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 数组按 key 分组 */
export function groupBy<T, K extends string | number>(list: T[], getKey: (item: T) => K) {
  return list.reduce<Record<K, T[]>>(
    (acc, item) => {
      const k = getKey(item);
      (acc[k] ||= []).push(item);
      return acc;
    },
    {} as Record<K, T[]>,
  );
}
