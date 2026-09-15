import React from "react";

type State = { error: Error | null };

export class MobileErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error("[mobile] render failure", error.name, error.message);
  }

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="fatal-screen" role="alert">
        <div>
          <span>RUNTIME ERROR</span>
          <h1>移动端本地数据库初始化失败</h1>
          <p>{sanitizeDiagnostic(this.state.error)}</p>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      </main>
    );
  }
}

function sanitizeDiagnostic(error: Error): string {
  return `${error.name}: ${error.message}`
    .replace(/[A-Za-z]:\\[^\s]+/g, "[local path]")
    .replace(/(token|secret|password)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}
