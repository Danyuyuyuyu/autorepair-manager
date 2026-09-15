import { App } from "@capacitor/app";
import React from "react";

import { isNativeMobile } from "../mobile/runtime";
import {
  mobileDatabase,
  type MobileDatabaseStatus,
  type MobileRepositories,
} from "./mobile-database-context";

interface MobileDatabaseValue {
  repos: MobileRepositories;
  status: MobileDatabaseStatus;
  transaction: typeof mobileDatabase.transaction;
}

const MobileDatabaseReactContext = React.createContext<MobileDatabaseValue | null>(null);

export function MobileDatabaseProvider({ children }: React.PropsWithChildren) {
  const [status, setStatus] = React.useState<MobileDatabaseStatus | null>(null);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!isNativeMobile()) return;
    let disposed = false;
    let handle: { remove: () => Promise<void> } | undefined;

    void mobileDatabase
      .initialize()
      .then(async (nextStatus) => {
        if (!disposed) setStatus(nextStatus);
        console.info(
          `[mobile:database] READY file=${nextStatus.databaseFile} version=${nextStatus.schemaVersion} ` +
            `migration=${nextStatus.migration.applied.join(",") || "none"} ` +
            `bootstrap=${nextStatus.bootstrap?.outcome ?? "disabled"} ` +
            `counts=${JSON.stringify(nextStatus.bootstrap?.counts ?? {})}`,
        );
        handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) return;
          void mobileDatabase.ensureOpen().catch((reason: unknown) => {
            if (!disposed) setError(toError(reason));
          });
        });
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(toError(reason));
      });

    return () => {
      disposed = true;
      void handle?.remove();
    };
  }, []);

  if (error) throw error;
  if (!isNativeMobile()) return children;
  if (!status) return <div className="mobile-database-starting">正在准备本地数据库…</div>;

  return (
    <MobileDatabaseReactContext.Provider
      value={{
        repos: mobileDatabase.repos,
        status,
        transaction: mobileDatabase.transaction.bind(mobileDatabase),
      }}
    >
      {children}
    </MobileDatabaseReactContext.Provider>
  );
}

export function useMobileDatabase(): MobileDatabaseValue {
  const value = React.useContext(MobileDatabaseReactContext);
  if (!value) throw new Error("useMobileDatabase 只能在 Android MobileDatabaseProvider 内使用");
  return value;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
