import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  applyCommand, hasEdits, initialEditorState, redo, undo,
  type Annotation, type CalloutAnnotation, type EditorState
} from "@axik/document-core";
import {
  deleteDraft, documentFingerprint, readDraft, writeDraft,
  type DraftRecord
} from "@axik/recovery";
import { diagnostics, fileSizeBucketMiB } from "@axik/diagnostics";
import { exportEditedPdf } from "@axik/pdf-writer";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { PageCanvas } from "./PageCanvas";
import { PrintPlanPanel } from "./PrintPlanPanel";
import { pdfError, startOpenPdf, type PdfDocument, type PdfPage } from "./pdf";
import "./styles.css";

export interface EditorAppProps {
  environment: "desktop" | "extension";
  /** Optional user-approved file supplied by the Chromium link acquisition UI. */
  requestedFile?: File;
}

interface Session {
  name: string;
  pdf: PdfDocument;
  source: Uint8Array;
  fingerprint?: string;
}

const MAX_LOCAL_PDF_BYTES = 512 * 1024 * 1024;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;

function downloadBlob(name: string, content: Uint8Array): void {
  const data = new Uint8Array(content.byteLength);
  data.set(content);
  const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Let the browser finish the download before revoking the URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function EditorApp({ environment, requestedFile }: EditorAppProps) {
  const lastRequestedFileRef = useRef<File | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);
  const [session, setSession] = useState<Session | null>(null);
  const [activePage, setActivePage] = useState<PdfPage>();
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<"select" | "callout">("select");
  const [selectedId, setSelectedId] = useState<string>();
  const [editor, setEditor] = useState<EditorState>(() => initialEditorState());
  const [recovery, setRecovery] = useState<DraftRecord>();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [showPrintPlan, setShowPrintPlan] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [journalStatus, setJournalStatus] = useState("No draft edits");

  useEffect(() => {
    diagnostics.record("app", "APP_READY");
  }, []);

  // Clean up worker memory when a document is replaced or this component closes.
  useEffect(() => () => { void session?.pdf.destroy(); }, [session?.pdf]);

  // PDF.js only fetches/renders the selected page. Multi-page tiling is a later milestone.
  useEffect(() => {
    let active = true;
    setActivePage(undefined);
    if (session?.pdf) {
      const start = performance.now();
      diagnostics.record("document", "PDF_PAGE_LOAD_START", "info", {
        pageIndex: pageNumber - 1
      });
      session.pdf.getPage(pageNumber).then((page) => {
        if (active) {
          setActivePage(page);
          diagnostics.record("document", "PDF_PAGE_LOAD_OK", "info", {
            pageIndex: pageNumber - 1, durationMs: performance.now() - start
          });
        }
      }).catch((reason: unknown) => {
        if (active) {
          setError(pdfError(reason));
          diagnostics.recordError("document", "PDF_PAGE_LOAD_FAILED", reason);
        }
      });
    }
    return () => { active = false; };
  }, [session?.pdf, pageNumber]);

  // Edits are persisted locally, not in the source PDF. Never call this "PDF saved".
  useEffect(() => {
    if (!session?.fingerprint || !hasEdits(editor)) return;
    const fingerprint = session.fingerprint;
    setJournalStatus("Saving draft locally…");
    const timer = window.setTimeout(() => {
      void writeDraft(fingerprint, editor)
        .then(() => {
          setJournalStatus("Draft stored on this device (not exported to PDF)");
          diagnostics.record("storage", "DRAFT_WRITE_OK");
        })
        .catch((reason: unknown) => {
          diagnostics.recordError("storage", "DRAFT_WRITE_FAILED", reason);
          setJournalStatus("Draft storage failed");
          setError("Draft recovery could not be saved: " + pdfError(reason));
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [session?.fingerprint, editor]);

  useEffect(() => {
    if (!hasEdits(editor)) return;
    function warnUnsaved(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnUnsaved);
    return () => window.removeEventListener("beforeunload", warnUnsaved);
  }, [editor]);

  const openFile = useCallback(async (file: File) => {
    if (session && hasEdits(editor)) {
      if (!window.confirm("Changes are draft-only and not embedded in the PDF. Store the local draft and open another file?")) {
        return;
      }
      if (!session.fingerprint) {
        setError("The current document is still being identified. Cannot switch safely yet.");
        return;
      }
      try {
        // Persist the latest edit, not just the last debounced version, before
        // switching away and destroying the old PDF worker.
        await writeDraft(session.fingerprint, editor);
      } catch (reason) {
        setError("Cannot store current draft. Document switch cancelled: " + pdfError(reason));
        return;
      }
    }
    const generation = ++generationRef.current;
    setError(undefined);
    setNotice(undefined);
    setRecovery(undefined);
    setJournalStatus("No draft edits");
    setLoading(true);
    const openStart = performance.now();
    const sizeBucket = fileSizeBucketMiB(file.size);
    diagnostics.record("document", "PDF_OPEN_START", "info", {
      fileSizeBucketMiB: sizeBucket
    });
    let task: ReturnType<typeof startOpenPdf> | undefined;
    try {
      if (file.size > MAX_LOCAL_PDF_BYTES) {
        throw new RangeError("This 512 MB+ file exceeds the current foundation limit. Streaming support is planned.");
      }
      const source = new Uint8Array(await file.arrayBuffer());
      if (generation !== generationRef.current) return;
      if (!source.byteLength) throw new Error("The selected file is empty.");
      task = startOpenPdf(source);
      const pdf = await task.promise;
      if (generation !== generationRef.current) {
        await pdf.destroy();
        return;
      }
      diagnostics.record("document", "PDF_OPEN_OK", "info", {
        durationMs: performance.now() - openStart,
        fileSizeBucketMiB: sizeBucket, pageCount: pdf.numPages
      });
      setSession({ name: file.name, source, pdf });
      setPageNumber(1);
      setZoom(1);
      setTool("select");
      setSelectedId(undefined);
      setEditor(initialEditorState());
      setShowPrintPlan(false);
      setNotice("PDF opened. Markup is an in-session draft; edited PDF export is not implemented yet.");
      // Fingerprinting and draft lookup follow after the document is usable.
      void documentFingerprint(source).then(async (fingerprint) => {
        if (generation !== generationRef.current) return;
        setSession((previous) => previous?.pdf === pdf
          ? { ...previous, fingerprint } : previous);
        const stored = await readDraft(fingerprint);
        if (generation === generationRef.current && stored?.annotations.length) {
          setRecovery(stored);
        }
      }).catch((reason: unknown) => {
        if (generation === generationRef.current) {
          diagnostics.recordError("storage", "DRAFT_READ_FAILED", reason);
          setError("Draft recovery unavailable: " + pdfError(reason));
        }
      });
    } catch (reason) {
      diagnostics.recordError("document", "PDF_OPEN_FAILED", reason, {
        durationMs: performance.now() - openStart, fileSizeBucketMiB: sizeBucket
      });
      setError(pdfError(reason));
      // If loading failed, leave the previous document open.
      if (task) await task.destroy().catch(() => undefined);
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [editor, session]);


  useEffect(() => {
    if (requestedFile && requestedFile !== lastRequestedFileRef.current) {
      lastRequestedFileRef.current = requestedFile;
      void openFile(requestedFile);
    }
  }, [requestedFile, openFile]);

  function handleChooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) void openFile(file);
    event.currentTarget.value = "";
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setError("Please select a PDF document.");
      return;
    }
    void openFile(file);
  }

  function restoreDraft() {
    if (!recovery) return;
    try {
      setEditor(initialEditorState(recovery.annotations));
      diagnostics.record("annotation", "ANNOTATION_RESTORED", "info", {
        annotationCount: recovery.annotations.length
      });
      setRecovery(undefined);
      setNotice("Recovered draft loaded. Export to an edited PDF is not available yet.");
    } catch (reason) {
      setError(pdfError(reason));
    }
  }

  function discardRecoveredDraft() {
    if (session?.fingerprint) {
      void deleteDraft(session.fingerprint).catch((reason: unknown) =>
        setError("Cannot delete local draft: " + pdfError(reason))
      );
    }
    setRecovery(undefined);
  }

  const addCallout = (annotation: CalloutAnnotation) => {
    try {
      setEditor((previous) => applyCommand(previous, { type: "add", annotation }));
      diagnostics.record("annotation", "ANNOTATION_ADDED", "info", {
        pageIndex: annotation.pageIndex
      });
      setSelectedId(annotation.id);
      setTool("select");
    } catch (reason) {
      setError(pdfError(reason));
    }
  };

  function changeCallout(annotation: CalloutAnnotation, text: string) {
    try {
      setEditor((previous) => applyCommand(previous, {
        type: "replace",
        annotation: { ...annotation, text, updatedAt: new Date().toISOString() }
      }));
    } catch (reason) {
      setError(pdfError(reason));
    }
  }

  const selectedAnnotation: Annotation | undefined =
    editor.annotations.find((annotation) => annotation.id === selectedId);
  const dirty = hasEdits(editor);

  async function exportEdited() {
    if (!session || !dirty || exporting) return;
    setExporting(true);
    setError(undefined);
    const started = performance.now();
    try {
      const result = await exportEditedPdf(session.source, editor.annotations);
      const filename = session.name.replace(/\.pdf$/i, "") + "-axik-edited.pdf";
      downloadBlob(filename, result.bytes);
      diagnostics.record("document", "PDF_EXPORT_OK", "info", {
        durationMs: performance.now() - started,
        annotationCount: result.calloutsWritten
      });
      setNotice("Edited PDF download requested: " + filename +
        ". Native callout annotations were written. " +
        (result.warnings.length ? result.warnings.join(" ") :
          "Reopen the downloaded PDF to verify appearance before relying on it."));
    } catch (reason) {
      diagnostics.recordError("document", "PDF_EXPORT_FAILED", reason, {
        durationMs: performance.now() - started
      });
      setError("Could not write the edited PDF: " + pdfError(reason));
    } finally {
      setExporting(false);
    }
  }

  function exportOriginal() {
    if (!session || dirty) {
      diagnostics.record("document", "PDF_EXPORT_BLOCKED", "warn");
      setError("Edited PDF export is not implemented. The original will not be misrepresented as edited.");
      return;
    }
    downloadBlob(session.name, session.source);
  }

  return (
    <main className="editor-root" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <header className="topbar">
        <div className="app-brand">
          <span className="app-symbol">A</span>
          <div><strong>Axik PDF Editor</strong><small>{environment === "desktop" ? "Desktop foundation" : "Chromium extension foundation"}</small></div>
        </div>
        <div className="filename" title={session?.name ?? "No PDF loaded"}>
          {session?.name ?? "No document open"}
        </div>
        <div className="topbar-actions">
          <button onClick={() => fileInputRef.current?.click()} disabled={loading}>
            {loading ? "Opening…" : "Open PDF"}
          </button>
          <button onClick={exportOriginal} disabled={!session || dirty || exporting}
            title={dirty ? "Edited PDF export is pending a validated writer" : "Download a copy of the unchanged original"}>
            Export original
          </button>
          <button onClick={() => void exportEdited()}
            disabled={!session || !dirty || exporting}
            title="Download a separate edited PDF with native FreeText callout annotations">
            {exporting ? "Saving…" : "Export edited PDF"}
          </button>
          <button onClick={() => {
            diagnostics.record("print", "PRINT_PLAN_OPEN");
            setShowPrintPlan(true);
          }} disabled={!session}>Layout preview</button>
          <button onClick={() => setShowDiagnostics(true)}>Diagnostics</button>
        </div>
        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={handleChooseFile} />
      </header>
      <div className="toolstrip" role="toolbar" aria-label="PDF editing tools">
        <button aria-pressed={tool === "select"} disabled={!session}
          className={tool === "select" ? "active" : ""}
          onClick={() => setTool("select")}>Select</button>
        <button aria-pressed={tool === "callout"} disabled={!session}
          className={tool === "callout" ? "active" : ""}
          onClick={() => setTool("callout")}>Callout ↗</button>
        <span className="separator" />
        <button disabled={!editor.undoStack.length} onClick={() => setEditor(undo)}>Undo</button>
        <button disabled={!editor.redoStack.length} onClick={() => setEditor(redo)}>Redo</button>
        <span className="separator" />
        <button disabled={!session} onClick={() => setPageNumber((n) => Math.max(1, n - 1))}>◀</button>
        <span className="page-counter">Page {session ? pageNumber : "—"} / {session?.pdf.numPages ?? "—"}</span>
        <button disabled={!session || pageNumber >= session.pdf.numPages}
          onClick={() => setPageNumber((n) => Math.min(session!.pdf.numPages, n + 1))}>▶</button>
        <span className="separator" />
        <button disabled={!session} onClick={() => setZoom((n) => Math.max(MIN_ZOOM, Math.round((n - .2) * 10) / 10))}>−</button>
        <span className="zoom-display">{Math.round(zoom * 100)}%</span>
        <button disabled={!session} onClick={() => setZoom((n) => Math.min(MAX_ZOOM, Math.round((n + .2) * 10) / 10))}>+</button>
        <span className="spacer" />
        <span className="prototype-label">Foundation · Not production-ready</span>
      </div>
      {error && <div className="message error" role="alert">{error} <button onClick={() => setError(undefined)}>Dismiss</button></div>}
      {recovery && <div className="message recover" role="status">
        Found a local draft of this document from {new Date(recovery.savedAt).toLocaleString()}.
        <button onClick={restoreDraft}>Restore annotations</button>
        <button onClick={discardRecoveredDraft}>Discard draft</button>
      </div>}
      {notice && <div className="message hint" role="status">{notice} <button onClick={() => setNotice(undefined)}>×</button></div>}
      <div className="editor-body">
        <div className="document-viewport">
          {!session && <section className="welcome">
            <h1>Your documents, without the overhead.</h1>
            <p>Open a PDF to view it, navigate pages and try the local callout tool.</p>
            <button className="primary" onClick={() => fileInputRef.current?.click()}>Choose a PDF</button>
            <p className="muted">Or drag a PDF onto this window. Files are processed locally.</p>
            <p className="warning-note">This is an early foundation. Editing, intelligent printing, signing and
              secure redaction are not yet complete and must not be relied on for production work.</p>
          </section>}
          {session && (
            <div className="page-workspace">
              <PageCanvas
                page={activePage} pageIndex={pageNumber - 1} zoom={zoom}
                tool={tool}
                annotations={editor.annotations}
                selectedAnnotationId={selectedId}
                onSelect={setSelectedId} onAddCallout={addCallout}
              />
              <p className="workspace-tip">
                {tool === "callout" ? "Click the document where the arrow should point." :
                  "Click a callout to edit its text in the right-hand panel."}
              </p>
            </div>
          )}
        </div>
        <aside className="comments-sidebar">
          <div className="sidebar-heading"><strong>Comments &amp; markup</strong><span>{editor.annotations.length}</span></div>
          {!session && <p className="muted">Open a document to begin annotating.</p>}
          {session && <p className="muted">Draft only. These annotations are not embedded in the source PDF yet.</p>}
          {editor.annotations.map((annotation) => (
            <button key={annotation.id}
              className={"comment-item" + (annotation.id === selectedId ? " selected" : "")}
              onClick={() => { setPageNumber(annotation.pageIndex + 1); setSelectedId(annotation.id); }}>
              <strong>{annotation.kind === "callout" ? "Callout" : "Note"} · Page {annotation.pageIndex + 1}</strong>
              <span>{annotation.text}</span>
            </button>
          ))}
          {selectedAnnotation?.kind === "callout" && <>
            <label className="editor-label" htmlFor="callout-text">Callout text</label>
            <textarea id="callout-text" value={selectedAnnotation.text}
              onChange={(event) => changeCallout(selectedAnnotation, event.target.value)}
              rows={5} maxLength={20000} />
            <button className="danger" onClick={() => {
              setEditor((previous) => applyCommand(previous, {
                type: "remove", annotationId: selectedAnnotation.id
              }));
              setSelectedId(undefined);
            }}>Delete callout</button>
          </>}
          <div className="sidebar-footer">
            <strong>Save status</strong>
            <p>{dirty ? journalStatus : "No unsaved annotations"}</p>
            <p className="muted">Alpha PDF export writes native callouts to a new PDF.
              Long text, transparency and some fonts remain limited. True redaction,
              visual signing and printer-driver control are not implemented.</p>
          </div>
        </aside>
      </div>
      {showPrintPlan && session && <PrintPlanPanel pdf={session.pdf}
        onClose={() => setShowPrintPlan(false)} />}
      {showDiagnostics && <DiagnosticsPanel runtime={
        environment === "desktop" ? "desktop" : "chromium-extension"
      } version="0.0.1" onClose={() => setShowDiagnostics(false)} />}
    </main>
  );
}
