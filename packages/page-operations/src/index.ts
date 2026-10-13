import {PDFDocument,degrees} from "pdf-lib";
import {normalizeRotation,type Rotation} from "@axik/document-core";

/** A source page can be reused, reordered, deleted or rotated in the output. */
export interface PageOperation {
  readonly sourceIndex:number;
  /** Clockwise rotation relative to the source page's own /Rotate. */
  readonly additionalRotation:Rotation;
}
export type PageOperationWarning = "DIGITAL_SIGNATURES_INVALIDATED" |
  "ANNOTATION_LAYOUT_MAY_CHANGE" | "FORM_FIELDS_REQUIRE_REVIEW";

export class PageOperationError extends Error{
  constructor(message:string){
    super(message);
    this.name="PageOperationError";
  }
}

const MAX_INPUT_BYTES=150*1024*1024;
const MAX_PAGES=500;

function assertInput(bytes:Uint8Array){
  if(!bytes.length||bytes.length>MAX_INPUT_BYTES){
    throw new PageOperationError("PDF source is empty or exceeds 150 MiB.");
  }
}
function assertPageOrder(order:readonly PageOperation[],pageCount:number){
  if(!order.length||order.length>MAX_PAGES){
    throw new PageOperationError("Page output must have 1–500 pages.");
  }
  for(const entry of order){
    if(!Number.isSafeInteger(entry.sourceIndex)||entry.sourceIndex<0 ||
      entry.sourceIndex>=pageCount){
      throw new PageOperationError("A page operation refers to an invalid page.");
    }
    normalizeRotation(entry.additionalRotation);
  }
}

export interface PageOperationResult {
  bytes:Uint8Array;
  pageCount:number;
  warnings:PageOperationWarning[];
}

/**
 * Save a derivative, never mutate the source. copyPages generally transfers
 * native annotations and page content, unlike embedPage print composition.
 * External annotator interoperability and signed/form PDFs still need checks.
 */
export async function applyPageOperations(
  original:Uint8Array,
  order:readonly PageOperation[]
):Promise<PageOperationResult>{
  assertInput(original);
  const source=await PDFDocument.load(original.slice(),{updateMetadata:false});
  assertPageOrder(order,source.getPageCount());
  const target=await PDFDocument.create();
  const copies=await target.copyPages(source,order.map(x=>x.sourceIndex));
  for(let i=0;i<order.length;i++){
    const page=copies[i]!;
    const spec=order[i]!;
    const angle=normalizeRotation(page.getRotation().angle+spec.additionalRotation);
    page.setRotation(degrees(angle));
    target.addPage(page);
  }
  const bytes=new Uint8Array(await target.save({useObjectStreams:true}));
  const verify=await PDFDocument.load(bytes);
  if(verify.getPageCount()!==order.length){
    throw new PageOperationError("PDF validation failed after page operations.");
  }
  return {
    bytes,pageCount:order.length,
    warnings:["DIGITAL_SIGNATURES_INVALIDATED","FORM_FIELDS_REQUIRE_REVIEW"]
  };
}

export async function mergePdfDocuments(sources:readonly Uint8Array[]):Promise<PageOperationResult>{
  if(!sources.length||sources.length>20){
    throw new PageOperationError("Merge supports 1–20 input documents.");
  }
  const target=await PDFDocument.create();
  for(const bytes of sources){
    assertInput(bytes);
    const source=await PDFDocument.load(bytes.slice(),{updateMetadata:false});
    const pages=await target.copyPages(source,source.getPageIndices());
    for(const page of pages){
      if(target.getPageCount()>=MAX_PAGES){
        throw new PageOperationError("Merged file exceeds 500 pages.");
      }
      target.addPage(page);
    }
  }
  const bytes=new Uint8Array(await target.save());
  return {
    bytes,pageCount:target.getPageCount(),
    warnings:["DIGITAL_SIGNATURES_INVALIDATED","FORM_FIELDS_REQUIRE_REVIEW"]
  };
}
