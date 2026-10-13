import {test,expect,chromium} from "@playwright/test";
import {PDFDocument,PDFArray,PDFDict,PDFName} from "pdf-lib";
import {mkdtemp,rm,writeFile,readFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

test("draw an uncertified visible ink signature, place it, export and reopen",async()=>{
  test.setTimeout(70_000);
  const dir=await mkdtemp(join(tmpdir(),"axik-sign-e2e-"));
  const source=join(dir,"unsigned.pdf"),signed=join(dir,"visually-signed.pdf");
  const pdf=await PDFDocument.create();
  pdf.addPage([612,792]);
  await writeFile(source,await pdf.save());
  const ext=resolve("apps/chromium-extension/dist");
  const context=await chromium.launchPersistentContext(join(dir,"profile"),{
    headless:true,channel:"chromium",acceptDownloads:true,
    args:["--disable-extensions-except="+ext,"--load-extension="+ext]
  });
  try{
    let worker=context.serviceWorkers()[0];
    if(!worker)worker=await context.waitForEvent("serviceworker",{timeout:15_000});
    const tab=await context.newPage();
    await tab.goto("chrome-extension://"+new URL(worker.url()).hostname+"/viewer.html");
    await tab.locator('input[type="file"]').setInputFiles(source);
    await expect(tab.locator(".page-counter")).toHaveText("Page 1 / 1",{timeout:20_000});
    await tab.getByRole("button",{name:"Visual signature"}).click();
    await expect(tab.getByRole("heading",{name:"Draw a visual signature"})).toBeVisible();
    const pad=tab.locator(".signature-pad");
    const rect=await pad.boundingBox();
    expect(rect).not.toBeNull();
    const box=rect!;
    await tab.mouse.move(box.x+40,box.y+100);
    await tab.mouse.down();
    await tab.mouse.move(box.x+160,box.y+50,{steps:8});
    await tab.mouse.move(box.x+260,box.y+105,{steps:8});
    await tab.mouse.up();
    await tab.getByRole("button",{name:"Use signature"}).click();
    await expect(tab.getByRole("heading",{name:"Draw a visual signature"})).toBeHidden();
    await tab.locator("svg.annotation-layer").click({position:{x:190,y:265}});
    await expect(tab.getByRole("button",{name:/Visual signature · Page 1/i}).last())
      .toBeVisible();
    const dl=tab.waitForEvent("download");
    await tab.getByRole("button",{name:"Quick Export"}).click();
    await (await dl).saveAs(signed);
    const reopened=await PDFDocument.load(new Uint8Array(await readFile(signed)));
    const annots=reopened.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
    expect(annots.size()).toBe(1);
    const annotation=reopened.context.lookup(annots.get(0),PDFDict);
    expect(annotation.lookup(PDFName.of("Subtype"),PDFName).asString()).toBe("/Ink");
    expect(annotation.lookup(PDFName.of("InkList"),PDFArray).size()).toBe(1);
    expect(annotation.lookup(PDFName.of("AP"),PDFDict).get(PDFName.of("N"))).toBeTruthy();
    expect(reopened.getForm().getFields().length).toBe(0);
  }finally{
    await context.close();
    await rm(dir,{recursive:true,force:true});
  }
});
