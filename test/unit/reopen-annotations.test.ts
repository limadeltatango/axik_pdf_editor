import {test} from "node:test";
import assert from "node:assert/strict";
import {PDFDocument,PDFName,PDFArray,PDFDict,PDFHexString} from "pdf-lib";
import {
  newCallout,newTextBox,newStickyNote,initialEditorState,
  hasEdits,applyCommand,type Annotation
} from "@axik/document-core";
import {
  exportEditedPdf,readEditableAnnotations,planAnnotationEdits
} from "@axik/pdf-writer";

async function fixture(){
  const doc=await PDFDocument.create();
  doc.addPage([612,792]);
  const pageBounds={x:0,y:0,width:612,height:792};
  const samples:Annotation[]=[
    newCallout({
      id:"alpha-named-callout-1",pageIndex:0,
      tip:{x:60,y:250},pageBounds,
      text:"Confirm added fixture"
    }),
    newTextBox({
      id:"alpha-named-text-2",pageIndex:0,
      location:{x:125,y:660},pageBounds,text:"Proposed mounting height"
    }),
    newStickyNote({
      id:"alpha-named-note-3",pageIndex:0,
      position:{x:65,y:135},text:"Coordinate with electrician"
    })
  ];
  const bytes=new Uint8Array(await doc.save());
  return {samples,bytes};
}

function annotsIn(bytes:Uint8Array):Promise<number>{
  return PDFDocument.load(bytes).then(pdf=>{
    const list=pdf.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
    return list.size();
  });
}

test("reopen saved native Axik markups as clean/unchanged editable annotations",async()=>{
  const {samples,bytes}=await fixture();
  const first=await exportEditedPdf(bytes,samples);
  const imported=await readEditableAnnotations(first.bytes);
  assert.equal(imported.length,3);
  assert.deepEqual(imported.map(a=>a.kind),["callout","text","note"]);
  assert.deepEqual(imported.map(a=>a.id),samples.map(a=>a.id));
  for(const item of imported){
    assert.equal(item.sourceName,item.id);
  }
  assert.equal(hasEdits(initialEditorState(imported)),false);
  const plan=planAnnotationEdits(imported,imported);
  assert.equal(plan.changes.length,0);
  assert.equal(plan.removeNames.length,0);
});

test("edited imported callout replaces its PDF annotation, not an extra duplicate",async()=>{
  const {samples,bytes}=await fixture();
  const first=await exportEditedPdf(bytes,samples);
  const imported=await readEditableAnnotations(first.bytes);
  const updated={
    ...imported[0]!,
    text:"Fixture approved by reviewer",
    updatedAt:new Date("2026-10-13T19:20:00.000Z").toISOString()
  } as Annotation;
  const state=applyCommand(initialEditorState(imported),{
    type:"replace",annotation:updated
  });
  assert.equal(hasEdits(state),true);
  const delta=planAnnotationEdits(imported,state.annotations);
  assert.deepEqual(delta.changes.map(a=>a.id),[samples[0]!.id]);
  assert.deepEqual(delta.removeNames,[]);
  const saved=await exportEditedPdf(first.bytes,delta.changes,{
    removeNames:delta.removeNames
  });
  assert.equal(await annotsIn(saved.bytes),3);
  const reread=await readEditableAnnotations(saved.bytes);
  assert.equal(reread[0]?.text,"Fixture approved by reviewer");
  assert.equal(reread.length,3);
});

test("removing an imported note and text deletes precisely those native entries",async()=>{
  const {samples,bytes}=await fixture();
  const first=await exportEditedPdf(bytes,samples);
  const imported=await readEditableAnnotations(first.bytes);
  const delta=planAnnotationEdits(imported,[imported[0]!]);
  assert.deepEqual(delta.removeNames,[samples[1]!.id,samples[2]!.id]);
  const result=await exportEditedPdf(first.bytes,delta.changes,{
    removeNames:delta.removeNames
  });
  assert.equal(await annotsIn(result.bytes),1);
  const reread=await readEditableAnnotations(result.bytes);
  assert.deepEqual(reread.map(a=>a.id),[samples[0]!.id]);
});

test("unknown third-party native annotations remain unmodified",async()=>{
  const {samples,bytes}=await fixture();
  const src=await PDFDocument.load(bytes);
  const page=src.getPage(0);
  const foreign=src.context.obj({
    Type:PDFName.of("Annot"),Subtype:PDFName.of("Text"),
    T:PDFHexString.fromText("Third party"),
    NM:PDFHexString.fromText("foreign-note"),
    Rect:[20,20,40,40],Contents:PDFHexString.fromText("Do not erase")
  });
  page.node.set(PDFName.of("Annots"),
    src.context.obj([src.context.register(foreign)]));
  const withOther=await exportEditedPdf(new Uint8Array(await src.save()),samples);
  assert.equal(await annotsIn(withOther.bytes),4);
  const imported=await readEditableAnnotations(withOther.bytes);
  assert.equal(imported.length,3);
  const updated={...imported[0]!,text:"Change only our callout"} as Annotation;
  const delta=planAnnotationEdits(imported,[
    updated,imported[1]!,imported[2]!
  ]);
  const exportResult=await exportEditedPdf(withOther.bytes,delta.changes,{
    removeNames:delta.removeNames
  });
  const reopened=await PDFDocument.load(exportResult.bytes);
  assert.equal(await annotsIn(exportResult.bytes),4);
  const list=reopened.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
  const nameCount=Array.from({length:list.size()},(_,i)=>{
    const object=reopened.context.lookup(list.get(i),PDFDict);
    return object.lookup(PDFName.of("NM"));
  }).filter(x=>x instanceof PDFHexString && x.decodeText()==="foreign-note").length;
  assert.equal(nameCount,1);
});

test("annotation change planner refuses unauthorized sourceName substitutions",async()=>{
  const {samples,bytes}=await fixture();
  const first=await exportEditedPdf(bytes,samples);
  const imported=await readEditableAnnotations(first.bytes);
  assert.throws(()=>planAnnotationEdits(imported,[{
    ...imported[0]!,sourceName:undefined
  }]),RangeError);
});
