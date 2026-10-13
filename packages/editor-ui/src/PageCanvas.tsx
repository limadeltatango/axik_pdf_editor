import { useEffect, useState, useRef, type MouseEvent } from "react";
import {
  newCallout, newTextBox, newStickyNote, pdfToViewport, transformedRect, viewportToPdf,
  type Annotation, type CalloutAnnotation, type TextBoxAnnotation, type StickyNoteAnnotation, type Matrix, type Point
} from "@axik/document-core";
import { diagnostics } from "@axik/diagnostics";
import type { PdfPage } from "./pdf";

export interface PageCanvasProps {
  page: PdfPage | undefined;
  pageIndex: number;
  zoom: number;
  tool: "select" | "callout" | "text" | "note";
  annotations: readonly Annotation[];
  selectedAnnotationId?: string;
  onSelect: (id: string) => void;
  onAddCallout: (annotation: CalloutAnnotation) => void;
  onAddText: (annotation: TextBoxAnnotation) => void;
  onAddNote: (annotation: StickyNoteAnnotation) => void;
}

interface ViewportInfo {
  width: number;
  height: number;
  transform: Matrix;
}

function leaderCoordinates(leader: readonly Point[], transform: Matrix): string {
  return leader.map((point) => {
    const screen = pdfToViewport(transform, point);
    return String(screen.x) + "," + String(screen.y);
  }).join(" ");
}

export function PageCanvas({
  page, pageIndex, zoom, tool, annotations, selectedAnnotationId,
  onSelect, onAddCallout, onAddText, onAddNote
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<ViewportInfo>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!page) {
      setViewport(undefined);
      return;
    }
    let cancelled = false;
    let cancelRender: (() => void) | undefined;
    setViewport(undefined);
    setError(undefined);
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const view = page.getViewport({ scale: zoom });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas 2D is unavailable.");
      canvas.width = Math.max(1, Math.floor(view.width * ratio));
      canvas.height = Math.max(1, Math.floor(view.height * ratio));
      canvas.style.width = String(view.width) + "px";
      canvas.style.height = String(view.height) + "px";
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const renderStarted = performance.now();
      diagnostics.record("render", "PDF_RENDER_START", "info", {
        pageIndex, zoomPercent: zoom * 100
      });
      const task = page.render({
        canvas,
        canvasContext: context,
        viewport: view,
        background: "rgb(255,255,255)"
      });
      cancelRender = () => task.cancel();
      const transform = view.transform as unknown as Matrix;
      if (!cancelled) {
        setViewport({ width: view.width, height: view.height, transform });
      }
      try {
        await task.promise;
        if (!cancelled) {
          diagnostics.record("render", "PDF_RENDER_OK", "info", {
            pageIndex, zoomPercent: zoom * 100, durationMs: performance.now() - renderStarted
          });
        }
      } catch (reason) {
        if (cancelled) {
          diagnostics.record("render", "PDF_RENDER_CANCELLED", "info", {
            pageIndex, durationMs: performance.now() - renderStarted
          });
        } else {
          diagnostics.recordError("render", "PDF_RENDER_FAILED", reason, {
            pageIndex, durationMs: performance.now() - renderStarted
          });
          throw reason;
        }
      }
    })().catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Page render failed.");
    });
    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [page, zoom]);

  function handlePageClick(event: MouseEvent<SVGSVGElement>) {
    if (!page || !viewport || (tool !== "callout" && tool !== "text" && tool !== "note")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const tip = viewportToPdf(viewport.transform, {
      x: event.clientX - bounds.left, y: event.clientY - bounds.top
    });
    const [left = 0, bottom = 0, right = 612, top = 792] = page.view;
    try {
      const pageBounds={ x: left, y: bottom, width: right - left, height: top - bottom };
      if(tool === "callout"){
        onAddCallout(newCallout({
          id: crypto.randomUUID(),pageIndex,tip,pageBounds
        }));
      }else if(tool==="text"){
        onAddText(newTextBox({
          id: crypto.randomUUID(),pageIndex,location:tip,pageBounds
        }));
      }else{
        onAddNote(newStickyNote({
          id:crypto.randomUUID(),pageIndex,position:tip
        }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cannot place callout.");
    }
  }

  if (!page) return <div className="page-placeholder">Opening page…</div>;
  return (
    <div className="paper-frame" style={{
      width: viewport?.width ?? undefined,
      height: viewport?.height ?? undefined
    }}>
      <canvas ref={canvasRef} className="pdf-canvas" aria-label={"PDF page " + (pageIndex + 1)} />
      {viewport && (
        <svg
          className="annotation-layer"
          width={viewport.width}
          height={viewport.height}
          viewBox={"0 0 " + viewport.width + " " + viewport.height}
          onClick={handlePageClick}
          style={{ cursor: tool !== "select" ? "crosshair" : "default" }}
          aria-label="Page annotation overlay"
        >
          {annotations.filter((annotation) => annotation.pageIndex === pageIndex).map((annotation) => {
            if (annotation.kind === "text") {
              const rect = transformedRect(viewport.transform, annotation.box);
              const selected = selectedAnnotationId === annotation.id;
              return (
                <g key={annotation.id}
                  onClick={event => {event.stopPropagation();onSelect(annotation.id);}}
                  className="annotation-mark">
                  <rect x={rect.x} y={rect.y}
                    width={rect.width} height={rect.height}
                    fill="transparent"
                    stroke={selected ? "#187aff" : "#95a2b1"}
                    strokeDasharray="4 3" strokeWidth={selected ? 2 : 1} />
                  <text x={rect.x+5} y={rect.y+Math.min(18,rect.height-4)}
                    fill={annotation.style.stroke}
                    fontSize={annotation.style.fontSize*zoom}
                    pointerEvents="none">
                    {annotation.text.slice(0,60)}
                  </text>
                </g>
              );
            }
            if (annotation.kind === "note") {
              const point = pdfToViewport(viewport.transform, annotation.position);
              return <g key={annotation.id}
                onClick={(event) => { event.stopPropagation(); onSelect(annotation.id); }}
                className="annotation-mark">
                <circle cx={point.x} cy={point.y} r={8} fill="#fde68a" stroke="#bb6d16" />
              </g>;
            }
            const box = transformedRect(viewport.transform, annotation.box);
            const selected = selectedAnnotationId === annotation.id;
            return (
              <g key={annotation.id}
                onClick={(event) => { event.stopPropagation(); onSelect(annotation.id); }}
                className="annotation-mark"
                opacity={annotation.style.opacity}
              >
                <polyline points={leaderCoordinates(annotation.leader, viewport.transform)}
                  fill="none" stroke={annotation.style.stroke}
                  strokeWidth={annotation.style.lineWidth * zoom}
                  strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={pdfToViewport(viewport.transform, annotation.leader[0]!).x}
                  cy={pdfToViewport(viewport.transform, annotation.leader[0]!).y}
                  r={3} fill={annotation.style.stroke} />
                <rect x={box.x} y={box.y} width={box.width} height={box.height}
                  rx={2} fill={annotation.style.fill}
                  stroke={selected ? "#2574e8" : annotation.style.stroke}
                  strokeWidth={selected ? 2.5 : annotation.style.lineWidth * zoom} />
                <text x={box.x + 6} y={box.y + Math.min(20, box.height - 4)}
                  fontSize={Math.min(15, annotation.style.fontSize * zoom)}
                  fill="#17212c" pointerEvents="none">
                  {annotation.text.length > 38 ? annotation.text.slice(0, 37) + "…" : annotation.text}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {error && <div className="page-render-error" role="alert">{error}</div>}
    </div>
  );
}
