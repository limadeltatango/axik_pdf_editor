import {test} from "node:test";
import assert from "node:assert/strict";
import {PDFDocument,PDFName,PDFArray,PDFDict,PDFHexString} from "pdf-lib";
import {newVisualSignature,validateAnnotation,initialEditorState,applyCommand} from "@axik/document-core";
import {exportEditedPdf,readEditableAnnotations,planAnnotationEdits} from "@axik/pdf-writer";

const bounds={x:0,y:0,width:612,height:792};
const strokes=[
  [{x:0.02,y:0.8},{x:0.2,y:0.4},{x:0.52,y:0.7}],
  [{x:0.2,y:0.9},{x:0.7,y:0.2},{x:0.98,y:0.5}]
] as const;

test("visual signature validates 0–1 ink strokes and never claims cryptographic signing",()=>{
  const ink=newVisualSignature({
    id:"signature-test-1",pageIndex:0,location:{x:90,y:200},
    pageBounds:bounds,strokes
  });
  assert.equal(ink.intent,"VisualInkSignature");
  assert.match(ink.text,/not digitally certified/);
  assert.equal(ink.strokes.length,2);
  assert.throws(()=>validateAnnotation({
    ...ink,strokes:[[{x:1.01,y:0},{x:0,y:1}]]
  }),RangeError);
  assert.equal(initialEditorState([ink]).revision,0);
  assert.equal(applyCommand(initialEditorState(),{type:"add",annotation:ink}).revision,1);
});

test("native PDF ink signature round-trips without creating a certificate signature dictionary",async()=>{
  const original=await PDFDocument.create();
  original.addPage([612,792]);
  const input=new Uint8Array(await original.save());
  const sig=newVisualSignature({
    id:"signature-test-2",pageIndex:0,location:{x:100,y:275},
    pageBounds:bounds,strokes
  });
  const modified=await exportEditedPdf(input,[sig]);
  const doc=await PDFDocument.load(modified.bytes);
  const annots=doc.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
  assert.equal(annots.size(),1);
  const dict=doc.context.lookup(annots.get(0),PDFDict);
  assert.equal(dict.lookup(PDFName.of("Subtype"),PDFName).asString(),"/Ink");
  assert.equal(dict.lookup(PDFName.of("Subj"),PDFHexString).decodeText(),
    "Axik Visual Signature (non-certified)");
  assert.ok(dict.lookup(PDFName.of("AP"),PDFDict).get(PDFName.of("N")));
  assert.equal(dict.lookup(PDFName.of("InkList"),PDFArray).size(),2);
  assert.equal(doc.getForm().getFields().length,0);
  const imported=await readEditableAnnotations(modified.bytes);
  assert.equal(imported.length,1);
  assert.equal(imported[0]?.kind,"signature");
  if(imported[0]?.kind!=="signature")throw Error("Cannot import our own visual signature");
  assert.deepEqual(imported[0].strokes.map(s=>s.length),[3,3]);
  assert.equal(imported[0].sourceName,sig.id);
  const plan=planAnnotationEdits(imported,imported);
  assert.deepEqual(plan,{changes:[],removeNames:[]});
});

test("updating visual signature ink replaces native object by NM; no duplicate appears",async()=>{
  const original=await PDFDocument.create();
  original.addPage([612,792]);
  const raw=new Uint8Array(await original.save());
  const sig=newVisualSignature({
    id:"signature-test-3",pageIndex:0,location:{x:90,y:150},
    pageBounds:bounds,strokes
  });
  const first=(await exportEditedPdf(raw,[sig])).bytes;
  const imported=await readEditableAnnotations(first);
  if(imported[0]?.kind!=="signature")throw Error("Signature import failed");
  const changed={...imported[0],lineWidth:2.5,updatedAt:new Date().toISOString()};
  const plan=planAnnotationEdits(imported,[changed]);
  const result=await exportEditedPdf(first,plan.changes,{removeNames:plan.removeNames});
  const saved=await PDFDocument.load(result.bytes);
  const a=saved.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
  assert.equal(a.size(),1);
  const again=await readEditableAnnotations(result.bytes);
  assert.equal(again.length,1);
  assert.equal(again[0]?.kind,"signature");
});
