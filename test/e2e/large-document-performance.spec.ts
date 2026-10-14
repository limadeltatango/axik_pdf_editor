import {test,expect,chromium} from "@playwright/test";
import {PDFDocument} from "pdf-lib";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {tmpdir} from "node:os";

/**
 * Reproducible synthetic benchmark that enforces structural resource caps.
 *
 * CI elapsed times are logged for trending only; shared-host runner noise
 * prevents treating these as credible Windows H2 P95 startup/FPS numbers.
 */
test("200-page synthetic drawing set has bounded active raster canvases and responsive page jump",async()=>{
  test.setTimeout(120_000);
  const dir=await mkdtemp(join(tmpdir(),"axik-200-pages-"));
  const file=join(dir,"200-plans.pdf");
  const source=await PDFDocument.create();
  for(let i=0;i<200;i++){
    const page=source.addPage(i%4===0?[792,612]:[612,792]);
    page.drawText("Drawing sheet "+(i+1),{
      x:50,y:Math.max(200,page.getHeight()-105),size:18
    });
  }
  await writeFile(file,await source.save());
  const ext=resolve("apps/chromium-extension/dist");
  const context=await chromium.launchPersistentContext(join(dir,"profile"),{
    headless:true,channel:"chromium",acceptDownloads:false,
    args:["--disable-extensions-except="+ext,"--load-extension="+ext]
  });
  try{
    let worker=context.serviceWorkers()[0];
    if(!worker)worker=await context.waitForEvent("serviceworker",{timeout:15_000});
    const tab=await context.newPage();
    const pageErrors:string[]=[];
    tab.on("pageerror",e=>pageErrors.push(e.name));
    const start=Date.now();
    await tab.goto("chrome-extension://"+new URL(worker.url()).hostname+"/viewer.html");
    const shellReady=Date.now()-start;
    const opening=Date.now();
    await tab.locator('input[type="file"]').setInputFiles(file);
    await expect(tab.locator(".page-counter")).toHaveText("Page 1 / 200",{timeout:25_000});
    await expect(tab.locator(".pdf-canvas")).toHaveCount(1,{timeout:25_000});
    await expect.poll(async()=>tab.locator(".pdf-canvas").evaluateAll(nodes=>
      nodes.every(node=>(node as HTMLCanvasElement).width>0)
    )).toBe(true);
    const firstPageMs=Date.now()-opening;
    const mode=tab.getByLabel("Page view");
    const changed=Date.now();
    await mode.selectOption("continuous");
    await expect(tab.locator("[data-view-row]")).toHaveCount(200);
    await expect.poll(()=>tab.locator(".pdf-canvas").count()).toBeLessThan(11);
    const continuousMs=Date.now()-changed;

    const jump=Date.now();
    await tab.getByLabel("Go to page").fill("190");
    await tab.getByLabel("Go to page").press("Enter");
    await expect(tab.locator('[data-page-number="190"] canvas.pdf-canvas'))
      .toBeVisible({timeout:25000});
    const jumpMs=Date.now()-jump;
    await expect.poll(()=>tab.locator(".pdf-canvas").count()).toBeLessThan(11);

    const scroll=Date.now();
    await mode.selectOption("two-up-continuous");
    await expect(tab.locator('[data-view-mode="two-up-continuous"]')).toBeVisible();
    await expect.poll(()=>tab.locator(".pdf-canvas").count()).toBeLessThan(11);
    const twoUpMs=Date.now()-scroll;

    // Repeated large scrolls must not allocate 200 live canvases.
    const viewport=tab.locator(".document-viewport");
    for(const y of [0,13000,35000,65000,150000]){
      await viewport.evaluate((el,offset)=>{
        el.scrollTop=offset as number;el.dispatchEvent(new Event("scroll"));
      },y);
      await tab.waitForTimeout(80);
      expect(await tab.locator(".pdf-canvas").count()).toBeLessThanOrEqual(10);
    }
    const counts=await tab.locator("canvas.pdf-canvas").evaluateAll(nodes=>
      nodes.map(el=>{
        const canvas=el as HTMLCanvasElement;
        return canvas.width*canvas.height;
      })
    );
    expect(Math.max(0,...counts)).toBeLessThanOrEqual(16_000_000);
    const stats={shellReadyMs:shellReady,firstPageMs,continuousMs,jumpMs,twoUpMs,
      canvasCount:counts.length,maxCanvasPixels:Math.max(0,...counts),
      documentPages:200};
    console.log("APDF_57_CI_SYNTHETIC_METRICS="+JSON.stringify(stats));
    expect(pageErrors).toEqual([]);
  }finally{
    await context.close();
    await rm(dir,{recursive:true,force:true});
  }
});
