import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  applyCommand, hasEdits, initialEditorState, redo, undo,
  type Annotation, type CalloutAnnotation, type TextBoxAnnotation, type StickyNoteAnnotation, type EditorState
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
import { PageOperationsPanel } from "./PageOperationsPanel";
import { pdfError, startOpenPdf, type PdfDocument, type PdfPage } from "./pdf";
import {
  backupSuggestedName, pickEditablePdf, promptForSaveTarget,
  safeOverwriteOriginal, safeSaveAs, supportsEditablePicker, supportsSavePicker,
  type ExplicitFileHandle
} from "./save-files";
import "./styles.css";

export interface EditorAppProps {
  environment: "desktop" | "extension";
  /** Optional user-approved file supplied by the Chromium link acquisition UI. */
  requestedFile?: File;
  /** Desktop-only, privileged, explicit user-action print file handoff. */
  onNativePrint?: (bytes:Uint8Array)=>Promise<void>;
}

interface Session {
  name: string;
  pdf: PdfDocument;
  source: Uint8Array;
  fingerprint?: string;
  writableHandle?: ExplicitFileHandle;
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

export function EditorApp({ environment, requestedFile, onNativePrint }: EditorAppProps) {
  const lastRequestedFileRef = useRef<File | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);
  const [session, setSession] = useState<Session | null>(null);
  const [activePage, setActivePage] = useState<PdfPage>();
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<"select" | "callout" | "text" | "note">("select");
  const [selectedId, setSelectedId] = useState<string>();
  const [editor, setEditor] = useState<EditorState>(() => initialEditorState());
  const [recovery, setRecovery] = useState<DraftRecord>();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [showPrintPlan, setShowPrintPlan] = useState(false);
  const [showPageOperations, setShowPageOperations] = useState(false);
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

  const openFile = useCallback(async (file: File, writableHandle?: ExplicitFileHandle) => {
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
      setSession({ name: file.name, source, pdf, writableHandle });
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

  async function choosePdf() {
    if (!supportsEditablePicker()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const selected = await pickEditablePdf();
      await openFile(selected.file, selected.handle);
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError("Could not open selected PDF: " + pdfError(reason));
    }
  }

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

  const addCallout = (annotation: Annotation) => {
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

  const addText = (annotation: TextBoxAnnotation) => addCallout(annotation);
  const addNote = (annotation: StickyNoteAnnotation) => addCallout(annotation);

  function changeMarkupText(annotation: Annotation, text: string) {
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

  /**
   * Prepare a new viewer before committing a save. This avoids reporting success
   * then discovering that our PDF renderer cannot reopen the written bytes.
   * The old source remains open if any save stage fails.
   */
  async function preparePdfForSave(bytes: Uint8Array): Promise<PdfDocument> {
    const task = startOpenPdf(bytes);
    try {
      return await task.promise;
    } catch (reason) {
      await task.destroy().catch(() => undefined);
      throw reason;
    }
  }

  async function finishSavedPdf(
    bytes: Uint8Array, name: string, handle: ExplicitFileHandle,
    fingerprint: string, pdf: PdfDocument
  ) {
    const prior = session?.fingerprint;
    setSession({ source: bytes, name, writableHandle: handle, fingerprint, pdf });
    setEditor(initialEditorState());
    setPageNumber(1);
    setSelectedId(undefined);
    setTool("select");
    setRecovery(undefined);
    setJournalStatus("No unsaved draft annotations");
    // Stored pre-save draft changes belong to the old source version.
    if (prior) await deleteDraft(prior).catch(() => undefined);
  }

  async function saveAsFile() {
    if (!session || exporting || !supportsSavePicker()) return;
    // IMPORTANT: invoke the OS picker before any await that would lose the
    // transient user activation needed in Chromium extension pages.
    let target: ExplicitFileHandle;
    try {
      target = await promptForSaveTarget(session.name.replace(/\.pdf$/i, "") + "-edited.pdf");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError("Could not choose Save As destination: " + pdfError(reason));
      return;
    }

    setExporting(true);
    const started = performance.now();
    diagnostics.record("document", "PDF_SAVE_AS_START");
    let preview: PdfDocument | undefined;
    try {
      const result = await exportEditedPdf(session.source, editor.annotations);
      preview = await preparePdfForSave(result.bytes);
      const fingerprint = await safeSaveAs(target, result.bytes, session.writableHandle);
      await finishSavedPdf(result.bytes, target.name, target, fingerprint, preview);
      preview = undefined;
      diagnostics.record("document", "PDF_SAVE_AS_OK", "info", {
        durationMs: performance.now() - started
      });
      setNotice("Saved a new PDF: " + target.name +
        ". This file is now active. Existing saved callouts are visible, but imported callout editing in Axik is still being developed.");
    } catch (reason) {
      diagnostics.recordError("document", "PDF_SAVE_AS_FAILED", reason, {
        durationMs: performance.now() - started
      });
      setError("Save As did not complete: " + pdfError(reason));
    } finally {
      if (preview) await preview.destroy().catch(() => undefined);
      setExporting(false);
    }
  }

  async function saveCurrentFile() {
    if (!session?.writableHandle || !session.fingerprint || !dirty || exporting) return;
    // A separately selected backup is REQUIRED by the alpha before overwriting.
    // Native desktop backup generation will later remove this extra picker.
    let backup: ExplicitFileHandle;
    try {
      backup = await promptForSaveTarget(backupSuggestedName(session.name));
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError("Could not select backup location: " + pdfError(reason));
      return;
    }
    const acknowledged = window.confirm(
      "SAVE WILL OVERWRITE YOUR ORIGINAL PDF. Axik will first save and verify " +
      "a separate backup at the location you just chose. Continue?"
    );
    if (!acknowledged) return;
    setExporting(true);
    const started = performance.now();
    diagnostics.record("document", "PDF_SAVE_START");
    let preview: PdfDocument | undefined;
    try {
      const original = session;
      const result = await exportEditedPdf(original.source, editor.annotations);
      preview = await preparePdfForSave(result.bytes);
      const fingerprint = await safeOverwriteOriginal({
        originalHandle: original.writableHandle!, backupHandle: backup,
        sourceFingerprint: original.fingerprint!,
        originalBytes: original.source, editedBytes: result.bytes
      });
      await finishSavedPdf(result.bytes, original.name, original.writableHandle!, fingerprint, preview);
      preview = undefined;
      diagnostics.record("document", "PDF_SAVE_OK", "info", {
        durationMs: performance.now() - started
      });
      setNotice("Original overwritten after a separately verified backup was saved as " +
        backup.name + ". The written PDF was reopened successfully.");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "FileChangedError") {
        diagnostics.record("document", "PDF_SAVE_CONFLICT", "warn");
      }
      diagnostics.recordError("document", "PDF_SAVE_FAILED", reason, {
        durationMs: performance.now() - started
      });
      setError("Save was blocked or failed: " + pdfError(reason) +
        ". If a backup file was created, retain it until the document is verified.");
    } finally {
      if (preview) await preview.destroy().catch(() => undefined);
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
          <div><strong>Axik PDF Editor</strong><small>{environment === "desktop" ? "Desktop Core Alpha" : "Chromium Core Alpha"}</small></div>
        </div>
        <div className="filename" title={session?.name ?? "No PDF loaded"}>
          {session?.name ?? "No document open"}
        </div>
        <div className="topbar-actions">
          <button onClick={() => void choosePdf()} disabled={loading}>
            {loading ? "Opening…" : "Open PDF"}
          </button>
          <button className="primary"
            onClick={() => dirty ? void exportEdited() : exportOriginal()}
            disabled={!session || exporting}
            title="Quick Export downloads a separate PDF copy; it never overwrites the source">
            {exporting ? "Exporting…" : "Quick Export"}
          </button>
          <button
            onClick={() => void saveAsFile()}
            disabled={!session || exporting || !supportsSavePicker()}
            title={supportsSavePicker() ?
              "Save as a new PDF filename (never overwrite a nonempty destination)" :
              "This WebView does not support File System Access; use Quick Export"}>
            Save As…
          </button>
          <button
            onClick={() => void saveCurrentFile()}
            disabled={!session?.writableHandle || !session.fingerprint || !dirty || exporting}
            title={session?.writableHandle ?
              "Overwrite this source only after choosing and verifying a separate backup" :
              "Open with the editable file picker to enable safe overwrite; ordinary imports remain read-only"}>
            Save
          </button>
          <button onClick={() => {
            diagnostics.record("print", "PRINT_PLAN_OPEN");
            setShowPrintPlan(true);
          }} disabled={!session}>Print</button>
          <button onClick={()=>setShowPageOperations(true)} disabled={!session}>
            Pages
          </button>
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
        <button aria-pressed={tool === "text"} disabled={!session}
          className={tool === "text" ? "active" : ""}
          onClick={() => setTool("text")}>Add Text</button>
        <button aria-pressed={tool === "note"} disabled={!session}
          className={tool === "note" ? "active" : ""}
          onClick={() => setTool("note")}>Comment</button>
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
        <span className="prototype-label">Core Alpha · Not production-ready</span>
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
            <button className="primary" onClick={() => void choosePdf()}>Choose a PDF</button>
            <p className="muted">Or drag a PDF onto this window. Files are processed locally.
              When supported, choosing a file directly enables Save with a verified separate backup.
              Dragged and downloaded files still support Quick Export and Save As.</p>
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
                onSelect={setSelectedId} onAddCallout={addCallout} onAddText={addText} onAddNote={addNote}
              />
              <p className="workspace-tip">
                {tool === "callout" ? "Click where the callout arrow should point." :
                  tool === "text" ? "Click to place an editable text box." :
                  tool === "note" ? "Click to leave a sticky note comment." :
                  "Select a callout or added text box to edit it."}
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
              <strong>{annotation.kind === "callout" ? "Callout" : annotation.kind==="text" ? "Text" : "Note"} · Page {annotation.pageIndex + 1}</strong>
              <span>{annotation.text}</span>
            </button>
          ))}
          {selectedAnnotation && <>
            <label className="editor-label" htmlFor="callout-text">
              {selectedAnnotation.kind === "callout" ? "Callout text" : selectedAnnotation.kind==="text" ? "New text" : "Comment"}
            </label>
            <textarea id="callout-text" value={selectedAnnotation.text}
              onChange={(event) => changeMarkupText(selectedAnnotation, event.target.value)}
              rows={5} maxLength={20000} />
            {selectedAnnotation.kind !== "note" && <>
            <label className="editor-label" htmlFor="markup-font-size">Font size (points)</label>
            <input id="markup-font-size" className="markup-number"
              type="number" min={4} max={200}
              value={selectedAnnotation.style.fontSize}
              onChange={event=>{
                const size=Number(event.target.value);
                if(!Number.isFinite(size)||size<4||size>200)return;
                setEditor(prev=>applyCommand(prev,{type:"replace",annotation:{
                  ...selectedAnnotation,
                  style:{...selectedAnnotation.style,fontSize:size},
                  updatedAt:new Date().toISOString()
                }}));
              }} />
            </>}
            <button className="danger" onClick={() => {
              setEditor((previous) => applyCommand(previous, {
                type: "remove", annotationId: selectedAnnotation.id
              }));
              setSelectedId(undefined);
            }}>Delete {selectedAnnotation.kind==="callout"?"callout":selectedAnnotation.kind==="text"?"text box":"comment"}</button>
          </>}
          <div className="sidebar-footer">
            <strong>Save status</strong>
            <p>{dirty ? journalStatus : "No unsaved annotations"}</p>
            <p className="muted">Quick Export never overwrites. Save As selects a new file;
              Save overwrites a user-picked source only after a separate verified backup.
              Long text, fonts and imported-callout editing are still limited. Printing,
              real existing-text editing and secure redaction are not implemented.</p>
          </div>
        </aside>
      </div>
      {showPrintPlan && session && <PrintPlanPanel pdf={session.pdf}
        source={session.source} annotations={editor.annotations} name={session.name}
        onNativePrint={onNativePrint}
        onClose={() => setShowPrintPlan(false)} />}
      {showPageOperations && session && <PageOperationsPanel
        pdf={session.pdf} source={session.source}
        annotations={editor.annotations} name={session.name}
        onClose={()=>setShowPageOperations(false)} />}
      {showDiagnostics && <DiagnosticsPanel runtime={
        environment === "desktop" ? "desktop" : "chromium-extension"
      } version="0.1.0" onClose={() => setShowDiagnostics(false)} />}
    </main>
  );
}
