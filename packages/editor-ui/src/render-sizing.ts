/** Maximum live bitmap per page. GPU compositing can remain independent. */
export const MAX_PAGE_RASTER_PIXELS = 16_000_000;
/**
 * Keep the page's CSS size unchanged while capping PDF.js raster allocation.
 * This matters for Arch D/E sheets and large external monitor DPR.
 *
 * The PDF worker receives a viewport in CSS pixels and an explicit transform
 * into raster backing pixels. Do not assume rasterization is hardware-GPU.
 */
export function budgetCanvas(
  width:number,height:number,
  devicePixelRatio=1,maxPixels=MAX_PAGE_RASTER_PIXELS
):{ratio:number;backingWidth:number;backingHeight:number}{
  if(!Number.isFinite(width)||!Number.isFinite(height)||
    width<=0||height<=0||width>100_000||height>100_000){
    throw new RangeError("Unsupported PDF viewport dimensions.");
  }
  if(!Number.isFinite(maxPixels)||maxPixels<1_000_000){
    throw new RangeError("Unsupported raster pixel budget.");
  }
  const device=Math.max(.1,Math.min(2,Number.isFinite(devicePixelRatio)?devicePixelRatio:1));
  const ratio=Math.min(device,Math.sqrt(maxPixels/(width*height)));
  const backingWidth=Math.max(1,Math.floor(width*ratio));
  const backingHeight=Math.max(1,Math.floor(height*ratio));
  return {ratio,backingWidth,backingHeight};
}
