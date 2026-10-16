import { useEffect, useState, useRef, type MouseEvent, type PointerEvent, type KeyboardEvent } from "react";
import {
  newCallout, newTextBox, newStickyNote, pdfToViewport, transformedRect, viewportToPdf,
  relocateMarkupBox, nudgeMarkupBox, resizeMarkupBox,
  positionCalloutHandle,nudgeCalloutHandle,
  makeSymbolAnnotation,symbolTransform,type SymbolTemplate,type SymbolAnnotation,
  type Annotation, type CalloutAnnotation, type TextBoxAnnotation, type StickyNoteAnnotation,
  type MovableBox,type CalloutHandle,type BoxResizeCorner,type Rect,type Matrix,type Point
} from "@axik/document-core";
import { diagnostics } from "@axik/diagnostics";
import type { PdfPage } from "./pdf";
import { budgetCanvas } from "./render-sizing";

export interface PageCanvasProps {
  page: PdfPage | undefined;
  pageIndex: number;
  zoom: number;
  tool: "select" | "callout" | "text" | "note" |
    "rectangle" | "ellipse" | "line" | "symbol";
  symbolTemplate?:SymbolTemplate;
  annotations: readonly Annotation[];
  selectedAnnotationId?: string;
  onSelect: (id: string) => void;
  onAddCallout: (annotation: CalloutAnnotation) => void;
  onAddText: (annotation: TextBoxAnnotation) => void;
  onAddNote: (annotation: StickyNoteAnnotation) => void;
  onAddSymbol: (annotation: SymbolAnnotation) => void;
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
  page, pageIndex, zoom, tool, symbolTemplate, annotations, selectedAnnotationId,
  onSelect, onAddCallout, onAddText, onAddNote, onAddSymbol, onMoveBox,onRendered
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<ViewportInfo>();
  const [error, setError] = useState<string>();
  const [dragPreview, setDragPreview] = useState<MovableBox>();
  const shapeStart=useRef<{
    pointerId:number;
    type:"rect"|"ellipse"|"line";
    start:Point;
  } | undefined>(undefined);
  const [shapePreview,setShapePreview]=useState<{
    type:"rect"|"ellipse"|"line";
    start:Point;end:Point;
  }>();
  type DragAction = {kind:"box"}
    | {kind:"resize";corner:BoxResizeCorner}
    | {kind:"leader";handle:CalloutHandle};
  const dragRef = useRef<{
    pointerId:number;
    start:Point;
    annotation:MovableBox;
    bounds:Rect;
    svg:SVGSVGElement;
    action:DragAction;
    startedAt:number;
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

  function beginDrag(
    event:PointerEvent<SVGElement>,annotation:MovableBox,
    action:DragAction={kind:"box"}
  ){
    if(tool!=="select" || !viewport || !page || event.button!==0 || event.altKey)return;
    if(action.kind==="leader" && annotation.kind!=="callout")return;
    const svg=event.currentTarget.ownerSVGElement;
    if(!svg)return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(annotation.id);
    try{
      dragRef.current={
        pointerId:event.pointerId,
        start:getPdfPoint(svg,event.clientX,event.clientY),
        annotation,bounds:visibleBounds(),svg,action,
        startedAt:performance.now()
      };
      svg.setPointerCapture(event.pointerId);
      setDragPreview(annotation);
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Unable to manipulate markup.");
    }
  }

  function applyGesture(
    info:NonNullable<typeof dragRef.current>,current:Point
  ):MovableBox{
    const delta={
      x:current.x-info.start.x,
      y:current.y-info.start.y
    };
    if(info.action.kind==="resize"){
      return resizeMarkupBox(info.annotation,info.action.corner,delta,info.bounds);
    }
    if(info.action.kind==="leader"){
      if(info.annotation.kind!=="callout"){
        throw new TypeError("Only callouts have leader handles.");
      }
      const a=info.annotation;
      const point=info.action.handle==="tip"
        ?a.leader[0]!
        :a.leader.length===3?a.leader[1]!
          :{x:(a.leader[0]!.x+a.leader[1]!.x)/2,
            y:(a.leader[0]!.y+a.leader[1]!.y)/2};
      return positionCalloutHandle(a,info.action.handle,{
        x:point.x+delta.x,y:point.y+delta.y
      },info.bounds);
    }
    return relocateMarkupBox(info.annotation,delta,info.bounds);
  }

  function currentDrag(svg:SVGSVGElement,clientX:number,clientY:number):MovableBox|undefined {
    const info=dragRef.current;
    if(!info)return undefined;
    return applyGesture(info,getPdfPoint(svg,clientX,clientY));
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
      const before=info.annotation,changed=
        Math.abs(updated.box.x-before.box.x)>0.05 ||
        Math.abs(updated.box.y-before.box.y)>0.05 ||
        Math.abs(updated.box.width-before.box.width)>0.05 ||
        Math.abs(updated.box.height-before.box.height)>0.05 ||
        (updated.kind==="callout" && before.kind==="callout" &&
          JSON.stringify(updated.leader)!==JSON.stringify(before.leader));
      if(changed){
        onMoveBox({...updated,updatedAt:new Date().toISOString()});
        diagnostics.record("annotation","ANNOTATION_UPDATED","info",{
          durationMs:performance.now()-info.startedAt
        });
      }
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Could not commit annotation move.");
    }
  }

  function currentDragFromEnd(
    info:NonNullable<typeof dragRef.current>,
    svg:SVGSVGElement,clientX:number,clientY:number
  ):MovableBox{
    const current=getPdfPoint(svg,clientX,clientY);
    return applyGesture(info,current);
  }

  function keyboardMove(event:KeyboardEvent<SVGElement>,annotation:MovableBox,
    action:DragAction={kind:"box"}){
    if(tool!=="select"||!page)return;
    const direction={
      ArrowLeft:"left",ArrowRight:"right",ArrowUp:"up",ArrowDown:"down"
    }[event.key] as "left"|"right"|"up"|"down"|undefined;
    if(!direction)return;
    event.preventDefault();
    event.stopPropagation();
    try{
      const bounds=visibleBounds();
      const size=event.shiftKey?10:1;
      const delta={
        left:{x:-size,y:0},right:{x:size,y:0},
        up:{x:0,y:size},down:{x:0,y:-size}
      }[direction];
      const moved=action.kind==="resize"
        ?resizeMarkupBox(annotation,action.corner,delta,bounds)
        :action.kind==="leader" && annotation.kind==="callout"
          ?nudgeCalloutHandle(annotation,action.handle,bounds,direction,event.shiftKey)
          :nudgeMarkupBox(annotation,bounds,direction,event.shiftKey);
      if(JSON.stringify(moved.box)!==JSON.stringify(annotation.box) ||
        (moved.kind==="callout" && annotation.kind==="callout" &&
          JSON.stringify(moved.leader)!==JSON.stringify(annotation.leader))){
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
      const drag=dragRef.current;
      if(drag?.svg.hasPointerCapture(drag.pointerId)){
        drag.svg.releasePointerCapture(drag.pointerId);
      }
      dragRef.current=undefined;
      setDragPreview(undefined);
      if(previewFrame.current!==undefined)cancelAnimationFrame(previewFrame.current);
    };
    document.addEventListener("keydown",onKey);
    return ()=>document.removeEventListener("keydown",onKey);
  },[]);


  function markupControlHandles(value:MovableBox){
    if(!viewport || tool!=="select" || selectedAnnotationId!==value.id)return null;
    const box=value.box;
    const corners:ReadonlyArray<{
      kind:BoxResizeCorner;
      point:Point;
    }>=[
      {kind:"north-west",point:{x:box.x,y:box.y+box.height}},
      {kind:"north-east",point:{x:box.x+box.width,y:box.y+box.height}},
      {kind:"south-west",point:{x:box.x,y:box.y}},
      {kind:"south-east",point:{x:box.x+box.width,y:box.y}}
    ];
    return <g className="markup-grips" data-editing={value.kind}>
      {corners.map(({kind,point})=>{
        const at=pdfToViewport(viewport.transform,point);
        const action:DragAction={kind:"resize",corner:kind};
        return <circle key={kind}
          data-grip={"resize-"+kind}
          cx={at.x} cy={at.y} r={6}
          role="button" tabIndex={0}
          aria-label={"Resize "+(value.kind==="callout"?"callout":"text")+" "+kind}
          className="markup-control-handle markup-resize-handle"
          onPointerDown={event=>beginDrag(event,value,action)}
          onKeyDown={event=>keyboardMove(event,value,action)}
        />;
      })}
      {value.kind==="callout" && (["tip","elbow"] as const).map(handle=>{
        const point=handle==="tip"
          ?value.leader[0]!
          :value.leader.length===3?value.leader[1]!
            :{
              x:(value.leader[0]!.x+value.leader[1]!.x)/2,
              y:(value.leader[0]!.y+value.leader[1]!.y)/2
            };
        const position=pdfToViewport(viewport.transform,point);
        const action:DragAction={kind:"leader",handle};
        return <circle key={handle}
          data-grip={"leader-"+handle}
          cx={position.x} cy={position.y} r={7}
          role="button" tabIndex={0}
          aria-label={handle==="tip"?"Move callout arrow tip":"Move callout elbow"}
          className={"markup-control-handle markup-"+handle+"-handle"}
          onPointerDown={event=>beginDrag(event,value,action)}
          onKeyDown={event=>keyboardMove(event,value,action)}
        />;
      })}
    </g>;
  }


  function shapePointerDown(event:PointerEvent<SVGSVGElement>){
    if(!page||!viewport || !["rectangle","ellipse","line"].includes(tool) ||
       event.altKey || event.button!==0)return;
    event.preventDefault();
    event.stopPropagation();
    try{
      const start=getPdfPoint(event.currentTarget,event.clientX,event.clientY);
      const type=tool==="rectangle"?"rect":tool as "ellipse"|"line";
      shapeStart.current={pointerId:event.pointerId,type,start};
      event.currentTarget.setPointerCapture(event.pointerId);
      setShapePreview({type,start,end:start});
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Cannot start vector shape.");
    }
  }

  function shapePointerMove(event:PointerEvent<SVGSVGElement>){
    const state=shapeStart.current;
    if(!state||state.pointerId!==event.pointerId)return;
    event.preventDefault();
    try{
      const end=getPdfPoint(event.currentTarget,event.clientX,event.clientY);
      setShapePreview({type:state.type,start:state.start,end});
    }catch{/* cursor is outside drawable page */}
  }

  function shapePointerEnd(event:PointerEvent<SVGSVGElement>,commit:boolean){
    const state=shapeStart.current;
    if(!state||state.pointerId!==event.pointerId)return;
    event.preventDefault();
    event.stopPropagation();
    shapeStart.current=undefined;
    setShapePreview(undefined);
    if(event.currentTarget.hasPointerCapture(event.pointerId)){
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if(!commit)return;
    try{
      const end=getPdfPoint(event.currentTarget,event.clientX,event.clientY);
      const dx=end.x-state.start.x,dy=end.y-state.start.y;
      if(Math.hypot(dx,dy)<4)return; // no stray tiny mouse-click objects
      const x=Math.min(state.start.x,end.x);
      const y=Math.min(state.start.y,end.y);
      const width=Math.max(5,Math.abs(dx));
      const height=Math.max(5,Math.abs(dy));
      const primitive={
        id:crypto.randomUUID(),type:state.type,
        x:state.type==="line"?state.start.x-x:0,
        y:state.type==="line"?state.start.y-y:0,
        width:state.type==="line"?dx:width,
        height:state.type==="line"?dy:height,
        stroke:"#ce5638",fill:state.type==="line"?"none":"none",
        lineWidth:1.5
      } as const;
      const template:SymbolTemplate={
        version:1,id:"axik-basic-"+state.type,
        name:state.type==="rect"?"Rectangle":
          state.type==="ellipse"?"Ellipse":"Line",
        primitives:[primitive]
      };
      const annotation=makeSymbolAnnotation(
        template,{x,y},visibleBounds(),crypto.randomUUID()
      );
      onAddSymbol({...annotation,pageIndex});
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Could not add shape.");
    }
  }

  function handlePageClick(event: MouseEvent<SVGSVGElement>) {
    if (!page || !viewport || (tool !== "callout" && tool !== "text" &&
      tool !== "note" && tool !== "symbol") || event.altKey) return;
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
      }else if(tool==="note"){
        onAddNote(newStickyNote({
          id:crypto.randomUUID(),pageIndex,position:tip
        }));
      }else if(tool==="symbol" && symbolTemplate){
        onAddSymbol({...makeSymbolAnnotation(
          symbolTemplate,tip,pageBounds,crypto.randomUUID()
        ),pageIndex});
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
          onPointerDown={shapePointerDown}
          onPointerMove={event=>{pointerMove(event);shapePointerMove(event);}}
          onPointerUp={event=>{endDrag(event,true);shapePointerEnd(event,true);}}
          onPointerCancel={event=>{endDrag(event,false);shapePointerEnd(event,false);}}
          style={{ cursor: tool !== "select" ? "crosshair" : "default" }}
          aria-label="Page annotation overlay"
        >
          {annotations.filter((item) => item.pageIndex === pageIndex).map((item) => {
            const annotation:Annotation = dragPreview?.id===item.id ? dragPreview : item;
            const isDragging=Boolean(dragPreview?.id===item.id);
            // PDF.js already paints imported native appearances underneath.
            // Keep the edit handle faint until the document is exported again.
            const imported=Boolean(annotation.sourceName);
            if(annotation.kind==="symbol"){
              const selected=selectedAnnotationId===annotation.id;
              const {box}=annotation;
              const t=symbolTransform(annotation);
              const pdf=viewport.transform;
              const group="matrix("+pdf.join(" ")+") translate("+
                box.x+" "+box.y+") matrix("+
                [t.a,t.b,t.c,t.d,t.e,t.f].join(" ")+")";
              const rect=transformedRect(viewport.transform,box);
              return <g key={annotation.id}
                className="annotation-mark"
                opacity={selected||isDragging?1:imported?.15:1}
                onClick={event=>{event.stopPropagation();onSelect(annotation.id);}}>
                <g transform={group} pointerEvents="none">
                  {annotation.primitives.map(p=>
                    p.type==="rect"
                      ?<rect key={p.id} x={p.x} y={p.y} width={p.width}
                        height={p.height} fill={p.fill} stroke={p.stroke}
                        strokeWidth={p.lineWidth}/>
                      :p.type==="ellipse"
                        ?<ellipse key={p.id} cx={p.x+p.width/2}
                          cy={p.y+p.height/2} rx={p.width/2} ry={p.height/2}
                          fill={p.fill} stroke={p.stroke}
                          strokeWidth={p.lineWidth}/>
                        :<line key={p.id} x1={p.x} y1={p.y}
                          x2={p.x+p.width} y2={p.y+p.height}
                          stroke={p.stroke} strokeWidth={p.lineWidth}/>
                  )}
                </g>
                <rect x={rect.x} y={rect.y} width={rect.width}
                  height={rect.height} fill="transparent"
                  stroke={selected?"#2670e8":"transparent"}
                  strokeWidth={selected?2:0}
                  strokeDasharray="6 3" role="button" tabIndex={0}
                  aria-label={"Move symbol on page "+(pageIndex+1)}
                  className="markup-drag-box"
                  onPointerDown={event=>beginDrag(event,annotation)}
                  onKeyDown={event=>keyboardMove(event,annotation)}/>
                {markupControlHandles(annotation)}
              </g>;
            }
            if (annotation.kind === "text") {
              const rect = transformedRect(viewport.transform, annotation.box);
              const selected = selectedAnnotationId === annotation.id;
              return (
                <g key={annotation.id}
                  onClick={event => {event.stopPropagation();onSelect(annotation.id);}}
                  className="annotation-mark" opacity={selected || isDragging ? 1 : imported ? 0.12 : 1}>
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
                  {markupControlHandles(annotation)}
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
                opacity={selected || isDragging ? annotation.style.opacity : imported ? 0.12 : annotation.style.opacity}
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
                {markupControlHandles(annotation)}
              </g>
            );
          })}
          {shapePreview && (()=>{
            const start=pdfToViewport(viewport.transform,shapePreview.start);
            const end=pdfToViewport(viewport.transform,shapePreview.end);
            const x=Math.min(start.x,end.x),y=Math.min(start.y,end.y);
            const w=Math.abs(end.x-start.x),h=Math.abs(end.y-start.y);
            return shapePreview.type==="line"
              ?<line className="drawing-preview" x1={start.x} y1={start.y}
                x2={end.x} y2={end.y} stroke="#ce5638"
                strokeWidth={1.5}/>
              :shapePreview.type==="ellipse"
                ?<ellipse className="drawing-preview"
                  cx={x+w/2} cy={y+h/2} rx={w/2} ry={h/2}
                  fill="none" stroke="#ce5638" strokeWidth={1.5}/>
                :<rect className="drawing-preview" x={x} y={y}
                  width={w} height={h} fill="none"
                  stroke="#ce5638" strokeWidth={1.5}/>;
          })()}
        </svg>
      )}
      {error && <div className="page-render-error" role="alert">{error}</div>}
    </div>
  );
}
