import {test} from "node:test";
import assert from "node:assert/strict";
import {PDFDocument,PDFArray,PDFDict,PDFName} from "pdf-lib";
import {
  newCallout,newTextBox,
  relocateMarkupBox,resizeMarkupBox,positionCalloutHandle,nudgeCalloutHandle,
  calloutToStandardPayload,
  initialEditorState,applyCommand,undo,
  pdfToViewport,viewportToPdf,
  type CalloutAnnotation,type Point,type Matrix
} from "@axik/document-core";
import {exportEditedPdf,readEditableAnnotations} from "@axik/pdf-writer";

const bounds={x:24,y:30,width:548,height:730};
function fixture(id="markup-corners"):CalloutAnnotation {
  return newCallout({id,pageIndex:0,tip:{x:80,y:270},pageBounds:bounds});
}

test("leader tip moves independently while text box and elbow stay in place",()=>{
  const original=fixture();
  const moved=positionCalloutHandle(original,"tip",{x:240,y:380},bounds);
  assert.deepEqual(moved.box,original.box);
  assert.deepEqual(moved.leader[0],{x:240,y:380});
  assert.deepEqual(moved.leader[1],original.leader[1]);
  assert.deepEqual(moved.leader.at(-1),original.leader.at(-1));
});

test("elbow is user-positionable, and dragging the box never erases it",()=>{
  const original=fixture();
  const bent=positionCalloutHandle(original,"elbow",{x:210,y:410},bounds);
  assert.deepEqual(bent.box,original.box);
  assert.deepEqual(bent.leader[0],original.leader[0]);
  assert.deepEqual(bent.leader[1],{x:210,y:410});
  const shifted=relocateMarkupBox(bent,{x:50,y:55},bounds);
  assert.deepEqual(shifted.leader[1],bent.leader[1]);
  assert.deepEqual(shifted.leader[0],bent.leader[0]);
  assert.notDeepEqual(shifted.leader[2],bent.leader[2]);
});

test("elbow drag turns straight 2-point leader into editable 3-point leader",()=>{
  const origin=fixture();
  const straight={...origin,leader:[origin.leader[0]!,origin.leader.at(-1)!]};
  const bent=positionCalloutHandle(straight,"elbow",{x:75,y:420},bounds);
  assert.equal(bent.leader.length,3);
  assert.deepEqual(bent.leader[0],straight.leader[0]);
  assert.deepEqual(bent.leader.at(-1),straight.leader.at(-1));
  assert.deepEqual(bent.leader[1],{x:75,y:420});
});

test("all four resize grips keep the opposite corner fixed and arrow target intact",()=>{
  const base=fixture();
  const rect=base.box;
  const left=rect.x,right=rect.x+rect.width;
  const bottom=rect.y,top=rect.y+rect.height;
  const actions=[
    {corner:"north-east",delta:{x:20,y:15},opposite:{x:left,y:bottom}},
    {corner:"north-west",delta:{x:-20,y:15},opposite:{x:right,y:bottom}},
    {corner:"south-west",delta:{x:-20,y:-15},opposite:{x:right,y:top}},
    {corner:"south-east",delta:{x:20,y:-15},opposite:{x:left,y:top}}
  ] as const;
  for(const {corner,delta,opposite} of actions){
    const updated=resizeMarkupBox(base,corner,delta,bounds);
    assert.deepEqual(updated.leader[0],base.leader[0]);
    assert.ok(updated.box.width>rect.width,"resizing should widen box");
    assert.ok(updated.box.height>rect.height,"resizing should grow box");
    const x=corner.includes("west")?updated.box.x+updated.box.width:updated.box.x;
    const y=corner.includes("north")?updated.box.y:updated.box.y+updated.box.height;
    assert.ok(Math.abs(x-opposite.x)<1e-6);
    assert.ok(Math.abs(y-opposite.y)<1e-6);
  }
});

test("resize clamps to crop bounds and minimums; text and callout both supported",()=>{
  const callout=fixture();
  const resized=resizeMarkupBox(callout,"south-east",{
    x:-1000,y:1000
  },bounds);
  assert.ok(resized.box.width>=48);
  assert.ok(resized.box.height>=24);
  assert.ok(resized.box.y>=bounds.y);
  assert.ok(resized.box.x+resized.box.width<=bounds.x+bounds.width);
  const text=newTextBox({
    id:"custom-text",pageIndex:0,location:{x:210,y:400},pageBounds:bounds
  });
  const changed=resizeMarkupBox(text,"north-east",{x:40,y:20},bounds);
  assert.equal(changed.box.x,text.box.x);
  assert.equal(changed.box.y,text.box.y);
  assert.deepEqual(changed.box.width,text.box.width+40);
});

test("leader handles are clamped; keyboard nudge uses fixed PDF points",()=>{
  const callout=fixture();
  const clip=positionCalloutHandle(callout,"tip",{x:9000,y:-9000},bounds);
  assert.deepEqual(clip.leader[0],{x:572,y:30});
  const nudged=nudgeCalloutHandle(callout,"elbow",bounds,"right",true);
  assert.equal(nudged.leader[1]!.x,callout.leader[1]!.x+10);
  assert.deepEqual(nudged.leader[0],callout.leader[0]);
});

test("rotated PDF viewport pointer drag still moves tip in correct PDF coordinates",()=>{
  const matrix:Matrix=[0,-2,2,0,140,1280];
  const original=fixture();
  const before:Point=pdfToViewport(matrix,original.leader[0]!);
  const target:Point={x:before.x+40,y:before.y-32};
  const pdfDelta:Point={
    x:viewportToPdf(matrix,target).x-viewportToPdf(matrix,before).x,
    y:viewportToPdf(matrix,target).y-viewportToPdf(matrix,before).y
  };
  const moved=positionCalloutHandle(original,"tip",{
    x:original.leader[0]!.x+pdfDelta.x,
    y:original.leader[0]!.y+pdfDelta.y
  },bounds);
  assert.equal(moved.leader[0]?.x,original.leader[0]!.x+16);
  assert.equal(moved.leader[0]?.y,original.leader[0]!.y+20);
});

test("changed leader and resized box round-trip PDF /CL /RD /AP, no duplicate",async()=>{
  const source=await PDFDocument.create();
  source.addPage([612,792]);
  const bytes=new Uint8Array(await source.save());
  const initial=fixture("round-trip-handles");
  const altered=resizeMarkupBox(
    positionCalloutHandle(
      positionCalloutHandle(initial,"tip",{x:100,y:220},bounds),
      "elbow",{x:155,y:190},bounds
    ),"north-east",{x:35,y:30},bounds
  );
  const edited=await exportEditedPdf(bytes,[altered]);
  const doc=await PDFDocument.load(edited.bytes);
  const annots=doc.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
  assert.equal(annots.size(),1);
  const dictionary=doc.context.lookup(annots.get(0),PDFDict);
  assert.equal(dictionary.lookup(PDFName.of("CL"),PDFArray).size(),6);
  assert.equal(dictionary.lookup(PDFName.of("RD"),PDFArray).size(),4);
  assert.ok(dictionary.lookup(PDFName.of("AP"),PDFDict).get(PDFName.of("N")));
  const imported=await readEditableAnnotations(edited.bytes);
  assert.equal(imported.length,1);
  assert.equal(imported[0]?.kind,"callout");
  if(imported[0]?.kind!=="callout")throw Error("expected native callout");
  assert.deepEqual(imported[0].leader,altered.leader);
  assert.deepEqual(imported[0].box,altered.box);
  const state=applyCommand(initialEditorState(imported),{
    type:"replace",annotation:{...imported[0],text:"Reviewed"}
  });
  assert.equal(undo(state).annotations[0]?.kind,"callout");
});
