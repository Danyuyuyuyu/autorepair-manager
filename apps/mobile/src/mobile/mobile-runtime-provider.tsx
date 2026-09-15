import { App } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { isNativeMobile } from "./runtime";
import { mobileDatabase } from "../data/mobile-database-context";
import { runNativeSqliteProbeOnce } from "../native/sqlite-probe";

type LifecycleState = "foreground" | "background";
type RuntimeContextValue = {
  lifecycleState: LifecycleState;
  keyboardOpen: boolean;
  registerOverlayCloser: (close: () => void) => () => void;
};

const RuntimeContext = React.createContext<RuntimeContextValue | null>(null);

export function MobileRuntimeProvider({ children }: React.PropsWithChildren) {
  const navigate = useNavigate();
  const location = useLocation();
  const [lifecycleState, setLifecycleState] = React.useState<LifecycleState>("foreground");
  const [keyboardOpen, setKeyboardOpen] = React.useState(false);
  const [runtimeError, setRuntimeError] = React.useState<Error | null>(null);
  const overlayClosers = React.useRef<Array<() => void>>([]);
  const locationRef = React.useRef(location.pathname);

  React.useEffect(() => {
    locationRef.current = location.pathname;
  }, [location.pathname]);

  React.useEffect(() => {
    if (!isNativeMobile()) return;

    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const initialize = async () => {
      await StatusBar.setStyle({ style: Style.Light });

      handles.push(
        await Keyboard.addListener("keyboardWillShow", (info) => {
          console.info(`[mobile:keyboard] show height=${info.keyboardHeight}`);
          document.documentElement.style.setProperty(
            "--keyboard-height",
            `${info.keyboardHeight}px`,
          );
          setKeyboardOpen(true);
        }),
        await Keyboard.addListener("keyboardWillHide", () => {
          console.info("[mobile:keyboard] hide");
          document.documentElement.style.setProperty("--keyboard-height", "0px");
          setKeyboardOpen(false);
        }),
        await App.addListener("appStateChange", ({ isActive }) => {
          const state = isActive ? "foreground" : "background";
          console.info(`[mobile:lifecycle] ${state}`);
          setLifecycleState(state);
        }),
        await App.addListener("backButton", ({ canGoBack }) => {
          const close = overlayClosers.current.at(-1);
          if (close) {
            console.info("[mobile:back] close-overlay");
            close();
            return;
          }
          if (locationRef.current !== "/") {
            console.info(`[mobile:back] navigate-from=${locationRef.current}`);
            if (canGoBack) navigate(-1);
            else navigate("/");
            return;
          }
          console.info("[mobile:back] minimize-root");
          void App.minimizeApp();
        }),
      );

      // Capacitor SQLite 的原生连接表是进程级状态：先稳定正式库连接，
      // 再运行隔离 probe，避免并发 consistency check 移除另一条连接。
      await mobileDatabase.initialize();
      await runNativeSqliteProbeOnce();
      await SplashScreen.hide();
    };

    void initialize().catch((error: unknown) => {
      if (!disposed) {
        void SplashScreen.hide().catch(() => undefined);
        setRuntimeError(error instanceof Error ? error : new Error(String(error)));
      }
    });

    return () => {
      disposed = true;
      for (const handle of handles) void handle.remove();
    };
  }, [navigate]);

  React.useEffect(() => {
    if (isNativeMobile()) console.info(`[mobile:route] ${location.pathname}`);
  }, [location.pathname]);

  const registerOverlayCloser = React.useCallback((close: () => void) => {
    overlayClosers.current.push(close);
    return () => {
      overlayClosers.current = overlayClosers.current.filter((candidate) => candidate !== close);
    };
  }, []);

  if (runtimeError) throw runtimeError;

  return (
    <RuntimeContext.Provider value={{ lifecycleState, keyboardOpen, registerOverlayCloser }}>
      {children}
    </RuntimeContext.Provider>
  );
}

export function useMobileRuntime(): RuntimeContextValue {
  const value = React.useContext(RuntimeContext);
  if (!value) throw new Error("useMobileRuntime must be used inside MobileRuntimeProvider");
  return value;
}
