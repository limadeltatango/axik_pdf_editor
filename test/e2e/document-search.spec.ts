import {test,expect,chromium} from "@playwright/test";
import {PDFDocument} from "pdf-lib";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

test("text search is lazy and navigates to matching PDF page",async()=>{
  test.setTimeout(50_000);
  const dir=await mkdtemp(join(tmpdir(),"axik-find-e2e-"));
  const source=join(dir,"schedule.pdf");
  const pdf=await PDFDocument.create();
  pdf.addPage([612,792]).drawText("Mechanical schedule first page",{x:45,y:680,size:15});
  pdf.addPage([612,792]).drawText("Lighting fixture schedule B-210",{x:45,y:680,size:15});
  await writeFile(source,await pdf.save());
  const ext=resolve("apps/chromium-extension/dist");
  const context=await chromium.launchPersistentContext(join(dir,"profile"),{
    headless:true,channel:"chromium",acceptDownloads:true,
    args:["--disable-extensions-except="+ext,"--load-extension="+ext]
  });
  try{
    let worker=context.serviceWorkers()[0];
    if(!worker)worker=await context.waitForEvent("serviceworker",{timeout:15000});
    const tab=await context.newPage();
    const errors:string[]=[];
    tab.on("pageerror",reason=>errors.push(reason.name));
    await tab.goto("chrome-extension://"+new URL(worker.url()).hostname+"/viewer.html");
    await tab.locator('input[type="file"]').setInputFiles(source);
    await expect(tab.locator(".page-counter")).toHaveText("Page 1 / 2",{timeout:20000});
    await tab.getByRole("button",{name:"Find",exact:true}).first().click();
    await expect(tab.getByRole("dialog",{name:"Search PDF text"})).toBeVisible();
    await tab.getByRole("searchbox",{name:"Find text"}).fill("fixture schedule");
    await tab.getByRole("button",{name:"Find",exact:true}).last().click();
    await expect(tab.locator(".search-result")).toHaveCount(1,{timeout:15000});
    await expect(tab.locator(".search-result")).toContainText("Page 2");
    await tab.locator(".search-result").click();
    await expect(tab.locator(".page-counter")).toHaveText("Page 2 / 2");
    expect(errors).toEqual([]);
  }finally{
    await context.close();
    await rm(dir,{force:true,recursive:true});
  }
});
