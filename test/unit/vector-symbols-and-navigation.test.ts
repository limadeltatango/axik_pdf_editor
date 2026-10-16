import {test} from "node:test";
import assert from "node:assert/strict";
import {PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName} from "pdf-lib";
import {
  kitchenLinearLightTemplate,symbolExtents,makeSymbolAnnotation,
  symbolTransform,updateSymbolComponent,validateSymbolTemplate,
  initialEditorState,applyCommand,undo,resizeMarkupBox,relocateMarkupBox
} from "@axik/document-core";
import {exportEditedPdf,readEditableAnnotations,planAnnotationEdits} from "@axik/pdf-writer";
import {
  wheelZoomFactor,nextPointerZoom,anchoredScrollDelta,panScrollPosition
} from "../../packages/editor-ui/src/pan-zoom";

const page={x:0,y:0,width:612,height:792};
test("compound kitchen linear-light fixture has two independently editable rectangles",()=>{
  const template=kitchenLinearLightTemplate();
  assert.equal(template.primitives.length,2);
  assert.equal(template.primitives[0]?.width,20);
  assert.equal(template.primitives[1]?.width,110);
  const changed=updateSymbolComponent(template,"luminaire",{width:145});
  assert.equal(changed.primitives[1]?.width,145);
  assert.equal(template.primitives[1]?.width,110);
  assert.equal(symbolExtents(changed.primitives).width,145);
  assert.throws(()=>updateSymbolComponent(template,"luminaire",{width:-1}),RangeError);
});

test("grouped stamp rotates, resizes, moves and undoes as one annotation",()=>{
  const template=kitchenLinearLightTemplate();
  const origin=makeSymbolAnnotation(template,{x:80,y:300},page,"light-instance-1");
  const resized=resizeMarkupBox(origin,"north-east",{x:32,y:20},page);
  const moved=relocateMarkupBox(resized,{x:40,y:30},page);
  const rotated={...moved,rotation:45};
  const t=symbolTransform(rotated);
  assert.ok([t.a,t.b,t.c,t.d,t.e,t.f].every(Number.isFinite));
  const state=applyCommand(initialEditorState([origin]),{
    type:"replace",annotation:rotated
  });
  assert.equal(state.undoStack.length,1);
  assert.deepEqual(undo(state).annotations[0],origin);
  assert.equal(origin.primitives.length,2);
});

test("PDF export preserves vector Stamp appearance and Axik compound metadata",async()=>{
  const pdf=await PDFDocument.create();
  pdf.addPage([612,792]);
  const bytes=new Uint8Array(await pdf.save());
  const item=makeSymbolAnnotation(kitchenLinearLightTemplate(),
    {x:100,y:300},page,"light-100");
  const first=await exportEditedPdf(bytes,[item]);
  const reopened=await PDFDocument.load(first.bytes);
  const arr=reopened.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
  assert.equal(arr.size(),1);
  const dict=reopened.context.lookup(arr.get(0),PDFDict);
  assert.equal(dict.lookup(PDFName.of("Subtype"),PDFName).asString(),"/Stamp");
  assert.ok(dict.lookup(PDFName.of("AP"),PDFDict).get(PDFName.of("N")));
  const raw=dict.lookup(PDFName.of("AxikSymbol"),PDFHexString);
  assert.equal(JSON.parse(raw.decodeText()).primitives.length,2);
  const loaded=await readEditableAnnotations(first.bytes);
  assert.equal(loaded.length,1);
  assert.equal(loaded[0]?.kind,"symbol");
  if(loaded[0]?.kind!=="symbol")throw Error("symbol missing");
  assert.equal(loaded[0].primitives[1]?.width,110);
  const changed={
    ...loaded[0],rotation:90,
    primitives:loaded[0].primitives.map(p=>
      p.id==="luminaire"?{...p,width:150}:p)
  };
  const plan=planAnnotationEdits(loaded,[changed]);
  assert.equal(plan.changes.length,1);
  const edited=await exportEditedPdf(first.bytes,plan.changes,{
    removeNames:plan.removeNames
  });
  const verify=await PDFDocument.load(edited.bytes);
  assert.equal(verify.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray).size(),1);
  const reread=await readEditableAnnotations(edited.bytes);
  assert.equal(reread[0]?.kind,"symbol");
  if(reread[0]?.kind!=="symbol")throw Error("import failed");
  assert.equal(reread[0].rotation,90);
  assert.equal(reread[0].primitives[1]?.width,150);
});

test("single-primitive rectangle and diagonal line remain valid vector symbols",()=>{
  const rectangle=validateSymbolTemplate({version:1,id:"rect",name:"Rectangle",primitives:[
    {id:"rect-1",type:"rect",x:0,y:0,width:60,height:30,
      stroke:"#000000",fill:"none",lineWidth:1}
  ]});
  assert.equal(symbolExtents(rectangle.primitives).width,60);
  const line=validateSymbolTemplate({version:1,id:"line",name:"Diagonal",primitives:[
    {id:"line-1",type:"line",x:55,y:30,width:-55,height:-30,
      stroke:"#000000",fill:"none",lineWidth:1}
  ]});
  assert.equal(symbolExtents(line.primitives).height,30);
  assert.equal(makeSymbolAnnotation(line,{x:40,y:200},page,"line-one").kind,"symbol");
});

test("Ctrl+wheel zoom has pointer anchors and bounded multiplier",()=>{
  assert.ok(wheelZoomFactor(-100)>1);
  assert.ok(wheelZoomFactor(100)<1);
  assert.equal(nextPointerZoom(8,-100),8);
  assert.equal(nextPointerZoom(.1,100),.1);
  assert.ok(Math.abs(anchoredScrollDelta(220,200,100,.4)-20)<1e-9);
  assert.deepEqual(panScrollPosition({left:150,top:300},{x:30,y:-50}),
    {left:120,top:350});
  assert.deepEqual(panScrollPosition({left:10,top:10},{x:50,y:50}),
    {left:0,top:0});
});
