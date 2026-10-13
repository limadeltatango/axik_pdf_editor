import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString,
  StandardFonts, type PDFFont, type PDFPage, type PDFRef
} from "pdf-lib";
import {
  calloutToStandardPayload, validateAnnotation,
  type Annotation, type CalloutAnnotation, type TextBoxAnnotation, type StickyNoteAnnotation, type Point
} from "@axik/document-core";

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const FONT_KEY = "AxikHelv";

export interface PdfExportResult {
  bytes: Uint8Array;
  calloutsWritten: number;
  warnings: string[];
}

function safePdfNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > 1e9) {
    throw new RangeError("Invalid PDF graphics coordinate.");
  }
  return String(Math.round(value * 1000) / 1000);
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  ];
}

function sanitizeForBaseFont(value: string, font: PDFFont): string {
  // Preserve original Unicode text in /Contents. The current built-in
  // appearance font is Helvetica WinAnsi; missing glyphs are displayed as '?'.
  let safe = "";
  for (const char of value) {
    if (char === "\r") continue;
    if (char === "\n" || char === "\t") {
      safe += char === "\t" ? "    " : "\n";
      continue;
    }
    try {
      font.encodeText(char);
      safe += char;
    } catch {
      safe += "?";
    }
  }
  return safe;
}

function wrapLines(font: PDFFont, value: string, width: number, fontSize: number): string[] {
  const all: string[] = [];
  const maxWidth = Math.max(fontSize, width);
  for (const paragraph of value.split("\n")) {
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      // Break extremely long tokens at glyph boundaries.
      let remaining = word;
      while (remaining && font.widthOfTextAtSize(remaining, fontSize) > maxWidth) {
        let prefix = "";
        for (const letter of remaining) {
          if (prefix && font.widthOfTextAtSize(prefix + letter, fontSize) > maxWidth) break;
          prefix += letter;
        }
        if (line) {
          all.push(line);
          line = "";
        }
        all.push(prefix);
        remaining = remaining.slice(prefix.length);
      }
      const proposed = line ? line + " " + remaining : remaining;
      if (line && font.widthOfTextAtSize(proposed, fontSize) > maxWidth) {
        all.push(line);
        line = remaining;
      } else {
        line = proposed;
      }
    }
    all.push(line);
  }
  return all;
}

function appearanceCommands(annotation: CalloutAnnotation, font: PDFFont, rect: readonly number[]): string {
  const [minX = 0, minY = 0] = rect;
  const p = (point: Point): string =>
    safePdfNumber(point.x - minX) + " " + safePdfNumber(point.y - minY);
  const box = annotation.box;
  const left = box.x - minX;
  const bottom = box.y - minY;
  const stroke = hexToRgb(annotation.style.stroke).map(safePdfNumber).join(" ");
  const fill = hexToRgb(annotation.style.fill).map(safePdfNumber).join(" ");
  const width = Math.max(0.25, annotation.style.lineWidth);
  const size = annotation.style.fontSize;
  const cmds: string[] = [
    "q",
    safePdfNumber(width) + " w",
    stroke + " RG",
    fill + " rg",
    [
      safePdfNumber(left), safePdfNumber(bottom),
      safePdfNumber(box.width), safePdfNumber(box.height), "re B"
    ].join(" "),
    stroke + " RG",
    annotation.leader.map((point, i) =>
      p(point) + (i === 0 ? " m" : " l")).join("\n"),
    "S"
  ];

  if (annotation.arrowHead !== "none" && annotation.leader.length >= 2) {
    const tip = annotation.leader[0]!;
    const next = annotation.leader[1]!;
    const vx = next.x - tip.x;
    const vy = next.y - tip.y;
    const length = Math.hypot(vx, vy);
    if (length > 0.01) {
      const unitX = vx / length;
      const unitY = vy / length;
      const size = Math.max(7, width * 6);
      const end = {
        x: tip.x + unitX * size,
        y: tip.y + unitY * size
      };
      const sideA = { x: end.x - unitY * size * 0.40, y: end.y + unitX * size * 0.40 };
      const sideB = { x: end.x + unitY * size * 0.40, y: end.y - unitX * size * 0.40 };
      cmds.push(
        stroke + " rg",
        p(tip) + " m",
        p(sideA) + " l",
        p(sideB) + " l",
        "h",
        annotation.arrowHead === "closed" ? "B" : "S"
      );
    }
  }

  const safe = sanitizeForBaseFont(annotation.text, font);
  const lines = wrapLines(font, safe, Math.max(10, box.width - 12), size);
  const allowedLines = Math.max(0, Math.floor((box.height - 12) / (size * 1.24)));
  const visibleLines = lines.slice(0, Math.min(allowedLines, 80));
  const lineHeight = size * 1.24;

  cmds.push(
    "0.09 0.14 0.20 rg",
    "BT",
    "/" + FONT_KEY + " " + safePdfNumber(size) + " Tf",
    "1 0 0 1 " + safePdfNumber(left + 6) + " " +
      safePdfNumber(bottom + box.height - size - 5) + " Tm"
  );
  for (const [index, line] of visibleLines.entries()) {
    if (index !== 0) cmds.push("0 " + safePdfNumber(-lineHeight) + " Td");
    // PDFHexString from font is a valid encoded PDF text operand.
    cmds.push(font.encodeText(line).toString() + " Tj");
  }
  cmds.push("ET", "Q");
  return cmds.join("\n") + "\n";
}

function isoPdfDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return "D:" + date.getUTCFullYear() + pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) + "Z";
}


function nativeName(dict:PDFDict):string|undefined{
  const obj=dict.lookup(PDFName.of("NM"));
  return obj instanceof PDFHexString || obj instanceof PDFString
    ? obj.decodeText() : undefined;
}
function nativeAuthor(dict:PDFDict):string|undefined{
  const obj=dict.lookup(PDFName.of("T"));
  return obj instanceof PDFHexString || obj instanceof PDFString
    ? obj.decodeText() : undefined;
}
function annotationList(page:PDFPage,doc:PDFDocument):PDFArray{
  const raw=page.node.get(PDFName.of("Annots"));
  if(raw)return doc.context.lookup(raw,PDFArray);
  const array=doc.context.obj([]) as PDFArray;
  page.node.set(PDFName.of("Annots"),array);
  return array;
}
function addOrReplace(
  doc:PDFDocument,page:PDFPage,annotation:Annotation,ref:PDFRef
):void{
  const array=annotationList(page,doc);
  const matches:number[]=[];
  for(let i=0;i<array.size();i++){
    let dict:PDFDict;
    try{dict=doc.context.lookup(array.get(i),PDFDict)}catch{continue}
    if(nativeName(dict)===(annotation.sourceName??annotation.id)){
      matches.push(i);
      if(annotation.sourceName && nativeAuthor(dict)!=="Axik PDF"){
        throw new Error("Cannot change an annotation not owned by Axik PDF.");
      }
    }
  }
  if(!annotation.sourceName){
    if(matches.length)throw new Error("A PDF annotation already uses this identifier.");
    array.push(ref);
    return;
  }
  if(matches.length!==1){
    throw new Error("Existing annotation was not uniquely found. Original PDF remains unchanged.");
  }
  array.set(matches[0]!,ref);
}
function removeExisting(doc:PDFDocument,names:readonly string[]):void{
  const unique=new Set(names);
  if(unique.size!==names.length || names.length>1000){
    throw new RangeError("Invalid native annotation deletion list.");
  }
  for(const name of unique){
    if(typeof name!=="string" || !name.length || name.length>128){
      throw new RangeError("Unsafe native annotation reference.");
    }
    let found=0;
    for(const page of doc.getPages()){
      const raw=page.node.get(PDFName.of("Annots"));
      if(!raw)continue;
      const array=doc.context.lookup(raw,PDFArray);
      for(let i=array.size()-1;i>=0;i--){
        const dict=doc.context.lookup(array.get(i),PDFDict);
        if(nativeName(dict)===name){
          if(nativeAuthor(dict)!=="Axik PDF"){
            throw new Error("Cannot delete a non-Axik PDF annotation.");
          }
          array.remove(i);
          found++;
        }
      }
    }
    if(found!==1){
      throw new Error("Existing annotation to remove was missing or duplicated.");
    }
  }
}

function addCallout(doc: PDFDocument, font: PDFFont, annotation: CalloutAnnotation): void {
  validateAnnotation(annotation);
  if (annotation.pageIndex >= doc.getPageCount()) throw new RangeError("Annotation page does not exist.");
  const page = doc.getPage(annotation.pageIndex);
  const context = doc.context;
  const payload = calloutToStandardPayload(annotation);
  const rect = [...payload.rect];
  const w = rect[2]! - rect[0]!;
  const h = rect[3]! - rect[1]!;
  if (w <= 0 || h <= 0 || w > 1e7 || h > 1e7) {
    throw new RangeError("Callout appearance bounds invalid.");
  }

  const appearanceStream = context.flateStream(
    appearanceCommands(annotation, font, rect),
    {
      Type: PDFName.of("XObject"),
      Subtype: PDFName.of("Form"),
      FormType: 1,
      BBox: [0, 0, w, h],
      Resources: { Font: { [FONT_KEY]: font.ref } }
    }
  );
  const appearanceRef = context.register(appearanceStream);
  const stroke = hexToRgb(annotation.style.stroke);
  const textBox = payload.textBoxRect;
  // PDF /RD stores the differences between annotation Rect and text-box edges.
  const rd = [
    textBox[0]! - rect[0]!, textBox[1]! - rect[1]!,
    rect[2]! - textBox[2]!, rect[3]! - textBox[3]!
  ];
  const author = (annotation.author || "Axik PDF").slice(0, 80);
  const state = context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("FreeText"),
    IT: PDFName.of("FreeTextCallout"),
    Rect: rect,
    RD: rd,
    CL: [...payload.calloutLine],
    LE: PDFName.of(annotation.arrowHead === "closed" ? "ClosedArrow" :
      annotation.arrowHead === "open" ? "OpenArrow" : "None"),
    Contents: PDFHexString.fromText(annotation.text),
    T: PDFHexString.fromText(author),
    NM: PDFHexString.fromText(annotation.id),
    M: PDFString.of(isoPdfDate(new Date(annotation.updatedAt))),
    F: 4, // Print flag: exported annotations appear on printed pages.
    Q: 0,
    DA: PDFString.of("/" + FONT_KEY + " " + safePdfNumber(annotation.style.fontSize) + " Tf 0 0 0 rg"),
    DS: PDFString.of("font: " + safePdfNumber(annotation.style.fontSize) +
      "pt Helvetica; color: #17212c;"),
    BS: { W: annotation.style.lineWidth, S: PDFName.of("S") },
    C: stroke,
    CA: annotation.style.opacity,
    AP: { N: appearanceRef }
  });
  const reference = context.register(state);
  addOrReplace(doc,page,annotation,reference);
}


function addFreeText(doc:PDFDocument,font:PDFFont,a:TextBoxAnnotation):void{
  validateAnnotation(a);
  if(a.pageIndex>=doc.getPageCount())throw new RangeError("Text box page does not exist.");
  const page=doc.getPage(a.pageIndex);
  const context=doc.context;
  const {box}=a;
  const size=a.style.fontSize;
  const safe=sanitizeForBaseFont(a.text,font);
  const lines=wrapLines(font,safe,Math.max(12,box.width-12),size)
    .slice(0,Math.max(0,Math.min(100,Math.floor((box.height-12)/(size*1.24)))));
  const color=hexToRgb(a.style.stroke).map(safePdfNumber).join(" ");
  const stream=[
    "q",color+" rg","BT","/"+FONT_KEY+" "+safePdfNumber(size)+" Tf",
    "1 0 0 1 6 "+safePdfNumber(box.height-size-5)+" Tm",
    ...lines.flatMap((line,i)=>[
      ...(i ? ["0 "+safePdfNumber(-size*1.24)+" Td"] : []),
      font.encodeText(line).toString()+" Tj"
    ]),
    "ET","Q"
  ].join("\n")+"\n";
  const appearance=context.register(context.flateStream(stream,{
    Type:PDFName.of("XObject"),
    Subtype:PDFName.of("Form"),
    FormType:1,
    BBox:[0,0,box.width,box.height],
    Resources:{Font:{[FONT_KEY]:font.ref}}
  }));
  const dict=context.obj({
    Type:PDFName.of("Annot"),
    Subtype:PDFName.of("FreeText"),
    Rect:[box.x,box.y,box.x+box.width,box.y+box.height],
    Contents:PDFHexString.fromText(a.text),
    T:PDFHexString.fromText((a.author||"Axik PDF").slice(0,80)),
    NM:PDFHexString.fromText(a.id),
    M:PDFString.of(isoPdfDate(new Date(a.updatedAt))),
    F:4,Q:0,
    DA:PDFString.of("/"+FONT_KEY+" "+safePdfNumber(size)+" Tf "+color+" rg"),
    DS:PDFString.of("font: "+safePdfNumber(size)+"pt Helvetica;"),
    C:hexToRgb(a.style.stroke),
    AP:{N:appearance}
  });
  const ref=context.register(dict);
  addOrReplace(doc,page,a,ref);
}


function addStickyNote(doc:PDFDocument,font:PDFFont,n:StickyNoteAnnotation):void{
  validateAnnotation(n);
  if(n.pageIndex>=doc.getPageCount())throw new RangeError("Comment page does not exist.");
  const page=doc.getPage(n.pageIndex);
  const c=doc.context;
  const size=20;
  const appearance=c.register(c.flateStream(
    ["q","0.98 0.84 0.25 rg",
      "0 0 20 20 re f",
      "0.50 0.30 0.03 RG 1 w","0.5 0.5 19 19 re S",
      "BT","/"+FONT_KEY+" 14 Tf","0.20 0.19 0.10 rg",
      "1 0 0 1 7 4 Tm","(i) Tj","ET","Q"
    ].join("\n")+"\n",
    {Type:PDFName.of("XObject"),Subtype:PDFName.of("Form"),
     FormType:1,BBox:[0,0,size,size],
     Resources:{Font:{[FONT_KEY]:font.ref}}}
  ));
  const state=c.obj({
    Type:PDFName.of("Annot"),Subtype:PDFName.of("Text"),
    Name:PDFName.of("Comment"),
    Rect:[n.position.x,n.position.y,n.position.x+size,n.position.y+size],
    Contents:PDFHexString.fromText(n.text),
    T:PDFHexString.fromText((n.author||"Axik PDF").slice(0,80)),
    NM:PDFHexString.fromText(n.id),
    M:PDFString.of(isoPdfDate(new Date(n.updatedAt))),
    F:4,Open:false,C:[1,0.84,0.25],
    AP:{N:appearance}
  });
  const ref=c.register(state);
  addOrReplace(doc,page,n,ref);
}

/**
 * ALPHA: Write PDF-native, editable FreeText callout dictionaries and appearance
 * streams for a bounded source PDF. Visual rendering and interoperability with
 * Acrobat/PDF-XChange still require external validation.
 *
 * Never overwrite the original; caller should download a separate edited copy.
 */
export async function exportEditedPdf(
  original: Uint8Array,
  annotations: readonly Annotation[],
  options: {removeNames?: readonly string[]} = {}
): Promise<PdfExportResult> {
  if (!original.byteLength || original.byteLength > MAX_INPUT_BYTES) {
    throw new RangeError("The alpha writer supports source PDFs up to 100 MiB.");
  }
  if (annotations.length > 1_000) {
    throw new RangeError("The alpha writer supports up to 1,000 callouts.");
  }
  const supported: Annotation[] = [];
  for(const annotation of annotations){
    validateAnnotation(annotation);
    supported.push(annotation);
  }

  const doc = await PDFDocument.load(original.slice(), {
    updateMetadata: false,
    ignoreEncryption: false
  });
  if(options.removeNames?.length)removeExisting(doc,options.removeNames);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const warnings: string[] = [];
  for (const annotation of supported) {
    if(annotation.kind==="note"){
      addStickyNote(doc,font,annotation);
      continue;
    }
    if (annotation.style.opacity !== 1) {
      warnings.push("Alpha appearance currently treats opacity as fully opaque.");
    }
    const sanitized = sanitizeForBaseFont(annotation.text, font);
    if (sanitized !== annotation.text.replace(/\r/g, "")) {
      warnings.push("Unsupported Helvetica glyphs were substituted in visual appearance; /Contents retains original text.");
    }
    const visibleRows = wrapLines(font, sanitized, Math.max(10, annotation.box.width - 12), annotation.style.fontSize);
    if (visibleRows.length > Math.floor((annotation.box.height - 12) / (annotation.style.fontSize * 1.24))) {
      warnings.push("One or more long labels may be clipped visually; full text remains in /Contents.");
    }
    if(annotation.kind==="callout")addCallout(doc,font,annotation);
    else addFreeText(doc,font,annotation);
  }
  // Full rewrite avoids leaving an appended incremental state in ordinary edits;
  // this is NOT a secure redaction/sanitization implementation.
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  if (bytes.length < 8 || new TextDecoder().decode(bytes.subarray(0, 8)).indexOf("%PDF") < 0) {
    throw new Error("The PDF writer did not return a valid PDF header.");
  }
  return {
    bytes,
    calloutsWritten: annotations.length,
    warnings: [...new Set(warnings)]
  };
}

export {readEditableAnnotations} from "./read-annotations";
export {planAnnotationEdits} from "./diff-annotations";
export type {PlannedAnnotationEdits} from "./diff-annotations";
