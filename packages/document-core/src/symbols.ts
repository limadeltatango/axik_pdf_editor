import {clamp,isPoint,isRect,type Point,type Rect} from "./geometry";
import type {AnnotationBase} from "./annotations";

const HEX=/^#[0-9a-fA-F]{6}$/;
const MAX_COMPONENTS=80;
const MAX_COORD=100_000;

export type SymbolPrimitiveType="rect"|"ellipse"|"line";
export interface SymbolPrimitive{
  id:string;
  type:SymbolPrimitiveType;
  x:number;y:number;width:number;height:number;
  stroke:string;fill:string|"none";
  lineWidth:number;
}
export interface SymbolTemplate{
  version:1;
  id:string;
  name:string;
  primitives:SymbolPrimitive[];
}
export interface SymbolAnnotation extends AnnotationBase{
  kind:"symbol";
  intent:"Stamp";
  text:string;
  name:string;
  templateId:string;
  /** Whole symbol bounding box in PDF user coordinates. */
  box:Rect;
  /** Local-vector content rotates as one group, in degrees CCW. */
  rotation:number;
  primitives:SymbolPrimitive[];
}
export function validateSymbolTemplate(template:SymbolTemplate):SymbolTemplate{
  if(template.version!==1 || typeof template.name!=="string"||
    template.name.length<1||template.name.length>90 ||
    typeof template.id!=="string"||template.id.length<1||template.id.length>128 ||
    !Array.isArray(template.primitives)||!template.primitives.length||
    template.primitives.length>MAX_COMPONENTS){
    throw new RangeError("Invalid compound-symbol definition.");
  }
  const used=new Set<string>();
  for(const p of template.primitives){
    if(!p||!["rect","ellipse","line"].includes(p.type) ||
       !p.id || p.id.length>100 ||used.has(p.id) ||
       ![p.x,p.y,p.width,p.height,p.lineWidth].every(Number.isFinite)||
       [p.x,p.y,p.width,p.height].some(v=>Math.abs(v)>MAX_COORD) ||
       (p.type!=="line" && (p.width<0||p.height<0))||
       (p.type!=="line" && (!p.width||!p.height)) ||
       (p.type==="line" && p.width===0 && p.height===0) ||
       p.lineWidth<=0||p.lineWidth>40 ||
       !HEX.test(p.stroke) ||
       (p.fill!=="none"&&!HEX.test(p.fill))){
      throw new RangeError("Invalid symbol component.");
    }
    used.add(p.id);
  }
  return template;
}
export function symbolExtents(primitives:readonly SymbolPrimitive[]):Rect{
  if(!primitives.length)throw new RangeError("Empty symbol.");
  const xs=primitives.flatMap(p=>[p.x,p.x+p.width]);
  const ys=primitives.flatMap(p=>[p.y,p.y+p.height]);
  const left=Math.min(...xs),right=Math.max(...xs);
  const bottom=Math.min(...ys),top=Math.max(...ys);
  return {x:left,y:bottom,
    width:Math.max(.1,right-left),height:Math.max(.1,top-bottom)};
}
export function validateSymbolAnnotation(value:SymbolAnnotation):SymbolAnnotation{
  validateSymbolTemplate({
    version:1,id:value.templateId,name:value.name,
    primitives:value.primitives
  });
  if(!isRect(value.box)||value.box.width>MAX_COORD||
     value.box.height>MAX_COORD||
     !Number.isFinite(value.rotation) ||
     Math.abs(value.rotation)>360 ||
     value.intent!=="Stamp" ||value.text.length>20000){
    throw new RangeError("Invalid symbol placement.");
  }
  return value;
}
/**
 * First real construction sample: a short mounting base and independent
 * longer linear light body. All values in PDF points, NOT assumed inches.
 */
export function kitchenLinearLightTemplate():SymbolTemplate{
  return validateSymbolTemplate({
    version:1,id:"axik-kitchen-linear-light-v1",
    name:"Kitchen linear light",primitives:[
      {id:"mount",type:"rect",x:45,y:0,width:20,height:14,
        stroke:"#1f2937",fill:"#ffffff",lineWidth:1},
      {id:"luminaire",type:"rect",x:0,y:22,width:110,height:14,
        stroke:"#1f2937",fill:"#f9f6c9",lineWidth:1}
    ]
  });
}
/** Create a grouped stamp instance; later edits do not mutate its saved template. */
export function makeSymbolAnnotation(
  template:SymbolTemplate,point:Point,pageBounds:Rect,
  id:string,now=new Date()
):SymbolAnnotation{
  validateSymbolTemplate(template);
  if(!isPoint(point)||!isRect(pageBounds))throw new RangeError("Invalid symbol position.");
  const extents=symbolExtents(template.primitives);
  const width=Math.min(Math.max(5,extents.width),pageBounds.width);
  const height=Math.min(Math.max(5,extents.height),pageBounds.height);
  const box={
    x:clamp(point.x,pageBounds.x,pageBounds.x+pageBounds.width-width),
    y:clamp(point.y,pageBounds.y,pageBounds.y+pageBounds.height-height),
    width,height
  };
  return validateSymbolAnnotation({
    id,pageIndex:0,kind:"symbol",intent:"Stamp",text:template.name,
    name:template.name,templateId:template.id,box,rotation:0,
    primitives:template.primitives.map(p=>({...p})),
    createdAt:now.toISOString(),updatedAt:now.toISOString()
  });
}
/** Uniform, bounded SVG/PDF transform: preserves component proportions. */
export function symbolTransform(symbol:SymbolAnnotation):{
  a:number;b:number;c:number;d:number;e:number;f:number
}{
  validateSymbolAnnotation(symbol);
  const ext=symbolExtents(symbol.primitives);
  const theta=symbol.rotation*Math.PI/180;
  const cos=Math.cos(theta),sin=Math.sin(theta);
  const rotateW=Math.abs(cos)*ext.width+Math.abs(sin)*ext.height;
  const rotateH=Math.abs(sin)*ext.width+Math.abs(cos)*ext.height;
  const scale=Math.min(symbol.box.width/rotateW,symbol.box.height/rotateH);
  const cx=ext.x+ext.width/2,cy=ext.y+ext.height/2;
  const tx=symbol.box.width/2-scale*(cos*cx-sin*cy);
  const ty=symbol.box.height/2-scale*(sin*cx+cos*cy);
  return {a:scale*cos,b:scale*sin,c:-scale*sin,d:scale*cos,
    e:tx,f:ty};
}
/** Modify one component numerically; the group stays a single edit/Undo step. */
export function updateSymbolComponent(
  template:SymbolTemplate,id:string,
  values:Partial<Omit<SymbolPrimitive,"id">>
):SymbolTemplate{
  const index=template.primitives.findIndex(p=>p.id===id);
  if(index<0)throw new RangeError("Symbol component not found.");
  const updated={...template,primitives:template.primitives.map((p,i)=>
    i===index?{...p,...values,id:p.id}:p
  )};
  return validateSymbolTemplate(updated);
}
