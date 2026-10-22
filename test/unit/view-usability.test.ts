import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newCallout,newTextBox,relocateMarkupBox,nudgeMarkupBox,
  initialEditorState,applyCommand,undo,redo,
  pdfToViewport,viewportToPdf,type Matrix
} from "@axik/document-core";
import {
  groupVisiblePages,spreadForPage,adjacentPage,pageGroupIndex,
  zoomToFit,normalizedViewPreferences,scaledPageSize,MAX_ACTIVE_VIEW_PAGES
} from "../../packages/editor-ui/src/view-layout";
import {budgetCanvas,MAX_PAGE_RASTER_PIXELS} from "../../packages/editor-ui/src/render-sizing";

const bounds={x:0,y:0,width:612,height:792};

test("drag callout box without moving original arrow tip and commit one Undo",()=>{
  const callout=newCallout({
    id:"drag-test",pageIndex:0,tip:{x:72,y:300},pageBounds:bounds
  });
  const moved=relocateMarkupBox(callout,{x:140,y:100},bounds);
  assert.deepEqual(moved.leader[0],callout.leader[0]);
  assert.notDeepEqual(moved.box,callout.box);
  assert.notDeepEqual(moved.leader[moved.leader.length-1],callout.leader.at(-1));
  assert.ok(moved.box.x>=0&&moved.box.x+moved.box.width<=612);
  assert.ok(moved.box.y>=0&&moved.box.y+moved.box.height<=792);
  assert.equal(callout.box.x,newCallout({
    id:"drag-test",pageIndex:0,tip:{x:72,y:300},pageBounds:bounds
  }).box.x);

  const before=initialEditorState([callout]);
  const after=applyCommand(before,{type:"replace",annotation:moved});
  assert.equal(after.undoStack.length,1);
  assert.deepEqual(undo(after).annotations[0]?.box,callout.box);
  assert.deepEqual(redo(undo(after)).annotations[0]?.box,moved.box);
});

test("drag helper clamps to CropBox and preserves tip for 2-point leaders",()=>{
  const box={x:50,y:60,width:360,height:500};
  const callout=newCallout({id:"crop",pageIndex:0,
    tip:{x:90,y:300},pageBounds:box});
  const two={...callout,leader:[callout.leader[0]!,callout.leader.at(-1)!]};
  const shifted=relocateMarkupBox(two,{x:5000,y:-5000},box);
  assert.equal(shifted.box.x+shifted.box.width,410);
  assert.equal(shifted.box.y,60);
  assert.deepEqual(shifted.leader[0],callout.leader[0]);
  assert.equal(shifted.leader.length,2);
});

test("keyboard nudge maps up/down to PDF y coordinates; shifted nudge is ten points",()=>{
  const text=newTextBox({id:"text-nudge",pageIndex:0,
    location:{x:90,y:600},pageBounds:bounds});
  const moved=nudgeMarkupBox(text,bounds,"right");
  assert.equal(moved.box.x,text.box.x+1);
  const faster=nudgeMarkupBox(text,bounds,"up",true);
  assert.equal(faster.box.y,text.box.y+10);
});

test("PDF viewport rotations still produce correct PDF-space drag delta",()=>{
  const transform:Matrix=[0,1.5,1.5,0,16,24]; // 90 degree rotated reflected viewport
  const start={x:60,y:200};
  const translated={x:60,y:224};
  const v1=pdfToViewport(transform,start),v2=pdfToViewport(transform,translated);
  const delta={
    x:viewportToPdf(transform,v2).x-viewportToPdf(transform,v1).x,
    y:viewportToPdf(transform,v2).y-viewportToPdf(transform,v1).y
  };
  assert.ok(Math.abs(delta.x)<1e-7);
  assert.ok(Math.abs(delta.y-24)<1e-7);
});

test("two-up spreads respect cover-alone and have predictable navigation",()=>{
  assert.deepEqual(groupVisiblePages(6,"two-up",true),
    [[1],[2,3],[4,5],[6]]);
  assert.deepEqual(groupVisiblePages(6,"two-up",false),
    [[1,2],[3,4],[5,6]]);
  assert.deepEqual(spreadForPage(4,6,"two-up",true),[4,5]);
  assert.equal(adjacentPage(1,6,"two-up",true,1),2);
  assert.equal(adjacentPage(3,6,"two-up",true,1),4);
  assert.equal(adjacentPage(4,6,"two-up",true,-1),2);
  assert.equal(pageGroupIndex(75,200,"two-up-continuous",true),37);
  assert.deepEqual(groupVisiblePages(3,"continuous",false),[[1],[2],[3]]);
});

test("zoom fit modes account for spread width without zooming beyond valid bounds",()=>{
  const single=zoomToFit(612,792,1200,760,"fit-page",false);
  const spread=zoomToFit(612,792,1200,760,"fit-page",true);
  assert.ok(spread<=single);
  assert.ok(zoomToFit(612,792,1200,760,"fit-width",false)>1);
  assert.equal(normalizedViewPreferences({mode:"invalid",zoom:99}).mode,"single");
});

test("virtualized PDF page placeholders rescale from intrinsic dimensions without stale zoom drift",()=>{
  const letter={width:612,height:792};
  const landscape={width:1224,height:792};
  const first=scaledPageSize(letter,1);
  const doubled=scaledPageSize(letter,2);
  const back=scaledPageSize(letter,1);
  assert.deepEqual(first,back);
  assert.deepEqual(doubled,{width:1224,height:1584});
  assert.deepEqual(scaledPageSize(landscape,1.4),{
    width:1713.6,height:1108.8
  });
  assert.throws(()=>scaledPageSize(letter,0),RangeError);
  assert.throws(()=>scaledPageSize({width:0,height:792},1),RangeError);
  assert.throws(()=>scaledPageSize({width:NaN,height:792},1),RangeError);
});

test("raster size is bounded even on Arch E at 200% scale and 4K DPR",()=>{
  const page=budgetCanvas(2592*2,3456*2,4);
  assert.ok(page.backingWidth*page.backingHeight<=MAX_PAGE_RASTER_PIXELS);
  assert.ok(page.ratio<1);
  assert.equal(MAX_ACTIVE_VIEW_PAGES,10);
  const normal=budgetCanvas(612,792,1);
  assert.equal(normal.ratio,1);
});
