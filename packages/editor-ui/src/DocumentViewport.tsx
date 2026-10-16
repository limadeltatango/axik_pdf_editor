import {
  useCallback,useEffect,useMemo,useRef,useState
} from "react";
import type {
  Annotation,CalloutAnnotation,TextBoxAnnotation,StickyNoteAnnotation,MovableBox,
  SymbolAnnotation,SymbolTemplate
} from "@axik/document-core";
import {diagnostics} from "@axik/diagnostics";
import type {PdfDocument,PdfPage} from "./pdf";
import {PageCanvas} from "./PageCanvas";
import {
  MAX_ACTIVE_VIEW_PAGES,groupVisiblePages,isContinuous,isTwoUp,
  spreadForPage,type ViewMode
} from "./view-layout";
import {
  anchoredScrollDelta,nextPointerZoom,panScrollPosition,
  type CursorAnchor
} from "./pan-zoom";

export interface DocumentViewportProps {
  pdf:PdfDocument;
  pageNumber:number;
  /** Increment only for explicit navigation, not when user scrolls. */
  navigationToken:number;
  mode:ViewMode;
  coverAlone:boolean;
  zoom:number;
  onZoomChange:(nextZoom:number)=>void;
  tool:"select"|"callout"|"text"|"note"|
    "rectangle"|"ellipse"|"line"|"symbol";
  symbolTemplate?:SymbolTemplate;
  annotations:readonly Annotation[];
  selectedAnnotationId?:string;
  onSelect:(id:string)=>void;
  onAddCallout:(value:CalloutAnnotation)=>void;
  onAddText:(value:TextBoxAnnotation)=>void;
  onAddNote:(value:StickyNoteAnnotation)=>void;
  onAddSymbol:(value:SymbolAnnotation)=>void;
  onMoveBox:(value:MovableBox)=>void;
  onVisiblePage:(index:number)=>void;
  onViewportResize:(width:number,height:number)=>void;
  onRendered?:(pageIndex:number)=>void;
}

interface SlotProps extends Pick<DocumentViewportProps,
  "pdf"|"zoom"|"tool"|"annotations"|"selectedAnnotationId"|
  "onSelect"|"onAddCallout"|"onAddText"|"onAddNote"|"onAddSymbol"|
  "symbolTemplate"|"onMoveBox"|"onRendered"> {
  pageNumber:number;
  enabled:boolean;
  fallbackSize:{width:number;height:number};
}

/**
 * Never rasterize an entire large document. An enabled slot holds one PDF.js
 * canvas. Slots more than two spreads away become placeholders with identical
 * dimensions; the PDF worker and original bytes remain open.
 */
function PageSlot({
  pdf,pageNumber,enabled,zoom,fallbackSize,...events
}:SlotProps){
  const [page,setPage]=useState<PdfPage>();
  const [dimensions,setDimensions]=useState<{width:number;height:number}>();
  const [error,setError]=useState<string>();
  useEffect(()=>{
    if(!enabled){setPage(undefined);return;}
    let active=true;
    const started=performance.now();
    diagnostics.record("document","PDF_PAGE_LOAD_START","info",{
      pageIndex:pageNumber-1
    });
    pdf.getPage(pageNumber).then(next=>{
      if(!active)return;
      const v=next.getViewport({scale:zoom});
      setDimensions({width:v.width,height:v.height});
      setPage(next);
      setError(undefined);
      diagnostics.record("document","PDF_PAGE_LOAD_OK","info",{
        pageIndex:pageNumber-1,durationMs:performance.now()-started
      });
    }).catch(reason=>{
      if(!active)return;
      setError("Page "+pageNumber+" could not load.");
      diagnostics.recordError("document","PDF_PAGE_LOAD_FAILED",reason,{
        pageIndex:pageNumber-1
      });
    });
    return ()=>{active=false};
  },[pdf,pageNumber,enabled]);

  useEffect(()=>{
    if(page){
      const view=page.getViewport({scale:zoom});
      setDimensions({width:view.width,height:view.height});
    }
  },[page,zoom]);

  const size=dimensions??fallbackSize;
  return <div className="view-page-slot"
    data-page-number={pageNumber}
    style={{minWidth:Math.max(100,size.width),minHeight:Math.max(100,size.height)}}>
    {enabled && page?
      <PageCanvas page={page} pageIndex={pageNumber-1} zoom={zoom}
        tool={events.tool}
        symbolTemplate={events.symbolTemplate}
        annotations={events.annotations}
        selectedAnnotationId={events.selectedAnnotationId}
        onSelect={events.onSelect}
        onAddCallout={events.onAddCallout}
        onAddText={events.onAddText}
        onAddNote={events.onAddNote}
        onAddSymbol={events.onAddSymbol}
        onMoveBox={events.onMoveBox}
        onRendered={events.onRendered}/>:
      <div className="view-page-skeleton"
        style={{width:Math.max(100,size.width),height:Math.max(100,size.height)}}
        aria-label={"Page "+pageNumber+" preview placeholder"}>
        {error??"Page "+pageNumber}
      </div>}
  </div>;
}

export function DocumentViewport(props:DocumentViewportProps){
  const {
    pdf,pageNumber,navigationToken,mode,coverAlone,zoom,onZoomChange,
    annotations,selectedAnnotationId,onVisiblePage,onViewportResize,
    ...events
  }=props;
  const rootRef=useRef<HTMLDivElement>(null);
  const scrollFrame=useRef<number | undefined>(undefined);
  const previousZoom=useRef(zoom);
  const currentZoom=useRef(zoom);
  currentZoom.current=zoom;
  const zoomPending=useRef<CursorAnchor>();
  const panPending=useRef<{
    pointerId:number;startX:number;startY:number;
    left:number;top:number;
  }>();
  const [isPanning,setIsPanning]=useState(false);
  const continuous=isContinuous(mode),twoUp=isTwoUp(mode);

  const singleAnchor=continuous?0:pageNumber;
  const groups=useMemo(()=>{
    if(continuous)return groupVisiblePages(pdf.numPages,mode,coverAlone);
    return [spreadForPage(singleAnchor,pdf.numPages,mode,coverAlone)];
  },[pdf,mode,coverAlone,continuous,singleAnchor]);

  const firstGroupIndex=useMemo(()=>{
    const i=groups.findIndex(group=>group.includes(pageNumber));
    return Math.max(0,i);
  },[groups,pageNumber]);

  const [focusGroup,setFocusGroup]=useState(firstGroupIndex);
  const [referenceSize,setReferenceSize]=useState({width:612*zoom,height:792*zoom});

  useEffect(()=>{
    let active=true;
    pdf.getPage(1).then(page=>{
      if(!active)return;
      const v=page.getViewport({scale:zoom});
      setReferenceSize({width:v.width,height:v.height});
    }).catch(()=>undefined);
    return ()=>{active=false};
  },[pdf]);

  useEffect(()=>{
    const factor=zoom/Math.max(.01,previousZoom.current);
    previousZoom.current=zoom;
    if(Math.abs(factor-1)>0.0001){
      setReferenceSize(size=>({
        width:size.width*factor,height:size.height*factor
      }));
    }
  },[zoom]);

  useEffect(()=>{
    const root=rootRef.current;
    if(!root)return;
    const observer=new ResizeObserver(entries=>{
      const rect=entries[0]?.contentRect;
      if(rect && rect.width>0 && rect.height>0){
        onViewportResize(rect.width,rect.height);
      }
    });
    observer.observe(root);
    return ()=>observer.disconnect();
  },[onViewportResize]);

  const scan=useCallback(()=>{
    const root=rootRef.current;
    if(!root||!continuous)return;
    const rows=root.querySelectorAll<HTMLElement>("[data-view-row]");
    if(!rows.length)return;
    // Avoid a forced layout read on EVERY row at 60 fps. The view-content
    // establishes the offset parent; binary search needs O(log N) geometry
    // reads even on a thousand-page drawing set.
    const target=root.scrollTop+Math.min(100,root.clientHeight/5);
    let low=0,high=rows.length-1,best=0;
    while(low<=high){
      const mid=Math.floor((low+high)/2);
      const row=rows[mid]!;
      const top=row.offsetTop;
      const bottom=top+row.offsetHeight;
      best=mid;
      if(target<top)high=mid-1;
      else if(target>=bottom)low=mid+1;
      else break;
    }
    const group=groups[best];
    if(!group)return;
    setFocusGroup(prev=>prev===best?prev:best);
    onVisiblePage(group[0]!);
  },[continuous,groups,onVisiblePage]);


  // Ctrl+wheel zooms at cursor, plain wheel scrolls.
  // Attaching a native non-passive listener guarantees the browser's default
  // Ctrl+wheel page zoom is suppressed inside the document viewport only.
  useEffect(()=>{
    const root=rootRef.current;
    if(!root)return;
    const onWheel=(event:WheelEvent)=>{
      if(!event.ctrlKey)return;
      event.preventDefault();
      event.stopPropagation();
      const next=nextPointerZoom(currentZoom.current,event.deltaY,event.deltaMode);
      if(Math.abs(next-currentZoom.current)<.0005)return;
      const candidate=document.elementFromPoint(event.clientX,event.clientY);
      const slot=candidate?.closest?.(".view-page-slot") as HTMLElement|null;
      const selected=slot && root.contains(slot)
        ?slot
        :root.querySelector<HTMLElement>('[data-page-number="'+pageNumber+'"]');
      const rect=selected?.getBoundingClientRect();
      if(selected && rect && rect.width>0 && rect.height>0){
        zoomPending.current={
          pageNumber:Number(selected.dataset.pageNumber??pageNumber),
          ratioX:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),
          ratioY:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)),
          clientX:event.clientX,clientY:event.clientY
        };
      }else zoomPending.current=undefined;
      currentZoom.current=next;
      onZoomChange(next);
    };
    root.addEventListener("wheel",onWheel,{passive:false});
    return ()=>root.removeEventListener("wheel",onWheel);
  },[pageNumber,onZoomChange]);

  // The slot's size updates after PDF.js viewport recalculation. Allow two
  // frames for React layout and adjust scroll to put the SAME PDF point under
  // the mouse, including in side-by-side and continuous modes.
  useEffect(()=>{
    const pending=zoomPending.current;
    const root=rootRef.current;
    if(!root||!pending)return;
    let first=0,second=0;
    first=requestAnimationFrame(()=>{
      second=requestAnimationFrame(()=>{
        const slot=root.querySelector<HTMLElement>(
          '[data-page-number="'+pending.pageNumber+'"]'
        );
        if(slot){
          const rect=slot.getBoundingClientRect();
          root.scrollLeft+=anchoredScrollDelta(
            pending.clientX,rect.left,rect.width,pending.ratioX
          );
          root.scrollTop+=anchoredScrollDelta(
            pending.clientY,rect.top,rect.height,pending.ratioY
          );
        }
        zoomPending.current=undefined;
      });
    });
    return ()=>{cancelAnimationFrame(first);cancelAnimationFrame(second)};
  },[zoom]);

  function panStart(event:React.PointerEvent<HTMLDivElement>){
    // Alt+left drag only; explicitly do NOT bind middle button or Space.
    if(!event.altKey || event.button!==0 || panPending.current)return;
    const root=rootRef.current;
    if(!root)return;
    event.preventDefault();
    event.stopPropagation();
    panPending.current={
      pointerId:event.pointerId,
      startX:event.clientX,startY:event.clientY,
      left:root.scrollLeft,top:root.scrollTop
    };
    root.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function panMove(event:React.PointerEvent<HTMLDivElement>){
    const state=panPending.current;
    const root=rootRef.current;
    if(!state||!root||state.pointerId!==event.pointerId)return;
    event.preventDefault();
    event.stopPropagation();
    const position=panScrollPosition(
      {left:state.left,top:state.top},
      {x:event.clientX-state.startX,y:event.clientY-state.startY}
    );
    root.scrollLeft=position.left;
    root.scrollTop=position.top;
  }

  function panEnd(event:React.PointerEvent<HTMLDivElement>){
    const state=panPending.current,root=rootRef.current;
    if(!state||!root||state.pointerId!==event.pointerId)return;
    event.preventDefault();
    event.stopPropagation();
    panPending.current=undefined;
    if(root.hasPointerCapture(event.pointerId)){
      root.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
  }

  const onScroll=useCallback(()=>{
    if(!continuous)return;
    if(scrollFrame.current!==undefined)cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current=requestAnimationFrame(()=>{
      scrollFrame.current=undefined;
      scan();
    });
  },[continuous,scan]);

  useEffect(()=>()=>{
    if(scrollFrame.current!==undefined)cancelAnimationFrame(scrollFrame.current);
  },[]);

  // Keep layout/page changes stable; changing mode shouldn't jump to page one.
  useEffect(()=>{
    setFocusGroup(firstGroupIndex);
    if(!continuous)return;
    const root=rootRef.current;
    if(!root)return;
    const anchor=root.querySelector<HTMLElement>(
      '[data-view-row="'+firstGroupIndex+'"]'
    );
    anchor?.scrollIntoView({block:"start",behavior:"instant"});
  },[pdf,mode,coverAlone,continuous]);

  // Only *explicit* previous/next, page entry and sidebar navigations scroll.
  // Scrolling manually updates the page indicator without feedback loops.
  useEffect(()=>{
    if(!continuous)return;
    const root=rootRef.current;
    if(!root)return;
    const groupIndex=Math.max(0,groups.findIndex(g=>g.includes(pageNumber)));
    setFocusGroup(groupIndex);
    root.querySelector<HTMLElement>(
      '[data-view-row="'+groupIndex+'"]'
    )?.scrollIntoView({block:"start",behavior:"instant"});
  },[navigationToken]);

  // IntersectionObserver gives progressive rasterization a second path if
  // scroll events are throttled or a page becomes visible after resizing.
  useEffect(()=>{
    const root=rootRef.current;
    if(!root||!continuous||typeof IntersectionObserver==="undefined")return;
    const observer=new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting))return;
      if(scrollFrame.current!==undefined)cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current=requestAnimationFrame(()=>{
        scrollFrame.current=undefined;scan();
      });
    },{root,rootMargin:"120px 0px",threshold:0});
    root.querySelectorAll("[data-view-row]").forEach(row=>observer.observe(row));
    return ()=>observer.disconnect();
  },[continuous,groups,scan]);

  const maxGroups=Math.max(1,Math.floor(MAX_ACTIVE_VIEW_PAGES/(twoUp?2:1)));
  const range=Math.floor((maxGroups-1)/2);
  const effectiveGroup=continuous?focusGroup:0;

  return <div ref={rootRef}
    className={"document-viewport view-scroll view-mode-"+mode+
      (isPanning?" is-panning":"")}
    data-view-mode={mode}
    onPointerDownCapture={panStart}
    onPointerMoveCapture={panMove}
    onPointerUpCapture={panEnd}
    onPointerCancelCapture={panEnd}
    onScroll={onScroll}
    aria-label="PDF document viewport"
    role="region" tabIndex={0}>
    <div className="view-content">
      {groups.map((group,rowIndex)=>{
        const rendered=!continuous || Math.abs(effectiveGroup-rowIndex)<=range;
        return <div key={group.join("-")}
          className={"view-row"+(twoUp?" view-row-two":"")}
          data-view-row={rowIndex}
          data-rendered={rendered?"true":"false"}>
          {group.map(number=><PageSlot key={number}
            pdf={pdf} pageNumber={number} enabled={rendered}
            zoom={zoom} tool={events.tool}
            symbolTemplate={events.symbolTemplate}
            fallbackSize={referenceSize}
            annotations={annotations}
            selectedAnnotationId={selectedAnnotationId}
            onSelect={events.onSelect}
            onAddCallout={events.onAddCallout}
            onAddText={events.onAddText}
            onAddNote={events.onAddNote}
            onAddSymbol={events.onAddSymbol}
            onMoveBox={events.onMoveBox}
            onRendered={events.onRendered}/>)}
        </div>;
      })}
      <p className="workspace-tip">
        {events.tool==="callout"?"Click where the callout arrow should point.":
          events.tool==="text"?"Click to place editable text.":
          events.tool==="note"?"Click to leave a comment.":
          events.tool==="symbol"?"Click to place the selected grouped symbol.":
          ["rectangle","ellipse","line"].includes(events.tool)
            ?"Drag on the page to draw a vector "+events.tool+".":
          "Alt + left-drag to pan; Ctrl + wheel to zoom at pointer. Select a markup to move/resize its box or leader grips."
      </p>
    </div>
  </div>;
}
