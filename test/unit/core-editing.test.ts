import {test} from "node:test";
import assert from "node:assert/strict";
import {PDFDocument,PDFArray,PDFDict,PDFName,PDFHexString,PDFString} from "pdf-lib";
import {newCallout,newStickyNote,newTextBox} from "@axik/document-core";
import {exportEditedPdf} from "@axik/pdf-writer";
import {applyPageOperations,mergePdfDocuments} from "@axik/page-operations";

function ids(){
  return {a:"demo-text-1",b:"demo-comment-1",c:"demo-callout-1"};
}
test("FreeText and Text Note annotations serialize in native PDF, remain distinguishable",async()=>{
  const pdf=await PDFDocument.create();pdf.addPage([612,792]);
  const box={x:0,y:0,width:612,height:792};
  const original=new Uint8Array(await pdf.save());
  const notes=[
    newTextBox({id:ids().a,pageIndex:0,pageBounds:box,
      location:{x:55,y:600},text:"Fixture schedule \u2013 proposed"}),
    newStickyNote({id:ids().b,pageIndex:0,position:{x:90,y:200},text:"Confirm beam location"}),
    newCallout({id:ids().c,pageIndex:0,tip:{x:40,y:280},
      pageBounds:box,text:"Add light fixture"})
  ];
  const output=await exportEditedPdf(original,notes);
  assert.equal(output.calloutsWritten,3);
  const read=await PDFDocument.load(output.bytes);
  const annotations=read.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
  assert.equal(annotations.size(),3);
  const dictionaries=Array.from({length:3},(_,i)=>read.context.lookup(annotations.get(i),PDFDict));
  assert.deepEqual(dictionaries.map(d=>d.lookup(PDFName.of("Subtype"),PDFName).asString()),
    ["/FreeText","/Text","/FreeText"]);
  const appearance=dictionaries[0]!.lookup(PDFName.of("AP"),PDFDict);
  assert.ok(appearance.get(PDFName.of("N")));
  assert.equal(dictionaries[2]!.lookup(PDFName.of("IT"),PDFName).asString(),"/FreeTextCallout");
  assert.equal(dictionaries[1]!.lookup(PDFName.of("Contents"),PDFHexString).decodeText(),
    "Confirm beam location");
});

test("Page reorder/crop/rotate engine keeps PDF page order and copied notes",async()=>{
  const source=await PDFDocument.create();
  source.addPage([612,792]).drawText("first",{x:40,y:700});
  source.addPage([792,612]).drawText("second",{x:40,y:500});
  const bytes=new Uint8Array(await source.save());
  const note=newStickyNote({id:"index-001",pageIndex:0,
    position:{x:130,y:160},text:"Existing coordination note"});
  const withNote=(await exportEditedPdf(bytes,[note])).bytes;
  const output=await applyPageOperations(withNote,[
    {sourceIndex:1,additionalRotation:90},
    {sourceIndex:0,additionalRotation:0}
  ]);
  const parsed=await PDFDocument.load(output.bytes);
  assert.equal(parsed.getPageCount(),2);
  assert.equal(parsed.getPage(0).getWidth(),792);
  assert.equal(parsed.getPage(0).getRotation().angle,90);
  const annots=parsed.getPage(1).node.lookup(PDFName.of("Annots"),PDFArray);
  assert.ok(annots&&annots.size()===1,
    "Existing native annotations must survive page copying");
});

test("Merge PDFs without mutating source bytes",async()=>{
  const left=await PDFDocument.create();left.addPage([612,792]);
  const right=await PDFDocument.create();right.addPage([612,792]);right.addPage([612,792]);
  const a=new Uint8Array(await left.save()),b=new Uint8Array(await right.save());
  const merged=await mergePdfDocuments([a,b]);
  assert.equal(merged.pageCount,3);
  assert.equal((await PDFDocument.load(merged.bytes)).getPageCount(),3);
  assert.deepEqual(a,new Uint8Array(await left.save()));
});
