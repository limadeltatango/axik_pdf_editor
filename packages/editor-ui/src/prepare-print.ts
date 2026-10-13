/**
 * Pixel-preserving print fallback for PDF pages that have annotations/widgets.
 *
 * pdf-lib's page-as-Form embedding omits /Annots. Rasterizing a merged view is
 * deliberately chosen over silently dropping marks, text widgets or stamps.
 *
 * This is not a high-resolution plotter backend: the max DPI, page count and
 * pixel limits prevent browser crashes. Warn before printing drawings where
 * vector lineweights and exact scale must be preserved.
 */
import { PDFDocument, degrees } from "pdf-lib";
import { normalizeForFixedStockPrinting, type NormalizedPrintResult,
  PrintPreparationError, planPrintableDocument } from "@axik/print-document";
import { type PrintPlan, type PlanOptions } from "@axik/print-plan";
import { type Annotation } from "@axik/document-core";
import { exportEditedPdf,planAnnotationEdits } from "@axik/pdf-writer";
import { startOpenPdf } from "./pdf";

const MAX_RASTER_PAGES=75;
const MAX_RASTER_PIXELS=12_000_000;
const MAX_OUTPUT_BYTES=100*1024*1024;

function pixelSize(width:number,height:number,scale:number):{w:number;h:number}{
  const w=Math.ceil(width*scale),h=Math.ceil(height*scale);
  if(!Number.isFinite(w*h)||w*h>MAX_RASTER_PIXELS||w<=0||h<=0){
    throw new PrintPreparationError(
      "Raster print exceeds the safe per-page pixel budget. " +
      "Try lower quality or prepare an unannotated vector PDF.",
      "UNSUPPORTED_DOCUMENT"
    );
  }
  return {w,h};
}

function pagePosition(
  sheetWidth:number,sheetHeight:number,
  placement:{x:number;y:number;width:number;height:number;sourceWidth:number;sourceHeight:number;scale:number;sheetRotation:0|90}
):{x:number;y:number}{
  const x0=placement.x, y0=sheetHeight-placement.y-placement.height;
  if(placement.sheetRotation===90){
    return {x:x0,y:y0+placement.sourceWidth*placement.scale};
  }
  return {x:x0,y:y0};
}

export interface PreparedPrintDocument {
  bytes:Uint8Array;
  plan:PrintPlan;
  mode:"vector"|"raster";
  warnings:readonly string[];
}

export async function preparePrintDocument(
  original:Uint8Array,
  annotations:readonly Annotation[],
  settings:Omit<PlanOptions,"pages">,
  options:{
    rasterDpi?:number;
    importedAnnotations?:readonly Annotation[];
    onProgress?:(current:number,total:number)=>void;
  }={}
):Promise<PreparedPrintDocument>{
  if(!original.byteLength)throw new Error("No PDF was selected.");
  const mutations=planAnnotationEdits(options.importedAnnotations??[],annotations);
  const input=mutations.changes.length || mutations.removeNames.length
    ? (await exportEditedPdf(original,mutations.changes,{
        removeNames:mutations.removeNames
      })).bytes
    : original;
  try{
    const result=await normalizeForFixedStockPrinting(input,settings);
    return {bytes:result.pdf,plan:result.plan,mode:"vector",warnings:result.warnings};
  }catch(reason){
    if(!(reason instanceof PrintPreparationError) ||
       reason.code!=="ANNOTATIONS_UNSUPPORTED")throw reason;
  }
  const dpi=options.rasterDpi??144;
  if(!Number.isFinite(dpi)||dpi<72||dpi>216){
    throw new RangeError("Raster print resolution must be between 72 and 216 DPI.");
  }
  const plan=await planPrintableDocument(input,settings);
  if(!plan.logicallyValid){
    throw new PrintPreparationError("The print layout has clipping errors.","PREFLIGHT_BLOCKED");
  }
  const source=startOpenPdf(input);
  const output=await PDFDocument.create();
  let loaded;
  try{
    loaded=await source.promise;
    if(loaded.numPages>MAX_RASTER_PAGES){
      throw new PrintPreparationError(
        "Annotated raster print is limited to 75 pages per batch in this alpha.",
        "UNSUPPORTED_DOCUMENT"
      );
    }
    const faces=plan.sheets.flatMap(s=>s.faces);
    let current=0;
    for(const face of faces){
      const sheet=output.addPage([settings.media.width,settings.media.height]);
      if(!face.placement){current++;options.onProgress?.(current,faces.length);continue;}
      const placement=face.placement;
      const page=await loaded.getPage(placement.pageIndex+1);
      const viewport=page.getViewport({scale:dpi/72});
      const {w,h}=pixelSize(viewport.width,viewport.height,1);
      const canvas=document.createElement("canvas");
      canvas.width=w;canvas.height=h;
      const context=canvas.getContext("2d",{alpha:false});
      if(!context)throw new Error("2D canvas unavailable for safe print fallback.");
      await page.render({
        canvas,canvasContext:context,viewport,
        background:"rgb(255,255,255)"
      }).promise;
      const png=await new Promise<Blob>((resolve,reject)=>{
        canvas.toBlob(blob=>blob?resolve(blob):
          reject(new Error("Could not encode printable page PNG.")),"image/png");
      });
      canvas.width=1;canvas.height=1; // release backing memory immediately
      const image=await output.embedPng(new Uint8Array(await png.arrayBuffer()));
      const origin=pagePosition(settings.media.width,settings.media.height,placement);
      sheet.drawImage(image,{
        x:origin.x,y:origin.y,
        width:placement.sourceWidth*placement.scale,
        height:placement.sourceHeight*placement.scale,
        rotate:degrees(-placement.sheetRotation)
      });
      current++;
      options.onProgress?.(current,faces.length);
    }
    const bytes=await output.save({useObjectStreams:true});
    if(bytes.byteLength>MAX_OUTPUT_BYTES){
      throw new PrintPreparationError(
        "Printable raster document exceeds 100 MiB limit.",
        "UNSUPPORTED_DOCUMENT"
      );
    }
    return {
      bytes,plan,mode:"raster",
      warnings:[
        "Existing annotations/forms required a raster fallback. Vector text and fine linework " +
          "in this print-ready copy may lose sharpness.",
        "This is a fixed-stock PDF, NOT proof of successful physical printing.",
        "Set the printer to the chosen paper and Actual Size (100%) before printing.",
        "Duplex and printer tray handling remain controlled by the operating-system dialog."
      ]
    };
  }finally{
    await source.destroy().catch(()=>undefined);
  }
}
