import { CheckCircle2, CircleAlert, DatabaseZap, Trash2 } from "lucide-react";
import React from "react";

import { mobilePlatformLabel } from "../mobile/runtime";
import { deleteNativeSqliteProbe, runNativeSqliteProbe, type ProbeResult } from "./sqlite-probe";

type ProbeState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "passed"; result: ProbeResult }
  | { kind: "failed"; diagnostic: string };

export function SqliteProbePanel() {
  const platform = mobilePlatformLabel();
  const [state, setState] = React.useState<ProbeState>({ kind: "idle" });

  const run = async () => {
    setState({ kind: "running" });
    try {
      setState({ kind: "passed", result: await runNativeSqliteProbe() });
    } catch (error) {
      setState({ kind: "failed", diagnostic: safeDiagnostic(error) });
    }
  };

  const clean = async () => {
    try {
      await deleteNativeSqliteProbe();
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "failed", diagnostic: safeDiagnostic(error) });
    }
  };

  return (
    <article className="probe-card">
      <div className="probe-heading">
        <div>
          <p>NATIVE DATABASE</p>
          <h3>SQLite Bridge 探针</h3>
        </div>
        <span data-platform={platform}>{platform === "android" ? "Android" : "Browser"}</span>
      </div>

      {platform === "browser" ? (
        <div className="probe-message is-browser">
          <CircleAlert size={19} aria-hidden />
          <p>Native SQLite unavailable in browser development mode</p>
        </div>
      ) : null}

      {state.kind === "passed" ? (
        <div className="probe-message is-passed" role="status">
          <CheckCircle2 size={19} aria-hidden />
          <div>
            <strong>
              {state.result.passed}/{state.result.total} 通过
            </strong>
            <p>
              {state.result.priorRunPersisted
                ? "已确认上一次启动留下的持久化标记。"
                : "本次已确认 close/reopen 持久化；重启后再跑可验证跨启动标记。"}
            </p>
          </div>
        </div>
      ) : null}

      {state.kind === "failed" ? (
        <div className="probe-message is-failed" role="alert">
          <CircleAlert size={19} aria-hidden />
          <div>
            <strong>移动端本地数据库初始化失败</strong>
            <p>{state.diagnostic}</p>
          </div>
        </div>
      ) : null}

      <div className="probe-actions">
        <button
          type="button"
          onClick={() => void run()}
          disabled={platform !== "android" || state.kind === "running"}
        >
          <DatabaseZap size={18} aria-hidden />
          {state.kind === "running" ? "运行中…" : "运行原生探针"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void clean()}
          disabled={platform !== "android" || state.kind === "running"}
        >
          <Trash2 size={17} aria-hidden /> 清理探针库
        </button>
      </div>
    </article>
  );
}

function safeDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[A-Za-z]:\\[^\s]+/g, "[local path]")
    .replace(/(token|secret|password)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}
