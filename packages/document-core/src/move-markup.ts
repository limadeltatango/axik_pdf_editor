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
    :[tip,{x:(tip.x+last.x)/2,y:tip.y},last];
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
