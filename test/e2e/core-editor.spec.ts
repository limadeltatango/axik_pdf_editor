import {test,expect,chromium} from "@playwright/test";
import {PDFDocument,PDFArray,PDFDict,PDFName} from "pdf-lib";
import {mkdtemp,rm,writeFile,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";

test("added PDF text and comments survive export; annotated mixed pages prepare for printing",async()=>{
  test.setTimeout(110_000);
  const work=await mkdtemp(join(tmpdir(),"axik-core-e2e-"));
  const input=join(work,"plans.pdf"),output=join(work,"marked.pdf"),printed=join(work,"print-ready.pdf");
  const doc=await PDFDocument.create();
  doc.addPage([612,792]).drawText("Portrait sheet",{x:50,y:700});
  doc.addPage([792,612]).drawText("Landscape sheet",{x:50,y:500});
  await writeFile(input,await doc.save());
  const extension=resolve("apps/chromium-extension/dist");
  const context=await chromium.launchPersistentContext(join(work,"profile"),{
    channel:"chromium",headless:true,acceptDownloads:true,
    args:["--disable-extensions-except="+extension,"--load-extension="+extension]
  });
  try{
    let service=context.serviceWorkers()[0];
    if(!service)service=await context.waitForEvent("serviceworker",{timeout:15_000});
    const tab=await context.newPage();
    const exceptions:string[]=[];
    tab.on("pageerror",e=>exceptions.push(e.name));
    await tab.goto("chrome-extension://"+new URL(service.url()).hostname+"/viewer.html");
    await tab.locator('input[type="file"]').setInputFiles(input);
    await expect(tab.locator(".page-counter")).toHaveText("Page 1 / 2",{timeout:20_000});

    await tab.getByRole("button",{name:"Add Text"}).click();
    await tab.locator("svg.annotation-layer").click({position:{x:155,y:190}});
    await expect(tab.getByLabel("New text")).toBeVisible();
    await tab.getByLabel("New text").fill("Add new light fixture L-17");

    await tab.getByRole("button",{name:"Comment",exact:true}).click();
    await tab.locator("svg.annotation-layer").click({position:{x:115,y:230}});
    await expect(tab.getByLabel("Comment")).toBeVisible();
    await tab.getByLabel("Comment").fill("Architect approval required");

    const downloadPromise=tab.waitForEvent("download");
    await tab.getByRole("button",{name:"Quick Export"}).click();
    await (await downloadPromise).saveAs(output);
    const edited=await PDFDocument.load(new Uint8Array(await readFile(output)));
    const native=edited.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
    expect(native.size()).toBe(2);
    const kinds=Array.from({length:native.size()},(_,i)=>
      edited.context.lookup(native.get(i),PDFDict).lookup(PDFName.of("Subtype"),PDFName).asString());
    expect(kinds).toEqual(["/FreeText","/Text"]);

    await tab.getByRole("button",{name:"Print",exact:true}).click();
    await expect(tab.getByRole("heading",{name:"Intelligent print preparation"})).toBeVisible();
    await tab.getByRole("button",{name:"Prepare print-ready PDF"}).click();
    await expect(tab.getByText(/Prepared 2 physical sheet\(s\) using raster rendering/))
      .toBeVisible({timeout:45_000});
    const printDownload=tab.waitForEvent("download");
    await tab.getByRole("link",{name:"Download printable PDF"}).click();
    await (await printDownload).saveAs(printed);
    const normalized=await PDFDocument.load(new Uint8Array(await readFile(printed)));
    expect(normalized.getPageCount()).toBe(2);
    for(const p of normalized.getPages()){
      expect(p.getWidth()).toBe(612);
      expect(p.getHeight()).toBe(792);
    }
    await tab.getByRole("button",{name:"Close"}).last().click();
    expect(exceptions).toEqual([]);
  }finally{
    await context.close();
    await rm(work,{force:true,recursive:true});
  }
});
