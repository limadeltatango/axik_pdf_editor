import {test,expect,chromium} from "@playwright/test";
import {PDFDocument,PDFArray,PDFDict,PDFName,PDFNumber} from "pdf-lib";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {tmpdir} from "node:os";

test("callout has editable arrow tip, elbow and resize grips with persisted PDF geometry",async()=>{
  test.setTimeout(105_000);
  const dir=await mkdtemp(join(tmpdir(),"axik-direct-grips-"));
  const input=join(dir,"original.pdf"),output=join(dir,"revised.pdf");
  const doc=await PDFDocument.create();
  doc.addPage([612,792]);
  await writeFile(input,await doc.save());
  const ext=resolve("apps/chromium-extension/dist");
  const context=await chromium.launchPersistentContext(join(dir,"profile"),{
    headless:true,channel:"chromium",acceptDownloads:true,
    args:["--disable-extensions-except="+ext,"--load-extension="+ext]
  });
  try{
    let worker=context.serviceWorkers()[0];
    if(!worker)worker=await context.waitForEvent("serviceworker",{timeout:15_000});
    const tab=await context.newPage();
    const errors:string[]=[];
    tab.on("pageerror",error=>errors.push(error.name));
    await tab.goto("chrome-extension://"+new URL(worker.url()).hostname+"/viewer.html");
    await tab.locator('input[type="file"]').setInputFiles(input);
    await expect(tab.locator(".pdf-canvas")).toBeVisible({timeout:20_000});
    await tab.locator(".toolstrip").getByRole("button",{name:/Callout/}).click();
    await tab.locator("svg.annotation-layer").click({position:{x:90,y:190}});
    await tab.getByLabel("Callout text").fill("Proposed pendant light");
    await tab.locator(".toolstrip").getByRole("button",{name:"Select"}).click();
    const box=tab.getByRole("button",{name:"Move callout box on page 1"});
    await expect(box).toBeVisible();
    const originalBox=await box.boundingBox();
    const tip=tab.getByRole("button",{name:"Move callout arrow tip"});
    const elbow=tab.getByRole("button",{name:"Move callout elbow"});
    const corner=tab.getByRole("button",{name:"Resize callout north-east"});
    await expect(tip).toBeVisible();
    await expect(elbow).toBeVisible();
    await expect(corner).toBeVisible();

    const target=await tip.boundingBox();
    expect(target).not.toBeNull();
    await tab.mouse.move(target!.x+target!.width/2,target!.y+target!.height/2);
    await tab.mouse.down();
    await tab.mouse.move(target!.x+target!.width/2-32,
      target!.y+target!.height/2+24,{steps:7});
    await tab.mouse.up();
    await expect.poll(async()=>{
      const after=await tip.boundingBox();
      return after ? target!.x-after.x : 0;
    }).toBeGreaterThan(20);
    const unchanged=await box.boundingBox();
    expect(Math.abs(unchanged!.x-originalBox!.x)).toBeLessThan(2);

    const bend=await elbow.boundingBox();
    await tab.mouse.move(bend!.x+bend!.width/2,bend!.y+bend!.height/2);
    await tab.mouse.down();
    await tab.mouse.move(bend!.x+bend!.width/2+34,
      bend!.y+bend!.height/2-28,{steps:8});
    await tab.mouse.up();
    await expect.poll(async()=>{
      const after=await elbow.boundingBox();
      return after ? after.x-bend!.x:0;
    }).toBeGreaterThan(20);

    const initialSize=await box.boundingBox();
    const grip=await corner.boundingBox();
    await tab.mouse.move(grip!.x+grip!.width/2,grip!.y+grip!.height/2);
    await tab.mouse.down();
    await tab.mouse.move(grip!.x+grip!.width/2+42,
      grip!.y+grip!.height/2-27,{steps:8});
    await tab.mouse.up();
    await expect.poll(async()=>{
      const value=await box.boundingBox();
      return value ? value.width-initialSize!.width:0;
    }).toBeGreaterThan(20);
    await expect(tab.getByRole("button",{name:"Undo"})).toBeEnabled();
    const resized=await box.boundingBox();
    await tab.getByRole("button",{name:"Undo"}).click();
    await expect.poll(async()=>{
      const value=await box.boundingBox();
      return value ? Math.abs(value.width-initialSize!.width):100;
    }).toBeLessThan(2);
    await tab.getByRole("button",{name:"Redo"}).click();
    await expect.poll(async()=>{
      const value=await box.boundingBox();
      return value ? Math.abs(value.width-resized!.width):100;
    }).toBeLessThan(2);

    const download=tab.waitForEvent("download");
    await tab.getByRole("button",{name:"Quick Export"}).click();
    await (await download).saveAs(output);
    const saved=await PDFDocument.load(new Uint8Array(await readFile(output)));
    const native=saved.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
    expect(native.size()).toBe(1);
    const a=saved.context.lookup(native.get(0),PDFDict);
    expect(a.lookup(PDFName.of("IT"),PDFName).asString()).toBe("/FreeTextCallout");
    const points=a.lookup(PDFName.of("CL"),PDFArray);
    expect(points.size()).toBe(6);
    const rd=a.lookup(PDFName.of("RD"),PDFArray);
    expect(rd.size()).toBe(4);
    expect(a.lookup(PDFName.of("AP"),PDFDict).get(PDFName.of("N"))).toBeTruthy();
    expect(errors).toEqual([]);
  }finally{
    await context.close();
    await rm(dir,{recursive:true,force:true});
  }
});
