import { useEffect, useState, useRef, type MouseEvent, type PointerEvent, type KeyboardEvent } from "react";
import {
  newCallout, newTextBox, newStickyNote, pdfToViewport, transformedRect, viewportToPdf,
  relocateMarkupBox, nudgeMarkupBox,
  type Annotation, type CalloutAnnotation, type TextBoxAnnotation, type StickyNoteAnnotation, type MovableBox, type Rect, type Matrix, type Point
} from "@axik/document-core";
import { diagnostics } from "@axik/diagnostics";
import type { PdfPage } from "./pdf";
import { budgetCanvas } from "./render-sizing";

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
  /** Commit after pointer up or keyboard nudge; one Undo entry per move. */
  onMoveBox: (annotation: MovableBox) => void;
  onRendered?: (pageIndex:number)=>void;
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
  onSelect, onAddCallout, onAddText, onAddNote, onMoveBox,onRendered
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<ViewportInfo>();
  const [error, setError] = useState<string>();
  const [dragPreview, setDragPreview] = useState<MovableBox>();
  const dragRef = useRef<{
    pointerId:number;
    start:Point;
    annotation:MovableBox;
    bounds:Rect;
  } | undefined>(undefined);
  const previewFrame = useRef<number | undefined>(undefined);

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
      const {ratio,backingWidth,backingHeight}=budgetCanvas(
        view.width,view.height,window.devicePixelRatio||1
      );
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas 2D is unavailable.");
      canvas.width = backingWidth;
      canvas.height = backingHeight;
      canvas.style.width = String(view.width) + "px";
      canvas.style.height = String(view.height) + "px";
      const renderStarted = performance.now();
      diagnostics.record("render", "PDF_RENDER_START", "info", {
        pageIndex, zoomPercent: zoom * 100
      });
      const task = page.render({
        canvas,
        canvasContext: context,
        viewport: view,
        transform:[ratio,0,0,ratio,0,0],
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
          onRendered?.(pageIndex);
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


  function getPdfPoint(svg:SVGSVGElement,clientX:number,clientY:number):Point {
    if(!viewport)throw new Error("PDF page transform is not ready.");
    const rect=svg.getBoundingClientRect();
    return viewportToPdf(viewport.transform,{
      x:(clientX-rect.left)*viewport.width/rect.width,
      y:(clientY-rect.top)*viewport.height/rect.height
    });
  }

  function visibleBounds():Rect {
    if(!page)throw new Error("PDF page not available.");
    const [left=0,bottom=0,right=612,top=792]=page.view;
    return {x:left,y:bottom,width:right-left,height:top-bottom};
  }

  function beginDrag(event:PointerEvent<SVGRectElement>,annotation:MovableBox){
    if(tool!=="select" || !viewport || !page || event.button!==0)return;
    const svg=event.currentTarget.ownerSVGElement;
    if(!svg)return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(annotation.id);
    try{
      dragRef.current={
        pointerId:event.pointerId,
        start:getPdfPoint(svg,event.clientX,event.clientY),
        annotation,bounds:visibleBounds()
      };
      svg.setPointerCapture(event.pointerId);
      setDragPreview(annotation);
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Unable to move annotation.");
    }
  }

  function currentDrag(svg:SVGSVGElement,clientX:number,clientY:number):MovableBox|undefined {
    const info=dragRef.current;
    if(!info)return undefined;
    const current=getPdfPoint(svg,clientX,clientY);
    return relocateMarkupBox(info.annotation,{
      x:current.x-info.start.x,
      y:current.y-info.start.y
    },info.bounds);
  }

  function pointerMove(event:PointerEvent<SVGSVGElement>){
    if(!dragRef.current || dragRef.current.pointerId!==event.pointerId)return;
    event.preventDefault();
    if(previewFrame.current!==undefined)cancelAnimationFrame(previewFrame.current);
    const svg=event.currentTarget;
    // Coalesce fast pointer movement to one lightweight SVG update per frame.
    const {clientX,clientY}=event;
    previewFrame.current=requestAnimationFrame(()=>{
      previewFrame.current=undefined;
      try{
        const moved=currentDrag(svg,clientX,clientY);
        if(moved)setDragPreview(moved);
      }catch{/* stale pointer or disposed page cancels on pointerup */}
    });
  }

  function endDrag(event:PointerEvent<SVGSVGElement>,commit:boolean){
    const info=dragRef.current;
    if(!info||event.pointerId!==info.pointerId)return;
    event.stopPropagation();
    if(previewFrame.current!==undefined){
      cancelAnimationFrame(previewFrame.current);
      previewFrame.current=undefined;
    }
    dragRef.current=undefined;
    if(event.currentTarget.hasPointerCapture(event.pointerId)){
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragPreview(undefined);
    if(!commit)return;
    try{
      const updated=currentDragFromEnd(info,event.currentTarget,event.clientX,event.clientY);
      const moved=Math.abs(updated.box.x-info.annotation.box.x)>0.05 ||
        Math.abs(updated.box.y-info.annotation.box.y)>0.05;
      if(moved)onMoveBox({...updated,updatedAt:new Date().toISOString()});
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Could not commit annotation move.");
    }
  }

  function currentDragFromEnd(
    info:NonNullable<typeof dragRef.current>,
    svg:SVGSVGElement,clientX:number,clientY:number
  ):MovableBox{
    const current=getPdfPoint(svg,clientX,clientY);
    return relocateMarkupBox(info.annotation,{
      x:current.x-info.start.x,
      y:current.y-info.start.y
    },info.bounds);
  }

  function keyboardMove(event:KeyboardEvent<SVGRectElement>,annotation:MovableBox){
    if(tool!=="select"||!page)return;
    const direction={
      ArrowLeft:"left",ArrowRight:"right",ArrowUp:"up",ArrowDown:"down"
    }[event.key] as "left"|"right"|"up"|"down"|undefined;
    if(!direction)return;
    event.preventDefault();
    event.stopPropagation();
    try{
      const moved=nudgeMarkupBox(annotation,visibleBounds(),direction,event.shiftKey);
      if(moved.box.x!==annotation.box.x || moved.box.y!==annotation.box.y){
        onMoveBox({...moved,updatedAt:new Date().toISOString()});
      }
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Cannot nudge the markup.");
    }
  }

  useEffect(()=>{
    return ()=>{
      if(previewFrame.current!==undefined)cancelAnimationFrame(previewFrame.current);
    };
  },[]);

  useEffect(()=>{
    const onKey=(event:globalThis.KeyboardEvent)=>{
      if(event.key!=="Escape"||!dragRef.current)return;
      dragRef.current=undefined;
      setDragPreview(undefined);
      if(previewFrame.current!==undefined)cancelAnimationFrame(previewFrame.current);
    };
    document.addEventListener("keydown",onKey);
    return ()=>document.removeEventListener("keydown",onKey);
  },[]);

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
          onPointerMove={pointerMove}
          onPointerUp={event=>endDrag(event,true)}
          onPointerCancel={event=>endDrag(event,false)}
          style={{ cursor: tool !== "select" ? "crosshair" : "default" }}
          aria-label="Page annotation overlay"
        >
          {annotations.filter((item) => item.pageIndex === pageIndex).map((item) => {
            const annotation:Annotation = dragPreview?.id===item.id ? dragPreview : item;
            const isDragging=Boolean(dragPreview?.id===item.id);
            // PDF.js already paints imported native appearances underneath.
            // Keep the edit handle faint until the document is exported again.
            const imported=Boolean(annotation.sourceName);
            if (annotation.kind === "text") {
              const rect = transformedRect(viewport.transform, annotation.box);
              const selected = selectedAnnotationId === annotation.id;
              return (
                <g key={annotation.id}
                  onClick={event => {event.stopPropagation();onSelect(annotation.id);}}
                  className="annotation-mark" opacity={isDragging ? 0.9 : imported ? 0.12 : 1}>
                  <rect x={rect.x} y={rect.y}
                    width={rect.width} height={rect.height}
                    role="button" tabIndex={0}
                    aria-label={"Move text box on page "+(pageIndex+1)}
                    onPointerDown={event=>beginDrag(event,annotation)}
                    onKeyDown={event=>keyboardMove(event,annotation)}
                    className="markup-drag-box"
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
                opacity={isDragging ? annotation.style.opacity : imported ? 0.12 : annotation.style.opacity}
              >
                <polyline points={leaderCoordinates(annotation.leader, viewport.transform)}
                  fill="none" stroke={annotation.style.stroke}
                  strokeWidth={annotation.style.lineWidth * zoom}
                  strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={pdfToViewport(viewport.transform, annotation.leader[0]!).x}
                  cy={pdfToViewport(viewport.transform, annotation.leader[0]!).y}
                  r={3} fill={annotation.style.stroke} />
                <rect x={box.x} y={box.y} width={box.width} height={box.height}
                  role="button" tabIndex={0}
                  aria-label={"Move callout box on page "+(pageIndex+1)}
                  onPointerDown={event=>beginDrag(event,annotation)}
                  onKeyDown={event=>keyboardMove(event,annotation)}
                  className="markup-drag-box"
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
