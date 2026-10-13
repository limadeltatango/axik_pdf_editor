import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PDFDocument, PDFName, PDFArray, PDFDict
} from "pdf-lib";
import {
  normalizeForFixedStockPrinting, PrintPreparationError
} from "@axik/print-document";
import { LETTER_PORTRAIT, DEFAULT_MARGINS } from "@axik/print-plan";

const settings = {
  media: LETTER_PORTRAIT,
  margins: DEFAULT_MARGINS,
  scaling: "shrink-to-fit" as const,
  duplex: "simplex" as const
};

async function multiOrientationSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612,792]).drawText("Portrait page", {x:40,y:680,size:18});
  doc.addPage([792,612]).drawText("Landscape page", {x:40,y:510,size:18});
  const rotated=doc.addPage([792,612]);
  rotated.setRotation({type:"degrees",angle:90});
  rotated.drawText("Already intrinsically rotated", {x:40,y:510,size:18});
  return new Uint8Array(await doc.save());
}

test("print prep normalizes mixed portrait/landscape pages to a fixed stock",async()=>{
  const pdf = await multiOrientationSource();
  const output=await normalizeForFixedStockPrinting(pdf,settings);
  assert.equal(output.spooled,false);
  assert.equal(output.plan.logicallyValid,true);
  assert.equal(output.plan.sheets.length,3);
  assert.deepEqual(output.plan.sheets.map(s=>s.faces[0]?.placement?.sheetRotation),[0,90,0]);
  const reopened=await PDFDocument.load(output.pdf);
  assert.equal(reopened.getPageCount(),3);
  for(const p of reopened.getPages()){
    assert.equal(p.getWidth(),612);
    assert.equal(p.getHeight(),792);
    assert.equal(p.getRotation().angle,0);
    assert.ok(p.node.Contents() !== undefined);
  }
});

test("print prep preserves duplex physical face count with a blank last back",async()=>{
  const pdf=await multiOrientationSource();
  const output=await normalizeForFixedStockPrinting(pdf,{...settings,duplex:"long-edge"});
  assert.equal(output.plan.sheets.length,2);
  const reopened=await PDFDocument.load(output.pdf);
  assert.equal(reopened.getPageCount(),4);
});

test("print prep blocks actual-size clipping before materializing output",async()=>{
  const source=await PDFDocument.create();
  source.addPage([2592,1728]);
  await assert.rejects(
    normalizeForFixedStockPrinting(
      new Uint8Array(await source.save()),
      {...settings,scaling:"actual-size"}
    ),
    (error:unknown)=>error instanceof PrintPreparationError &&
      error.code==="PREFLIGHT_BLOCKED"
  );
});

test("print prep refuses to silently lose existing annotations",async()=>{
  const source=await PDFDocument.create();
  const page=source.addPage([612,792]);
  const dict=source.context.obj({
    Type:PDFName.of("Annot"),
    Subtype:PDFName.of("Text"),
    Rect:[10,10,30,30],
    Contents:"A comment",
    F:4
  });
  page.node.set(PDFName.of("Annots"),source.context.obj([source.context.register(dict)]));
  await assert.rejects(
    normalizeForFixedStockPrinting(new Uint8Array(await source.save()),settings),
    (error:unknown)=>error instanceof PrintPreparationError &&
      error.code==="ANNOTATIONS_UNSUPPORTED"
  );
});

test("output contains vector page form XObjects rather than raster images",async()=>{
  const pdf=await multiOrientationSource();
  const output=await normalizeForFixedStockPrinting(pdf,settings);
  const doc=await PDFDocument.load(output.pdf);
  const page=doc.getPage(0);
  const resources=page.node.Resources();
  assert.ok(resources);
  const xobjects=resources?.lookupMaybe(PDFName.of("XObject"),PDFDict);
  assert.ok(xobjects, "Vector content must be embedded as page Form XObjects.");
  assert.ok(xobjects.size()>0);
  assert.ok(page.node.Contents());
  assert.equal(output.warnings.some(w=>w.includes("printer has been contacted")),true);
});
