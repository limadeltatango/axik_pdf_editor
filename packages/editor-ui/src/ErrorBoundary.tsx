import { Component, type ReactNode } from "react";
import { diagnostics, type DiagnosticRuntime } from "@axik/diagnostics";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

interface Props {
  children: ReactNode;
  runtime: DiagnosticRuntime;
  version: string;
}
interface State {
  error?: string;
  showDiagnostics?: boolean;
}

/**
 * React rendering failures must leave a reachable diagnostics export action.
 * Only a whitelisted error *kind* enters the diagnostic archive, not message
 * content, stack traces, source document data or local file paths.
 */
export class EditorErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error: error.message || "Unexpected UI error" };
  }

  componentDidCatch(error: Error): void {
    diagnostics.recordError("ui", "UI_EXCEPTION", error);
    // Fire-and-forget persistence keeps this error available on next launch.
    void diagnostics.flush();
  }

  render() {
    if (this.state.error) {
      return <main className="crash-boundary" role="alert">
        <h1>Axik PDF Editor encountered a UI error</h1>
        <p>The original PDF is not intentionally modified by this foundation editor.
          Draft annotations may be recoverable when the same document is reopened.</p>
        <p>You can download a diagnostic ZIP here even while the main editor is unavailable.</p>
        <button onClick={() => this.setState({ showDiagnostics: true })}>
          Open diagnostics
        </button>
        <button onClick={() => window.location.reload()}>Reload editor</button>
        {this.state.showDiagnostics && <DiagnosticsPanel
          runtime={this.props.runtime} version={this.props.version}
          onClose={() => this.setState({ showDiagnostics: false })} />}
      </main>;
    }
    return this.props.children;
  }
}
