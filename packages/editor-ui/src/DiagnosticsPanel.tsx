import { useEffect, useState } from "react";
import {
  createSupportBundle, diagnostics, downloadSupportBundle,
  type DiagnosticRuntime, type RecentDiagnostics
} from "@axik/diagnostics";

export interface DiagnosticsPanelProps {
  runtime: DiagnosticRuntime;
  version: string;
  onClose: () => void;
}

export function DiagnosticsPanel({ runtime, version, onClose }: DiagnosticsPanelProps) {
  const [enabled, setEnabled] = useState(diagnostics.enabled);
  const [includeEnvironment, setIncludeEnvironment] = useState(true);
  const [includeGpuDetails, setIncludeGpuDetails] = useState(false);
  const [recent, setRecent] = useState<RecentDiagnostics>();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    let active = true;
    void diagnostics.recent().then((value) => {
      if (active) setRecent(value);
    }).catch(() => {
      if (active) setProblem("Diagnostic history could not be read. Current session remains in memory.");
    });
    return () => { active = false; };
  }, []);

  function toggleCollection(next: boolean) {
    diagnostics.setEnabled(next);
    setEnabled(next);
    setMessage(next ? "Local diagnostics resumed." :
      "New event collection stopped. Existing local history remains until cleared.");
  }

  async function exportBundle() {
    setWorking(true);
    setMessage(undefined);
    setProblem(undefined);
    try {
      const bundle = await createSupportBundle(runtime, version, {
        includeEnvironment, includeGpuDetails
      });
      // This requests a local download; no upload occurs.
      downloadSupportBundle(bundle);
      setMessage(
        "Local ZIP download requested: " + bundle.filename +
        ". Review its contents, then attach it to your ChatGPT conversation or bug report."
      );
      setRecent(await diagnostics.recent());
    } catch (reason) {
      setProblem(reason instanceof Error
        ? "Could not create diagnostics ZIP (" + reason.name + ")."
        : "Could not create diagnostics ZIP.");
    } finally {
      setWorking(false);
    }
  }

  async function clearLocalHistory() {
    if (!window.confirm("Delete stored diagnostic history from this app? This cannot be undone.")) return;
    setWorking(true);
    setProblem(undefined);
    try {
      await diagnostics.clear();
      setRecent(await diagnostics.recent());
      setMessage("Diagnostic history deleted locally.");
    } catch (reason) {
      setProblem(reason instanceof Error
        ? "Cannot clear persisted diagnostics (" + reason.name + ")."
        : "Cannot clear persisted diagnostics.");
    } finally {
      setWorking(false);
    }
  }

  const lastEvents = recent?.sessions.flatMap((session) => session.events)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 12) ?? [];

  return (
    <div className="modal-backdrop">
      <section className="diagnostics-panel" role="dialog" aria-modal="true"
        aria-label="Axik PDF Editor diagnostics">
        <header className="panel-heading">
          <div>
            <h2>Diagnostics &amp; support bundle</h2>
            <p className="muted">Private, local event recording for troubleshooting.
              Nothing is sent to Axik, Adobe or ChatGPT automatically.</p>
          </div>
          <button onClick={onClose}>Close</button>
        </header>
        <div className="diagnostics-section">
          <label className="diagnostics-choice">
            <input type="checkbox" checked={enabled}
              onChange={(event) => toggleCollection(event.target.checked)} />
            Collect minimal diagnostics locally
          </label>
          <p className="muted">
            Up to 600 structured events per session and 8 recent sessions,
            with a seven-day retention window. You can disable or clear it at any time.
          </p>
          <div className="diagnostics-counter">
            <strong>{recent?.eventCount ?? "…"}</strong> recent event(s) across
            {" "}<strong>{recent?.sessions.length ?? "…"}</strong> session(s)
          </div>
          {recent && !recent.localStorageAvailable && (
            <p className="diagnostics-warning">Persistent diagnostics storage is unavailable.
              Only events still in memory may be exported.</p>
          )}
        </div>
        <div className="diagnostics-section">
          <h3>What the ZIP includes</h3>
          <label className="diagnostics-choice">
            <input type="checkbox" checked={includeEnvironment}
              onChange={(event) => {
                setIncludeEnvironment(event.target.checked);
                if (!event.target.checked) setIncludeGpuDetails(false);
              }} />
            Browser, OS and application environment (recommended for debugging)
          </label>
          <label className="diagnostics-choice">
            <input type="checkbox" checked={includeGpuDetails}
              disabled={!includeEnvironment}
              onChange={(event) => setIncludeGpuDetails(event.target.checked)} />
            Include identifiable GPU vendor/model if available (optional)
          </label>
          <p className="muted">Always included: manifest, app/runtime version, timestamps,
            fixed error categories, operation codes and numeric performance metrics.
            Optional environment details may identify your hardware.</p>
          <p className="diagnostics-warning">
            Never included by this diagnostic recorder: PDF file contents, file names,
            file paths, document hashes, URLs, annotations or comment text,
            passwords, screenshots, raw exception messages or stack traces.
          </p>
          <p className="muted">The ZIP can be inspected before sharing. Native Windows
            printer-driver logs and OS crash dumps are not yet collected.</p>
        </div>
        <div className="diagnostics-section">
          <h3>Recent events</h3>
          <div className="diagnostics-event-list" aria-label="Most recent diagnostic event codes">
            {!lastEvents.length && <p className="muted">No recorded events yet.</p>}
            {lastEvents.map((event) =>
              <div className="diagnostics-event" key={event.sessionId + ":" + event.sequence}>
                <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                <code>{event.code}</code>
                <span>{event.level}</span>
              </div>)}
          </div>
        </div>
        {(message || problem) && <p className={problem ? "diagnostics-warning" : "diagnostics-success"}
          role="status">{problem || message}</p>}
        <footer className="diagnostics-actions">
          <button onClick={() => void clearLocalHistory()} disabled={working}>Clear local history</button>
          <span className="spacer" />
          <button className="primary" onClick={() => void exportBundle()} disabled={working}>
            {working ? "Preparing ZIP…" : "Export diagnostics ZIP"}
          </button>
        </footer>
      </section>
    </div>
  );
}
