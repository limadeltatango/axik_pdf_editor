import {useRef,useState,type PointerEvent} from "react";
import {
  kitchenLinearLightTemplate,symbolExtents,
  updateSymbolComponent,validateSymbolTemplate,
  type SymbolTemplate,type SymbolPrimitive,type SymbolPrimitiveType,
  type SymbolAnnotation
} from "@axik/document-core";
import {
  readSymbolLibrary,saveSymbolTemplate,deleteSymbolTemplate
} from "./symbol-library";

type NumericField="x"|"y"|"width"|"height"|"lineWidth";
const COLOR_OPTIONS=[
  {value:"#1f2937",name:"Charcoal"},{value:"#dc2626",name:"Red"},
  {value:"#2563eb",name:"Blue"},{value:"#f59e0b",name:"Amber"}
] as const;
const VIEWS:ReadonlyArray<{type:SymbolPrimitiveType;name:string}>= [
  {type:"rect",name:"Rectangle"},{type:"ellipse",name:"Ellipse"},
  {type:"line",name:"Line"}
];
function nextComponent(type:SymbolPrimitiveType):SymbolPrimitive{
  return {
    id:crypto.randomUUID(),type,
    x:20,y:20,width:60,height:type==="line"?0:20,
    stroke:"#1f2937",fill:type==="line"?"none":"#ffffff",
    lineWidth:1
  };
}
export function ShapeBuilderPanel({
  onClose,onUse,initialTemplate
}:{
  onClose:()=>void;
  onUse:(template:SymbolTemplate)=>void;
  initialTemplate?:SymbolAnnotation;
}){
  const [library,setLibrary]=useState(readSymbolLibrary);
  const [template,setTemplate]=useState<SymbolTemplate>(()=>
    initialTemplate?{
      version:1,id:initialTemplate.templateId,
      name:initialTemplate.name,
      primitives:initialTemplate.primitives.map(p=>({...p}))
    }:structuredClone(kitchenLinearLightTemplate())
  );
  const [selectedId,setSelectedId]=useState<string>(
    initialTemplate?.primitives[0]?.id ??
      kitchenLinearLightTemplate().primitives[0]!.id
  );
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const groupRef=useRef<SVGGElement>(null);
  // Freeze both the SVG viewBox and coordinate transform for a drag gesture.
  // Recomputing extents while dragging changes getScreenCTM and would cause
  // pointer displacement to drift or partially cancel near the symbol edge.
  const [dragFrame,setDragFrame]=useState<{
    width:number;height:number;originX:number;originY:number
  } | undefined>(undefined);
  const drag=useRef<{
    pointerId:number;id:string;start:{x:number;y:number};
    inverse:DOMMatrix;original:SymbolPrimitive
  } | undefined>(undefined);

  const selected=template.primitives.find(p=>p.id===selectedId);
  const ext=symbolExtents(template.primitives);
  const width=Math.max(180,ext.width+50);
  const height=Math.max(115,ext.height+50);
  const originX=25-ext.x,originY=height-25+ext.y;
  const preview=dragFrame??{width,height,originX,originY};

  function localPoint(clientX:number,clientY:number,inverse:DOMMatrix){
    const p=new DOMPoint(clientX,clientY).matrixTransform(inverse);
    return {x:p.x,y:p.y};
  }
  function choose(id:string){
    const next=library.find(t=>t.id===id);
    if(!next)return;
    setTemplate(structuredClone(next));
    setSelectedId(next.primitives[0]!.id);
    setNotice("");setError("");
  }
  function updateComponent(id:string,changes:Partial<SymbolPrimitive>){
    // Validate synchronously: React may run a functional state updater later,
    // outside this try/catch. Invalid dimensions must not crash the editor.
    try {
      const next=updateSymbolComponent(template,id,changes);
      setTemplate(next);
      setError("");setNotice("");
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Component change invalid.");
    }
  }
  function newPrimitive(type:SymbolPrimitiveType){
    const component=nextComponent(type);
    try{
      const next=validateSymbolTemplate({
        ...template,primitives:[...template.primitives,component]
      });
      setTemplate(next);
      setSelectedId(component.id);
      setError("");setNotice("");
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Cannot add component.");
    }
  }
  function duplicate(){
    if(!selected)return;
    const copy={...selected,id:crypto.randomUUID(),
      x:selected.x+8,y:selected.y+8};
    try{
      const next=validateSymbolTemplate({
        ...template,primitives:[...template.primitives,copy]
      });
      setTemplate(next);
      setSelectedId(copy.id);
      setError("");setNotice("");
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Cannot duplicate component.");
    }
  }
  function remove(){
    if(!selected||template.primitives.length<=1)return;
    const next=template.primitives.filter(p=>p.id!==selectedId);
    setTemplate({...template,primitives:next});
    setSelectedId(next[0]!.id);
  }
  function align(axis:"x"|"y"){
    const rect=symbolExtents(template.primitives);
    const cx=rect.x+rect.width/2,cy=rect.y+rect.height/2;
    try{
      const next=validateSymbolTemplate({...template,
        primitives:template.primitives.map(p=>({
          ...p,[axis]:axis==="x"?cx-p.width/2:cy-p.height/2
        }))
      });
      setTemplate(next);
      setError("");setNotice("");
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Cannot align components.");
    }
  }
  function applyNumber(field:NumericField,value:number){
    if(!selected||!Number.isFinite(value))return;
    updateComponent(selected.id,{[field]:value});
  }
  function save(asNew=false){
    try{
      const entry=validateSymbolTemplate({
        ...structuredClone(template),
        id:asNew||template.id===kitchenLinearLightTemplate().id
          ?crypto.randomUUID():template.id
      });
      const next=saveSymbolTemplate(entry);
      setLibrary(next);setTemplate(entry);
      setNotice("Saved "+entry.name+" to your local symbol library.");
      setError("");
    }catch(reason){
      setError(reason instanceof Error?reason.message:"Could not save symbol.");
    }
  }
  function onDown(event:PointerEvent<SVGElement>,primitive:SymbolPrimitive){
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    try{
      const group=groupRef.current;
      const matrix=group?.getScreenCTM();
      if(!group||!matrix)throw new Error("Symbol preview is not ready for editing.");
      const inverse=matrix.inverse();
      group.setPointerCapture(event.pointerId);
      drag.current={
        pointerId:event.pointerId,id:primitive.id,
        start:localPoint(event.clientX,event.clientY,inverse),
        inverse,original:{...primitive}
      };
      setDragFrame({width:preview.width,height:preview.height,
        originX:preview.originX,originY:preview.originY});
      setSelectedId(primitive.id);
    }catch(reason){
      drag.current=undefined;
      setDragFrame(undefined);
      setError(reason instanceof Error?reason.message:"Cannot grab primitive.");
    }
  }
  function onMove(event:PointerEvent<SVGGElement>){
    const state=drag.current;
    if(!state||state.pointerId!==event.pointerId)return;
    event.preventDefault();
    try{
      const current=localPoint(event.clientX,event.clientY,state.inverse);
      const changes={
        x:Math.round((state.original.x+current.x-state.start.x)*10)/10,
        y:Math.round((state.original.y+current.y-state.start.y)*10)/10
      };
      updateComponent(state.id,changes);
    }catch{/* keep previous valid position */}
  }
  function onEnd(event:PointerEvent<SVGGElement>){
    if(drag.current?.pointerId!==event.pointerId)return;
    drag.current=undefined;
    setDragFrame(undefined);
    if(groupRef.current?.hasPointerCapture(event.pointerId)){
      groupRef.current.releasePointerCapture(event.pointerId);
    }
  }
  return <div className="modal-backdrop">
    <section className="shape-builder" role="dialog" aria-modal="true"
      aria-label="Custom vector symbol builder">
      <header className="panel-heading">
        <div>
          <h2>Vector symbol builder</h2>
          <p className="muted">Build and reuse grouped fixtures. Every part stays editable,
            even after exporting and reopening in Axik.</p>
        </div>
        <button onClick={onClose}>Close</button>
      </header>
      <div className="symbol-builder-header">
        <label>Library
          <select aria-label="Saved symbol library"
            value={library.some(t=>t.id===template.id)?template.id:""}
            onChange={e=>choose(e.target.value)}>
            {!library.some(t=>t.id===template.id) &&
              <option value="">Unsaved custom symbol</option>}
            {library.map(item=><option key={item.id} value={item.id}>
              {item.name}</option>)}
          </select>
        </label>
        <label>Symbol name
          <input aria-label="Symbol name" value={template.name}
            onChange={e=>setTemplate(prev=>({...prev,name:e.target.value}))}
            maxLength={90}/>
        </label>
      </div>
      <p className="diagnostics-warning">
        Dimensions are in PDF points (72 points per inch on paper), not verified
        real-world fixture dimensions. Drawing-scale calibration is a separate feature.
      </p>
      <div className="symbol-workbench">
        <div className="symbol-preview">
          <svg role="img" aria-label="Editable compound symbol preview"
            viewBox={"0 0 "+preview.width+" "+preview.height}
            preserveAspectRatio="xMidYMid meet">
            <rect width={width} height={height} fill="#f3f6fa"/>
            <g ref={groupRef}
              transform={"translate("+preview.originX+" "+preview.originY+") scale(1 -1)"}
              onPointerMove={onMove} onPointerUp={onEnd}
              onPointerCancel={onEnd}>
              {template.primitives.map(p=>{
                const props={
                  onPointerDown:(event:PointerEvent<SVGElement>)=>onDown(event,p),
                  onClick:()=>setSelectedId(p.id),
                  stroke:p.stroke,fill:p.fill==="none"?"none":p.fill,
                  strokeWidth:p.lineWidth,
                  className:"symbol-part"+(selectedId===p.id?" selected":"")
                };
                return p.type==="rect"
                  ?<rect key={p.id} x={p.x} y={p.y} width={p.width}
                    height={p.height} {...props}/>
                  :p.type==="ellipse"
                    ?<ellipse key={p.id} cx={p.x+p.width/2} cy={p.y+p.height/2}
                      rx={p.width/2} ry={p.height/2} {...props}/>
                    :<line key={p.id} x1={p.x} y1={p.y}
                      x2={p.x+p.width} y2={p.y+p.height}
                      {...props}/>;
              })}
            </g>
          </svg>
          <p className="muted">Drag any component to reposition it.
            Edit exact dimensions below. Save the whole group for reuse.</p>
        </div>
        <div className="symbol-configuration">
          <div className="symbol-builder-toolbar">
            {VIEWS.map(item=><button key={item.type}
              onClick={()=>newPrimitive(item.type)}>
              + {item.name}</button>)}
          </div>
          <label>Components
            <select size={Math.min(6,template.primitives.length)}
              aria-label="Symbol components" value={selectedId}
              onChange={e=>setSelectedId(e.target.value)}>
              {template.primitives.map((p,i)=><option key={p.id} value={p.id}>
                {i+1}. {p.type} · {p.width} × {p.height} pt
              </option>)}
            </select>
          </label>
          {selected&&<>
            <strong>Edit {selected.type} component</strong>
            <div className="symbol-numeric-grid">
              {(["x","y","width","height","lineWidth"] as const).map(field=>
                <label key={field}>{field==="lineWidth"?"Stroke width":field}
                  <input type="number" step={field==="lineWidth"?.5:1}
                    min={field==="lineWidth"?.1:undefined}
                    aria-label={"Component "+field}
                    value={selected[field]}
                    onChange={e=>applyNumber(field,Number(e.target.value))}/>
                </label>)}
            </div>
            <div className="symbol-colors">
              <label>Stroke
                <input aria-label="Component stroke color" type="color"
                  value={selected.stroke}
                  onChange={e=>updateComponent(selected.id,{stroke:e.target.value})}/>
              </label>
              <label>Fill
                <input aria-label="Component fill color" type="color"
                  disabled={selected.type==="line"}
                  value={selected.fill==="none"?"#ffffff":selected.fill}
                  onChange={e=>updateComponent(selected.id,{fill:e.target.value})}/>
              </label>
              <label><input type="checkbox" aria-label="No fill"
                disabled={selected.type==="line"}
                checked={selected.fill==="none"}
                onChange={e=>updateComponent(selected.id,{
                  fill:e.target.checked?"none":"#ffffff"
                })}/> No fill</label>
            </div>
            <div className="symbol-builder-toolbar">
              <button onClick={duplicate}>Duplicate component</button>
              <button disabled={template.primitives.length<=1}
                onClick={remove}>Remove component</button>
            </div>
          </>}
          <div className="symbol-builder-toolbar">
            <button onClick={()=>align("x")}>Align centers X</button>
            <button onClick={()=>align("y")}>Align centers Y</button>
          </div>
          <p className="muted">Group dimensions: {Math.round(ext.width*10)/10} ×
            {" "+Math.round(ext.height*10)/10} pt.
            A reusable stamp preserves proportional component geometry.</p>
        </div>
      </div>
      {error&&<p role="alert" className="diagnostics-warning">{error}</p>}
      {notice&&<p role="status" className="diagnostics-success">{notice}</p>}
      <footer className="diagnostics-actions">
        <button onClick={()=>save(true)}>Save as new symbol</button>
        <button onClick={()=>save(false)}
          disabled={template.id===kitchenLinearLightTemplate().id}>
          Save changes
        </button>
        <button onClick={()=>{
          try{
            const next=deleteSymbolTemplate(template.id);
            setLibrary(next);setTemplate(structuredClone(next[0]!));
            setSelectedId(next[0]!.primitives[0]!.id);
          }catch(reason){
            setError(reason instanceof Error?reason.message:"Cannot delete symbol.");
          }
        }} disabled={template.id===kitchenLinearLightTemplate().id}>
          Delete from library
        </button>
        <span className="spacer"/>
        <button className="primary" onClick={()=>{
          try{
            validateSymbolTemplate(template);
            onUse(structuredClone(template));
            onClose();
          }catch(reason){
            setError(reason instanceof Error?reason.message:"Invalid symbol.");
          }
        }}>Use on drawing</button>
      </footer>
    </section>
  </div>;
}
