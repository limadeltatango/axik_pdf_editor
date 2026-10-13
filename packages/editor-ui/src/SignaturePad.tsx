import {useRef,useState,type PointerEvent} from "react";
import {type Point} from "@axik/document-core";

export interface SignaturePadProps {
  onCancel:()=>void;
  onAccept:(strokes:readonly (readonly Point[])[])=>void;
}

const WIDTH=480;
const HEIGHT=160;
const MAX_STROKES=50;
const MAX_POINTS_PER_STROKE=500;

export function SignaturePad({onCancel,onAccept}:SignaturePadProps){
  const [strokes,setStrokes]=useState<Point[][]>([]);
  const currentPointer=useRef<number|null>(null);
  const drawing=useRef<Point[]>([]);
  const svg=useRef<SVGSVGElement>(null);
  const [error,setError]=useState<string>();

  function point(event:PointerEvent<SVGSVGElement>):Point{
    const bounds=event.currentTarget.getBoundingClientRect();
    return {
      x:Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),
      y:Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height))
    };
  }

  function down(event:PointerEvent<SVGSVGElement>){
    if(currentPointer.current!==null)return;
    if(strokes.length>=MAX_STROKES){
      setError("Maximum 50 pen strokes. Clear to begin again.");return;
    }
    currentPointer.current=event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current=[point(event)];
    setStrokes(previous=>[...previous,drawing.current.slice()]);
    setError(undefined);
  }

  function move(event:PointerEvent<SVGSVGElement>){
    if(currentPointer.current!==event.pointerId)return;
    if(drawing.current.length>=MAX_POINTS_PER_STROKE)return;
    const next=point(event);
    const previous=drawing.current[drawing.current.length-1];
    if(previous&&Math.hypot(next.x-previous.x,next.y-previous.y)<0.002)return;
    drawing.current.push(next);
    const stroke=drawing.current.slice();
    setStrokes(previousStrokes=>previousStrokes.map((item,index)=>
      index===previousStrokes.length-1?stroke:item));
  }

  function finish(event:PointerEvent<SVGSVGElement>){
    if(currentPointer.current!==event.pointerId)return;
    if(drawing.current.length===1){
      // Single click draws a dot as a tiny valid segment instead of
      // introducing a malformed zero-length PDF InkList stroke.
      const first=drawing.current[0]!;
      drawing.current.push({
        x:Math.min(1,first.x+0.002),y:first.y
      });
      const stroke=drawing.current.slice();
      setStrokes(previous=>previous.map((item,index)=>
        index===previous.length-1?stroke:item));
    }
    if(event.currentTarget.hasPointerCapture(event.pointerId)){
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    currentPointer.current=null;
    drawing.current=[];
  }

  function accept(){
    if(currentPointer.current!==null){
      setError("Finish drawing before placing the signature.");return;
    }
    const valid=strokes.filter(s=>s.length>=2);
    if(!valid.length){
      setError("Draw a signature before selecting Use signature.");
      return;
    }
    onAccept(valid.map(stroke=>stroke.map(p=>({...p}))));
  }

  return <div className="modal-backdrop">
    <section className="signature-panel" role="dialog" aria-modal="true"
      aria-label="Draw visible signature">
      <header className="panel-heading">
        <div>
          <h2>Draw a visual signature</h2>
          <p className="muted">Handwritten appearance only. This is not a
            certified digital signature or verified identity.</p>
        </div>
        <button onClick={onCancel}>Cancel</button>
      </header>
      <svg ref={svg} viewBox={"0 0 "+WIDTH+" "+HEIGHT}
        className="signature-pad"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        role="img" aria-label="Draw your visible signature">
        <rect width={WIDTH} height={HEIGHT} fill="white"/>
        <path d="M 15 125 L 465 125" stroke="#e5e7eb" strokeWidth="1"/>
        {strokes.map((stroke,index)=>{
          const d=stroke.map((p,i)=>(i===0?"M ":"L ")+
            (p.x*WIDTH).toFixed(2)+" "+(p.y*HEIGHT).toFixed(2)).join(" ");
          return <path key={index} d={d} stroke="#17212c" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" fill="none"/>;
        })}
      </svg>
      <p className="muted">Use a mouse, touch or stylus. The signature is stored
        as editable ink strokes in the PDF and temporarily in local draft recovery
        until saved or deleted. It is never automatically uploaded.</p>
      {error&&<p role="alert" className="diagnostics-warning">{error}</p>}
      <footer className="diagnostics-actions">
        <button onClick={()=>{setStrokes([]);setError(undefined)}}>Clear ink</button>
        <span className="spacer"/>
        <button className="primary" onClick={accept}>Use signature</button>
      </footer>
    </section>
  </div>;
}
