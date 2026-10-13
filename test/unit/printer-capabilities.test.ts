import {test} from "node:test";
import assert from "node:assert/strict";
import {
  LETTER_PORTRAIT, LEGAL_PORTRAIT, ARCH_D_PORTRAIT,
  checkPrinterMedia, planFixedMedia, DEFAULT_MARGINS,
  type DriverPrinterCapabilities
} from "@axik/print-plan";

const sample:DriverPrinterCapabilities={
  printerName:"Lab laser test device",
  duplexAdvertised:true,colorAdvertised:false,
  capabilityQuerySucceeded:true,
  caveat:"Driver-advertised only.",
  papers:[
    {code:1,name:"US Letter",widthMm:215.9,heightMm:279.4},
    {code:5,name:"Legal",widthMm:215.9,heightMm:355.6},
    {code:256,name:"Plotter sheet",widthMm:609.6,heightMm:914.4}
  ]
};

test("printer preflight compares actual media dimensions not localized names",()=>{
  const letter=checkPrinterMedia(LETTER_PORTRAIT,"simplex",sample);
  assert.equal(letter.paper,"supported");
  assert.equal(letter.matchedPaper?.code,1);
  const legal=checkPrinterMedia(LEGAL_PORTRAIT,"long-edge",sample);
  assert.equal(legal.paper,"supported");
  assert.equal(legal.duplex,"supported");
  assert.equal(checkPrinterMedia(ARCH_D_PORTRAIT,"simplex",sample).paper,"supported");
});

test("driver paper mismatch and missing duplex are explicitly unsupported",()=>{
  const onlyLetter={...sample,papers:sample.papers.slice(0,1),duplexAdvertised:false};
  assert.equal(checkPrinterMedia(LEGAL_PORTRAIT,"simplex",onlyLetter).paper,"unsupported");
  const result=checkPrinterMedia(LETTER_PORTRAIT,"short-edge",onlyLetter);
  assert.equal(result.duplex,"unsupported");
  assert.equal(result.paper,"supported");
});

test("incomplete driver paper query does not claim support",()=>{
  const state={...sample,papers:[],capabilityQuerySucceeded:false};
  const result=checkPrinterMedia(LETTER_PORTRAIT,"long-edge",state);
  assert.equal(result.paper,"unknown");
  assert.equal(result.duplex,"unknown");
});

test("ARCH D fixed-stock PrintPlan retains true 24x36 target size",()=>{
  const plan=planFixedMedia({
    pages:[{index:0,geometry:{
      mediaBox:[0,0,2592,1728],rotate:0,userUnit:1
    }}],
    media:ARCH_D_PORTRAIT,margins:DEFAULT_MARGINS,
    scaling:"shrink-to-fit",duplex:"simplex"
  });
  assert.equal(plan.media.width,1728);
  assert.equal(plan.media.height,2592);
  assert.equal(plan.sheets.length,1);
  assert.equal(plan.sheets[0]?.faces[0]?.placement?.sheetRotation,90);
  assert.equal(plan.logicallyValid,true);
});
