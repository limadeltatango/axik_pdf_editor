import {
  clamp, isPoint, isRect, type Point, type Rect
} from "./geometry";
import {
  validateAnnotation, type CalloutAnnotation, type TextBoxAnnotation
} from "./annotations";

export type MovableBox = CalloutAnnotation | TextBoxAnnotation;

function closestBoxAnchor(box:Rect, tip:Point):Point {
  // Prefer the geometrically closest point on the perimeter. This keeps
  // the line attached to the box rather than sending it across its text.
  const c=[
    {x:box.x, y:clamp(tip.y,box.y,box.y+box.height)},
    {x:box.x+box.width,y:clamp(tip.y,box.y,box.y+box.height)},
    {x:clamp(tip.x,box.x,box.x+box.width),y:box.y},
    {x:clamp(tip.x,box.x,box.x+box.width),y:box.y+box.height}
  ];
  return c.reduce((nearest,point)=>{
    const d=(p:Point)=>(p.x-tip.x)**2+(p.y-tip.y)**2;
    return d(point)<d(nearest)?point:nearest;
  });
}

/**
 * Move JUST the callout's text box: the arrow tip stays anchored on the plan.
 * Two-point leaders stay two-point; three-point leaders keep an adjustable
 * horizontal-first elbow. Clamp the entire box within the visible CropBox.
 *
 * Pass the *original* annotation and total drag delta; do not accumulate
 * delta from repeatedly rounded previews.
 */
export function relocateMarkupBox<T extends MovableBox>(
  item:T, delta:Point, bounds:Rect
):T {
  validateAnnotation(item);
  if(!isPoint(delta)||!isRect(bounds)){
    throw new RangeError("Invalid markup move or page bounds.");
  }
  if(item.box.width>bounds.width || item.box.height>bounds.height){
    throw new RangeError("The annotation box exceeds the visible page.");
  }
  const box:Rect={
    ...item.box,
    x:clamp(item.box.x+delta.x,bounds.x,bounds.x+bounds.width-item.box.width),
    y:clamp(item.box.y+delta.y,bounds.y,bounds.y+bounds.height-item.box.height)
  };
  if(item.kind==="text"){
    const result={...item,box} as T;
    validateAnnotation(result);
    return result;
  }
  const tip=item.leader[0]!;
  const last=closestBoxAnchor(box,tip);
  const leader=item.leader.length===2
    ?[tip,last]
    // Preserve a user's independently positioned elbow while moving the box.
    :[tip,item.leader[1]!,last];
  const result={...item,box,leader} as T;
  validateAnnotation(result);
  return result;
}

/** One-point keyboard nudge is measured in *PDF points*, not browser pixels. */
export function nudgeMarkupBox<T extends MovableBox>(
  item:T,bounds:Rect,direction:"left"|"right"|"up"|"down",large=false
):T{
  const n=large?10:1;
  const delta={
    left:{x:-n,y:0},right:{x:n,y:0},
    up:{x:0,y:n},down:{x:0,y:-n}
  }[direction];
  return relocateMarkupBox(item,delta,bounds);
}


export type BoxResizeCorner = "north-west"|"north-east"|"south-west"|"south-east";
export type CalloutHandle = "tip"|"elbow";
export const MIN_MARKUP_BOX_WIDTH = 48;
export const MIN_MARKUP_BOX_HEIGHT = 24;

function withinPage(point:Point,bounds:Rect):Point {
  if(!isPoint(point)||!isRect(bounds)){
    throw new RangeError("Invalid point or PDF page bounds.");
  }
  return {
    x:clamp(point.x,bounds.x,bounds.x+bounds.width),
    y:clamp(point.y,bounds.y,bounds.y+bounds.height)
  };
}

/**
 * Drag the arrow tip or the optional elbow without changing the text box.
 * A straight two-point callout becomes a three-point leader when the elbow
 * is explicitly adjusted. Passing original geometry avoids cumulative drift.
 */
export function positionCalloutHandle(
  item:CalloutAnnotation,handle:CalloutHandle,target:Point,bounds:Rect
):CalloutAnnotation {
  validateAnnotation(item);
  const position=withinPage(target,bounds);
  const leader=[...item.leader];
  if(handle==="tip"){
    leader[0]=position;
  }else if(handle==="elbow"){
    if(leader.length===2)leader.splice(1,0,position);
    else leader[1]=position;
  }else throw new RangeError("Unknown callout leader handle.");
  const result={...item,leader};
  validateAnnotation(result);
  return result;
}

/**
 * Resize a text/callout box using a PDF-space delta and a genuine corner grip.
 * Opposite corner stays fixed until a sheet edge/minimum dimension is reached.
 * The arrow tip and a custom elbow are preserved; only the endpoint touching
 * the textbox recalculates to the nearest edge.
 */
export function resizeMarkupBox<T extends MovableBox>(
  item:T,corner:BoxResizeCorner,delta:Point,bounds:Rect
):T {
  validateAnnotation(item);
  if(!isPoint(delta)||!isRect(bounds))throw new RangeError("Invalid resize.");
  const minW=Math.min(MIN_MARKUP_BOX_WIDTH,bounds.width);
  const minH=Math.min(MIN_MARKUP_BOX_HEIGHT,bounds.height);
  const left0=item.box.x,bottom0=item.box.y;
  const right0=left0+item.box.width,top0=bottom0+item.box.height;
  let left=left0,right=right0,bottom=bottom0,top=top0;
  switch(corner){
    case "north-west":
      left=clamp(left0+delta.x,bounds.x,right0-minW);
      top=clamp(top0+delta.y,bottom0+minH,bounds.y+bounds.height);
      break;
    case "north-east":
      right=clamp(right0+delta.x,left0+minW,bounds.x+bounds.width);
      top=clamp(top0+delta.y,bottom0+minH,bounds.y+bounds.height);
      break;
    case "south-west":
      left=clamp(left0+delta.x,bounds.x,right0-minW);
      bottom=clamp(bottom0+delta.y,bounds.y,top0-minH);
      break;
    case "south-east":
      right=clamp(right0+delta.x,left0+minW,bounds.x+bounds.width);
      bottom=clamp(bottom0+delta.y,bounds.y,top0-minH);
      break;
    default:throw new RangeError("Invalid resize corner.");
  }
  const box:Rect={x:left,y:bottom,width:right-left,height:top-bottom};
  if(item.kind==="text"){
    const result={...item,box} as T;
    validateAnnotation(result);
    return result;
  }
  const tip=item.leader[0]!;
  const anchor=closestBoxAnchor(box,tip);
  const leader=item.leader.length===2
    ?[tip,anchor]
    :[tip,item.leader[1]!,anchor];
  const result={...item,box,leader} as T;
  validateAnnotation(result);
  return result;
}

/** Use visual / keyboard arrow controls without losing custom leader geometry. */
export function nudgeCalloutHandle(
  item:CalloutAnnotation,handle:CalloutHandle,bounds:Rect,
  direction:"left"|"right"|"up"|"down",large=false
):CalloutAnnotation {
  const step=large?10:1;
  const delta={
    left:{x:-step,y:0},right:{x:step,y:0},
    up:{x:0,y:step},down:{x:0,y:-step}
  }[direction];
  const point=handle==="tip"?item.leader[0]!
    :item.leader.length===3?item.leader[1]!
      :{x:(item.leader[0]!.x+item.leader[1]!.x)/2,
        y:(item.leader[0]!.y+item.leader[1]!.y)/2};
  return positionCalloutHandle(item,handle,{
    x:point.x+delta.x,y:point.y+delta.y
  },bounds);
}
