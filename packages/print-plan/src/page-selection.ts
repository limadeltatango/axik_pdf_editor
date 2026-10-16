/**
 * APDF-59: user-printable page selections are always SOURCE page numbers.
 * Parsing and range expansion must fail closed; no silent extra sheets.
 */
export type PrintPageMode = "all" | "current" | "custom";
export interface PrintPageSelection {
  mode: PrintPageMode;
  currentPage: number;  // 1-based
  rangeText: string;
}

/** Parses user-facing 1-based strings and returns distinct zero-based indices. */
export function parsePrintPageRange(
  range: string, sourcePageCount: number
): number[] {
  if (!Number.isSafeInteger(sourcePageCount) ||
      sourcePageCount < 1 || sourcePageCount > 100_000) {
    throw new RangeError("Invalid PDF page count.");
  }
  if (typeof range !== "string" || range.length > 2000 ||
      !range.trim()) throw new RangeError("Enter at least one page number.");
  const parts = range.split(",");
  if(parts.length > sourcePageCount+1 || parts.some(p=>!p.trim())){
    throw new RangeError("Print range contains an empty or invalid part.");
  }
  const indices:number[]=[];
  const seen=new Set<number>();
  for(const raw of parts){
    const m=/^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(raw);
    if(!m)throw new RangeError("Use page numbers such as 2-5, 8, 11-14.");
    const first=Number(m[1]),last=m[2]===undefined?first:Number(m[2]);
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||
       first<1 || last<first || last>sourcePageCount){
      throw new RangeError(
        "Print range must have increasing pages between 1 and "+sourcePageCount+"."
      );
    }
    for(let page=first;page<=last;page++){
      if(seen.has(page)){
        throw new RangeError("Page "+page+" is selected more than once.");
      }
      seen.add(page);
      indices.push(page-1);
    }
  }
  if(!indices.length)throw new RangeError("No pages selected.");
  return indices;
}

/** Non-contiguous user ordering is preserved, e.g. 7, 2-4. */
export function resolvePrintPageSelection(
  selection: PrintPageSelection, sourcePageCount: number
): number[] {
  if(!Number.isSafeInteger(sourcePageCount)||sourcePageCount<1 ||
      sourcePageCount>100_000)throw new RangeError("Invalid PDF page count.");
  switch(selection.mode){
    case "all":return Array.from({length:sourcePageCount},(_,i)=>i);
    case "current":
      if(!Number.isSafeInteger(selection.currentPage) ||
         selection.currentPage<1 ||
         selection.currentPage>sourcePageCount){
        throw new RangeError("Current page is outside the PDF.");
      }
      return [selection.currentPage-1];
    case "custom":
      return parsePrintPageRange(selection.rangeText,sourcePageCount);
    default:throw new RangeError("Unknown print selection mode.");
  }
}

/** Validates internal zero-based selection independently of the UI. */
export function validatePrintIndices(
  sourcePageCount:number, indices:readonly number[] | undefined
): number[] {
  if(!Number.isSafeInteger(sourcePageCount) || sourcePageCount<1 ||
     sourcePageCount>100_000)throw new RangeError("Invalid PDF page count.");
  const output=indices === undefined
    ?Array.from({length:sourcePageCount},(_,i)=>i):[...indices];
  if(output.length===0 || output.length>sourcePageCount){
    throw new RangeError("Print selection must contain one or more distinct pages.");
  }
  const seen=new Set<number>();
  for(const index of output){
    if(!Number.isSafeInteger(index)||index<0 ||index>=sourcePageCount ||
       seen.has(index))throw new RangeError("Invalid or duplicate selected PDF page.");
    seen.add(index);
  }
  return output;
}
