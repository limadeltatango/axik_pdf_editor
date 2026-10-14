import {test,expect,chromium} from "@playwright/test";
import {PDFDocument,PDFArray,PDFDict,PDFName,PDFNumber} from "pdf-lib";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

async function launchEditor(temp:string){
  const ext=resolve("apps/chromium-extension/dist");
  const context=await chromium.launchPersistentContext(join(temp,"profile"),{
    channel:"chromium",headless:true,acceptDownloads:true,
    args:["--disable-extensions-except="+ext,"--load-extension="+ext]
  });
  let worker=context.serviceWorkers()[0];
  if(!worker)worker=await context.waitForEvent("serviceworker",{timeout:15_000});
  const page=await context.newPage();
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.name));
  await page.goto("chrome-extension://"+new URL(worker.url()).hostname+"/viewer.html");
  return {context,page,errors};
}

test("callout textbox drag preserves leader target, exports new coordinates, and Undo restores box",async()=>{
  test.setTimeout(85_000);
  const dir=await mkdtemp(join(tmpdir(),"axik-drag-usability-"));
  const file=join(dir,"page.pdf"),output=join(dir,"markup.pdf");
  const doc=await PDFDocument.create();
  doc.addPage([612,792]);
  await writeFile(file,await doc.save());
  const {context,page,errors}=await launchEditor(dir);
  try{
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.locator(".pdf-canvas")).toBeVisible({timeout:20_000});
    await page.locator(".toolstrip").getByRole("button",{name:/Callout/}).click();
    await page.locator("svg.annotation-layer").click({position:{x:100,y:220}});
    const grip=page.locator('rect[aria-label="Move callout box on page 1"]');
    await expect(grip).toBeVisible();
    const before=await grip.boundingBox();
    const leaderBefore=await page.locator("svg.annotation-layer polyline").first().getAttribute("points");
    expect(before).toBeTruthy();
    await page.locator(".toolstrip").getByRole("button",{name:"Select"}).click();
    await page.mouse.move(before!.x+before!.width/2,before!.y+before!.height/2);
    await page.mouse.down();
    await page.mouse.move(before!.x+before!.width/2+90,
      before!.y+before!.height/2+52,{steps:12});
    await page.mouse.up();
    await expect.poll(async()=>{
      const after=await grip.boundingBox();
      return after ? Math.round(after.x-before!.x) :0;
    }).toBeGreaterThan(55);
    const leaderAfter=await page.locator("svg.annotation-layer polyline").first().getAttribute("points");
    const start=(points:string|null)=>points?.split(" ")[0];
    expect(start(leaderAfter)).toBe(start(leaderBefore));
    const moved=await grip.boundingBox();
    await page.getByRole("button",{name:"Undo"}).click();
    await expect.poll(async()=>{
      const restored=await grip.boundingBox();
      return restored?Math.abs(restored.x-before!.x):1000;
    }).toBeLessThan(2);
    await page.getByRole("button",{name:"Redo"}).click();
    await expect.poll(async()=>{
      const restored=await grip.boundingBox();
      return restored?Math.abs(restored.x-moved!.x):1000;
    }).toBeLessThan(2);
    // Keyboard Shift+ArrowRight nudges by 10 PDF points.
    await grip.focus();
    const beforeKey=await grip.boundingBox();
    await page.keyboard.down("Shift");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Shift");
    await expect.poll(async()=>{
      const after=await grip.boundingBox();
      return after?after.x-beforeKey!.x:0;
    }).toBeGreaterThan(7);
    const pending=page.waitForEvent("download");
    await page.getByRole("button",{name:"Quick Export"}).click();
    await (await pending).saveAs(output);
    const result=await PDFDocument.load(new Uint8Array(await readFile(output)));
    const array=result.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
    expect(array.size()).toBe(1);
    const dictionary=result.context.lookup(array.get(0),PDFDict);
    expect(dictionary.lookup(PDFName.of("CL"),PDFArray).size()).toBe(6);
    expect(errors).toEqual([]);
  }finally{
    await context.close();
    await rm(dir,{recursive:true,force:true});
  }
});

test("view modes offer continuous and two-up layouts while limiting live canvas count",async()=>{
  test.setTimeout(95_000);
  const dir=await mkdtemp(join(tmpdir(),"axik-views-"));
  const file=join(dir,"80-pages.pdf");
  const doc=await PDFDocument.create();
  for(let i=0;i<80;i++){
    const page=doc.addPage(i%3===0?[792,612]:[612,792]);
    page.drawText("Plan sheet "+(i+1),{x:50,y:500,size:15});
  }
  await writeFile(file,await doc.save());
  const {context,page,errors}=await launchEditor(dir);
  try{
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.locator(".page-counter")).toHaveText("Page 1 / 80",{timeout:25_000});
    await expect(page.locator(".pdf-canvas")).toHaveCount(1,{timeout:15_000});
    const mode=page.getByLabel("Page view");
    await mode.selectOption("continuous");
    await expect(page.locator('.document-viewport[data-view-mode="continuous"]')).toBeVisible();
    await expect(page.locator("[data-view-row]")).toHaveCount(80);
    await expect.poll(()=>page.locator(".pdf-canvas").count()).toBeLessThan(11);

    const jump=page.getByLabel("Go to page");
    await jump.fill("65");
    await jump.press("Enter");
    await expect(page.locator('[data-page-number="65"] .pdf-canvas')).toBeVisible({timeout:20_000});
    await expect.poll(()=>page.locator(".pdf-canvas").count()).toBeLessThan(11);

    await mode.selectOption("two-up-continuous");
    await expect(page.locator('.document-viewport[data-view-mode="two-up-continuous"]')).toBeVisible();
    await expect.poll(()=>page.locator(".pdf-canvas").count()).toBeLessThan(11);
    await page.getByLabel("Show cover page separately").uncheck();
    await expect.poll(()=>page.locator(".pdf-canvas").count()).toBeLessThan(11);

    await mode.selectOption("two-up");
    await expect(page.locator('[data-view-mode="two-up"]')).toBeVisible();
    await expect(page.locator(".view-row-two .view-page-slot")).toHaveCount(2);
    await mode.selectOption("single");
    await expect(page.locator("[data-view-row]")).toHaveCount(1);
    await page.getByLabel("Zoom preset").selectOption("fit-page");
    await expect.poll(()=>page.locator(".zoom-display").innerText()).not.toBe("NaN%");
    expect(errors).toEqual([]);
  }finally{
    await context.close();
    await rm(dir,{recursive:true,force:true});
  }
});
