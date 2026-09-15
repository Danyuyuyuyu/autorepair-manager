import { Capacitor } from "@capacitor/core";

export function isNativeMobile(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function mobilePlatformLabel(): "android" | "browser" {
  return isNativeMobile() ? "android" : "browser";
}
