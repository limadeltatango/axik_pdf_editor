import {test} from "node:test";
import assert from "node:assert/strict";
import {PDFArray,PDFDocument,PDFName} from "pdf-lib";
import {
  parsePrintPageRange,resolvePrintPageSelection,validatePrintIndices,
  LETTER_PORTRAIT,DEFAULT_MARGINS
} from "@axik/print-plan";
import {normalizeForFixedStockPrinting} from "@axik/print-document";

test("All/Current/Custom are source pages and preserve requested order",()=>{
  assert.deepEqual(resolvePrintPageSelection({
    mode:"all",currentPage:6,rangeText:""
  },7),[0,1,2,3,4,5,6]);
  assert.deepEqual(resolvePrintPageSelection({
    mode:"current",currentPage:6,rangeText:""
  },7),[5]);
  assert.deepEqual(parsePrintPageRange("2-5, 8, 11-14",15),
    [1,2,3,4,7,10,11,12,13]);
  assert.deepEqual(parsePrintPageRange("7, 2-4",10),[6,1,2,3]);
});

test("Invalid, duplicate and out-of-range print page requests fail CLOSED",()=>{
  for(const range of [
    ""," ",",","1,","1,,3","1-","-1","1-0","3-2",
    "3, 3","1-3,2","0","1.5","3..7","a-b","100","2-7x"
  ]){
    assert.throws(()=>parsePrintPageRange(range,20),RangeError,range);
  }
  assert.throws(()=>resolvePrintPageSelection({
    mode:"current",currentPage:21,rangeText:""
  },20),RangeError);
  assert.throws(()=>validatePrintIndices(20,[3,3]),RangeError);
  assert.throws(()=>validatePrintIndices(20,[]),RangeError);
});

async function source(){
  const doc=await PDFDocument.create();
  for(let i=0;i<8;i++){
    const page=doc.addPage(i%2?[792,612]:[612,792]);
    page.drawText("Source page "+(i+1),{x:40,y:300,size:16});
  }
  return new Uint8Array(await doc.save());
}
const settings={
  media:LETTER_PORTRAIT,margins:DEFAULT_MARGINS,
  scaling:"shrink-to-fit" as const,duplex:"simplex" as const
};
test("Output PDF contains only selected non-contiguous pages in exact order",async()=>{
  const bytes=await source();
  const selected=[6,1,2,3];
  const result=await normalizeForFixedStockPrinting(bytes,{
    ...settings,selectedPageIndices:selected
  });
  assert.equal(result.plan.sheets.length,4);
  assert.deepEqual(result.plan.sheets.map(s=>s.faces[0]?.placement?.pageIndex),
    selected);
  assert.equal((await PDFDocument.load(result.pdf)).getPageCount(),4);
  const all=await normalizeForFixedStockPrinting(bytes,settings);
  assert.equal((await PDFDocument.load(all.pdf)).getPageCount(),8);
});

test("Duplex pairing starts with first selected source page and pads odd back",async()=>{
  const bytes=await source();
  const result=await normalizeForFixedStockPrinting(bytes,{
    ...settings,duplex:"long-edge",selectedPageIndices:[7,1,6]
  });
  assert.deepEqual(result.plan.sheets.map(sheet=>
    sheet.faces.map(face=>face.placement?.pageIndex ?? null)
  ),[[7,1],[6,null]]);
  const doc=await PDFDocument.load(result.pdf);
  assert.equal(doc.getPageCount(),4);
});

test("Annotations on unselected source pages do not force raster fallback",async()=>{
  const original=await PDFDocument.load(await source());
  const annotation=original.context.obj({
    Type:PDFName.of("Annot"),Subtype:PDFName.of("Text"),
    Rect:[10,10,20,20],F:4
  });
  original.getPage(5).node.set(PDFName.of("Annots"),
    original.context.obj([original.context.register(annotation)]));
  const bytes=new Uint8Array(await original.save());
  const clean=await normalizeForFixedStockPrinting(bytes,{
    ...settings,selectedPageIndices:[0,1]
  });
  assert.equal(clean.plan.sheets.length,2);
  await assert.rejects(normalizeForFixedStockPrinting(bytes,{
    ...settings,selectedPageIndices:[5]
  }));
});
