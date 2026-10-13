import {test,expect,chromium} from "@playwright/test";
import {PDFDocument,PDFName,PDFArray,PDFDict,PDFHexString} from "pdf-lib";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

test("reopen and edit an existing Axik callout without duplicating it",async()=>{
  test.setTimeout(90_000);
  const dir=await mkdtemp(join(tmpdir(),"axik-reopen-e2e-"));
  const source=join(dir,"source.pdf"),draft=join(dir,"draft.pdf"),updated=join(dir,"updated.pdf");
  const pdf=await PDFDocument.create();
  pdf.addPage([612,792]);
  await writeFile(source,await pdf.save());

  const ext=resolve("apps/chromium-extension/dist");
  const context=await chromium.launchPersistentContext(join(dir,"profile"),{
    channel:"chromium",headless:true,acceptDownloads:true,
    args:["--disable-extensions-except="+ext,"--load-extension="+ext]
  });
  try{
    let worker=context.serviceWorkers()[0];
    if(!worker)worker=await context.waitForEvent("serviceworker",{timeout:15_000});
    const tab=await context.newPage();
    const errors:string[]=[];
    tab.on("pageerror",reason=>errors.push(reason.name));
    await tab.goto("chrome-extension://"+new URL(worker.url()).hostname+"/viewer.html");
    await tab.locator('input[type="file"]').setInputFiles(source);
    await expect(tab.getByRole("button",{name:"Callout"})).toBeEnabled({timeout:20_000});
    await tab.getByRole("button",{name:"Callout"}).click();
    await tab.locator("svg.annotation-layer").click({position:{x:105,y:145}});
    await expect(tab.getByLabel("Callout text")).toBeVisible();
    await tab.getByLabel("Callout text").fill("Original coordination request");
    const firstDownload=tab.waitForEvent("download");
    await tab.getByRole("button",{name:"Quick Export"}).click();
    await (await firstDownload).saveAs(draft);

    // Reopen the saved PDF and edit the native annotation from the Axik sidebar.
    await tab.locator('input[type="file"]').setInputFiles(draft);
    await expect(tab.getByText("Original coordination request",{exact:true}))
      .toBeVisible({timeout:20_000});
    await tab.getByText("Original coordination request",{exact:true}).click();
    await expect(tab.getByLabel("Callout text")).toBeVisible();
    await tab.getByLabel("Callout text").fill("Approved revised coordination request");
    const secondDownload=tab.waitForEvent("download");
    await tab.getByRole("button",{name:"Quick Export"}).click();
    await (await secondDownload).saveAs(updated);

    const result=await PDFDocument.load(new Uint8Array(await readFile(updated)));
    const annots=result.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
    expect(annots.size()).toBe(1);
    const only=result.context.lookup(annots.get(0),PDFDict);
    const content=only.lookup(PDFName.of("Contents"),PDFHexString);
    expect(content.decodeText()).toBe("Approved revised coordination request");
    expect(errors).toEqual([]);
  }finally{
    await context.close();
    await rm(dir,{force:true,recursive:true});
  }
});
