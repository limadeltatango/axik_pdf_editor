import {test,expect,chromium} from "@playwright/test";
import {PDFDocument,rgb} from "pdf-lib";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

/** Verify the real rendered page layout, not merely the PDF's MediaBox values. */
test("printed landscape page becomes portrait stock with correct visible corners",async()=>{
  test.setTimeout(90_000);
  const folder=await mkdtemp(join(tmpdir(),"axik-print-pixels-"));
  const sourceFile=join(folder,"landscape.pdf");
  const printFile=join(folder,"print-ready.pdf");
  const doc=await PDFDocument.create();
  const p=doc.addPage([792,612]);
  p.drawRectangle({x:40,y:40,width:110,height:110,color:rgb(1,0,0)});
  p.drawRectangle({x:642,y:462,width:110,height:110,color:rgb(0,0,1)});
  await writeFile(sourceFile,await doc.save());
  const ext=resolve("apps/chromium-extension/dist");
  const context=await chromium.launchPersistentContext(join(folder,"profile"),{
    headless:true,channel:"chromium",acceptDownloads:true,
    args:["--disable-extensions-except="+ext,"--load-extension="+ext]
  });
  try{
    let worker=context.serviceWorkers()[0];
    if(!worker)worker=await context.waitForEvent("serviceworker",{timeout:15_000});
    const tab=await context.newPage();
    tab.on("dialog",dialog=>{void dialog.accept()});
    await tab.goto("chrome-extension://"+new URL(worker.url()).hostname+"/viewer.html");
    await tab.locator('input[type="file"]').setInputFiles(sourceFile);
    await expect(tab.locator(".filename")).toHaveText("landscape.pdf",{timeout:20_000});
    await tab.getByRole("button",{name:"Print",exact:true}).click();
    await tab.getByRole("button",{name:"Prepare print-ready PDF"}).click();
    await expect(tab.getByText(/Prepared 1 physical sheet\(s\) using vector rendering/))
      .toBeVisible({timeout:30_000});
    const pending=tab.waitForEvent("download");
    await tab.getByRole("link",{name:"Download printable PDF"}).click();
    await (await pending).saveAs(printFile);
    const paper=await PDFDocument.load(new Uint8Array(await readFile(printFile)));
    expect(paper.getPageCount()).toBe(1);
    expect(paper.getPage(0).getWidth()).toBe(612);
    expect(paper.getPage(0).getHeight()).toBe(792);
    await tab.getByRole("button",{name:"Close"}).last().click();
    await tab.locator('input[type="file"]').setInputFiles(printFile);
    await expect(tab.locator(".filename")).toHaveText("print-ready.pdf",{timeout:20_000});
    await expect.poll(async()=>{
      return await tab.locator("canvas.pdf-canvas").evaluate((element)=>{
        const canvas=element as HTMLCanvasElement;
        const context=canvas.getContext("2d");
        if(!context)return false;
        const width=Number.parseFloat(canvas.style.width)||612;
        const height=Number.parseFloat(canvas.style.height)||792;
        const pick=(x:number,y:number)=>{
          const xx=Math.floor(x*canvas.width/width);
          const yy=Math.floor(y*canvas.height/height);
          return context.getImageData(xx,yy,1,1).data;
        };
        const red=pick(110,120);
        const blue=pick(500,675);
        return red[0]>170 && red[1]<95 && red[2]<95 &&
          blue[2]>170 && blue[0]<95 && blue[1]<95;
      });
    },{timeout:18_000}).toBe(true);
  }finally{
    await context.close();
    await rm(folder,{recursive:true,force:true});
  }
});
