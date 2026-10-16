/**
 * PDF plan navigation geometry: use a DOM page anchor so zoom never jumps to
 * the viewport center when the person is inspecting a precise plan detail.
 */
export const MIN_POINTER_ZOOM=.1;
export const MAX_POINTER_ZOOM=8;

export interface CursorAnchor {
  pageNumber:number;
  ratioX:number;
  ratioY:number;
  clientX:number;
  clientY:number;
}

export function wheelZoomFactor(deltaY:number,deltaMode=0):number {
  if(!Number.isFinite(deltaY))return 1;
  const normalized=deltaMode===1?deltaY*16:
    deltaMode===2?deltaY*720:deltaY;
  return Math.exp(Math.max(-2,Math.min(2,-normalized*.002)));
}
export function nextPointerZoom(zoom:number,deltaY:number,deltaMode=0):number{
  if(!Number.isFinite(zoom)||zoom<=0)return 1;
  return Math.round(Math.min(MAX_POINTER_ZOOM,Math.max(MIN_POINTER_ZOOM,
    zoom*wheelZoomFactor(deltaY,deltaMode)))*1000)/1000;
}

/** Desired change in scroll offset to leave the anchored document pixel fixed. */
export function anchoredScrollDelta(
  originalClient:number,nextRectStart:number,nextRectSize:number,ratio:number
):number{
  if(![originalClient,nextRectStart,nextRectSize,ratio].every(Number.isFinite)||
     nextRectSize<0)throw new RangeError("Invalid pan/zoom anchor.");
  return nextRectStart+nextRectSize*Math.max(0,Math.min(1,ratio))-originalClient;
}

export function panScrollPosition(
  original:{left:number;top:number},delta:{x:number;y:number}
):{left:number;top:number}{
  if(![original.left,original.top,delta.x,delta.y].every(Number.isFinite)){
    throw new RangeError("Invalid pan delta.");
  }
  return {left:Math.max(0,original.left-delta.x),
    top:Math.max(0,original.top-delta.y)};
}
