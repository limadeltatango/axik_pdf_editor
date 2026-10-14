import {
  useCallback,useEffect,useMemo,useRef,useState
} from "react";
import type {
  Annotation,CalloutAnnotation,TextBoxAnnotation,StickyNoteAnnotation,MovableBox
} from "@axik/document-core";
import {diagnostics} from "@axik/diagnostics";
import type {PdfDocument,PdfPage} from "./pdf";
import {PageCanvas} from "./PageCanvas";
import {
  MAX_ACTIVE_VIEW_PAGES,groupVisiblePages,isContinuous,isTwoUp,
  spreadForPage,type ViewMode
} from "./view-layout";

export interface DocumentViewportProps {
  pdf:PdfDocument;
  pageNumber:number;
  /** Increment only for explicit navigation, not when user scrolls. */
  navigationToken:number;
  mode:ViewMode;
  coverAlone:boolean;
  zoom:number;
  tool:"select"|"callout"|"text"|"note";
  annotations:readonly Annotation[];
  selectedAnnotationId?:string;
  onSelect:(id:string)=>void;
  onAddCallout:(value:CalloutAnnotation)=>void;
  onAddText:(value:TextBoxAnnotation)=>void;
  onAddNote:(value:StickyNoteAnnotation)=>void;
  onMoveBox:(value:MovableBox)=>void;
  onVisiblePage:(index:number)=>void;
  onViewportResize:(width:number,height:number)=>void;
}

interface SlotProps extends Pick<DocumentViewportProps,
  "pdf"|"zoom"|"tool"|"annotations"|"selectedAnnotationId"|
  "onSelect"|"onAddCallout"|"onAddText"|"onAddNote"|"onMoveBox"> {
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
        annotations={events.annotations}
        selectedAnnotationId={events.selectedAnnotationId}
        onSelect={events.onSelect}
        onAddCallout={events.onAddCallout}
        onAddText={events.onAddText}
        onAddNote={events.onAddNote}
        onMoveBox={events.onMoveBox}/>:
      <div className="view-page-skeleton"
        style={{width:Math.max(100,size.width),height:Math.max(100,size.height)}}
        aria-label={"Page "+pageNumber+" preview placeholder"}>
        {error??"Page "+pageNumber}
      </div>}
  </div>;
}

export function DocumentViewport(props:DocumentViewportProps){
  const {
    pdf,pageNumber,navigationToken,mode,coverAlone,zoom,
    annotations,selectedAnnotationId,onVisiblePage,onViewportResize,
    ...events
  }=props;
  const rootRef=useRef<HTMLDivElement>(null);
  const scrollFrame=useRef<number | undefined>(undefined);
  const previousZoom=useRef(zoom);
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
    const bounds=root.getBoundingClientRect();
    const top=bounds.top+Math.min(100,bounds.height/5);
    let best=0,bestDistance=Infinity;
    const rows=root.querySelectorAll<HTMLElement>("[data-view-row]");
    rows.forEach((row)=>{
      const rect=row.getBoundingClientRect();
      const target=rect.top<=top&&rect.bottom>=top
        ?0:Math.min(Math.abs(rect.top-top),Math.abs(rect.bottom-top));
      if(target<bestDistance){
        bestDistance=target;
        best=Number(row.dataset.viewRow??"0");
      }
    });
    const group=groups[best];
    if(!group)return;
    setFocusGroup(prev=>prev===best?prev:best);
    onVisiblePage(group[0]!);
  },[continuous,groups,onVisiblePage]);

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
    className={"document-viewport view-scroll view-mode-"+mode}
    data-view-mode={mode}
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
            fallbackSize={referenceSize}
            annotations={annotations}
            selectedAnnotationId={selectedAnnotationId}
            onSelect={events.onSelect}
            onAddCallout={events.onAddCallout}
            onAddText={events.onAddText}
            onAddNote={events.onAddNote}
            onMoveBox={events.onMoveBox}/>)}
        </div>;
      })}
      <p className="workspace-tip">
        {events.tool==="callout"?"Click where the callout arrow should point.":
          events.tool==="text"?"Click to place editable text.":
          events.tool==="note"?"Click to leave a comment.":
          "Drag a markup box to move it; the arrow tip stays fixed. Arrow keys nudge a focused box."}
      </p>
    </div>
  </div>;
}
