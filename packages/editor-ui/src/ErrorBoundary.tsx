import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error?: string; }

/**
 * Catches React render failures so an unexpected annotation/UI condition does
 * not leave an unexplained blank window. Native/parser-worker isolation is
 * a separate future implementation task.
 */
export class EditorErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error: error.message || "Unexpected UI error" };
  }

  render() {
    if (this.state.error) {
      return <main className="crash-boundary" role="alert">
        <h1>Axik PDF Editor hit an unexpected error</h1>
        <p>The original document has not been intentionally modified by the editor.</p>
        <p>Any unsaved annotations are drafts and may be recoverable after reopening
          the same source PDF. Draft recovery is not yet guaranteed.</p>
        <details><summary>Technical description</summary><pre>{this.state.error}</pre></details>
        <button onClick={() => window.location.reload()}>Reload editor</button>
      </main>;
    }
    return this.props.children;
  }
}
