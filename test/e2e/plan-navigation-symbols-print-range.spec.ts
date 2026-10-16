import {test,expect,chromium} from "@playwright/test";
import {PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName} from "pdf-lib";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

async function launchEditor(dir:string) {
  const ext=resolve("apps/chromium-extension/dist");
  const context=await chromium.launchPersistentContext(join(dir,"profile"),{
    channel:"chromium",headless:true,acceptDownloads:true,
    args:["--disable-extensions-except="+ext,"--load-extension="+ext]
  });
  let worker=context.serviceWorkers()[0];
  if(!worker)worker=await context.waitForEvent("serviceworker",{timeout:15_000});
  const page=await context.newPage();
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto("chrome-extension://"+new URL(worker.url()).hostname+"/viewer.html");
  return {context,page,errors};
}

test("Ctrl+wheel anchors the inspected plan point; Alt+left pans without creating markup",async()=>{
  test.setTimeout(100_000);
  const dir=await mkdtemp(join(tmpdir(),"axik-plan-nav-"));
  const input=join(dir,"plans.pdf");
  const doc=await PDFDocument.create();
  doc.addPage([1224,1728]);
  await writeFile(input,await doc.save());
  const {context,page,errors}=await launchEditor(dir);
  try{
    await page.locator('input[type="file"]').setInputFiles(input);
    await expect(page.locator(".pdf-canvas")).toBeVisible({timeout:25_000});
    const viewport=page.locator(".document-viewport");
    const zoomLabel=page.locator(".zoom-display");
    for(let i=0;i<6;i++)await page.getByRole("button",{name:"Zoom in"}).click();
    await expect.poll(()=>viewport.evaluate((el)=>
      el.scrollHeight-el.clientHeight)).toBeGreaterThan(120);
    await viewport.evaluate((el)=>{
      el.scrollTop=Math.max(0,(el.scrollHeight-el.clientHeight)/2);
      el.scrollLeft=Math.max(0,(el.scrollWidth-el.clientWidth)/2);
    });
    const bounds=await viewport.boundingBox();
    expect(bounds).not.toBeNull();
    const point={x:bounds!.x+bounds!.width*.48,y:bounds!.y+bounds!.height*.48};
    const slot=page.locator('.view-page-slot[data-page-number="1"]');
    const before=await slot.boundingBox();
    expect(before).not.toBeNull();
    const ratioX=(point.x-before!.x)/before!.width;
    const ratioY=(point.y-before!.y)/before!.height;
    const firstZoom=Number((await zoomLabel.innerText()).replace("%",""));
    await page.mouse.move(point.x,point.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0,-160);
    await page.keyboard.up("Control");
    await expect.poll(async()=>Number((await zoomLabel.innerText()).replace("%","")))
      .toBeGreaterThan(firstZoom);
    await page.waitForTimeout(160); // allow the two-frame anchor correction
    const after=await slot.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs((point.x-after!.x)/after!.width-ratioX)).toBeLessThan(.04);
    expect(Math.abs((point.y-after!.y)/after!.height-ratioY)).toBeLessThan(.04);

    await page.locator(".toolstrip").getByRole("button",{name:/Callout/}).click();
    const previous=await viewport.evaluate((el)=>({
      top:el.scrollTop,left:el.scrollLeft
    }));
    await page.mouse.move(point.x,point.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(point.x-70,point.y-55,{steps:8});
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(async()=>viewport.evaluate((el)=>el.scrollTop))
      .toBeGreaterThan(previous.top+30);
    expect(await viewport.evaluate((el)=>el.scrollLeft))
      .toBeGreaterThan(previous.left+35);
    await expect(page.locator(".comment-item")).toHaveCount(0);
    expect(errors).toEqual([]);
  }finally{
    await context.close();
    await rm(dir,{recursive:true,force:true});
  }
});

test("fixture builder rejects invalid dimensions and exports reusable editable vector Stamp",async()=>{
  test.setTimeout(100_000);
  const dir=await mkdtemp(join(tmpdir(),"axik-symbol-ui-"));
  const input=join(dir,"source.pdf"),output=join(dir,"stamped.pdf");
  const doc=await PDFDocument.create();
  doc.addPage([612,792]);
  await writeFile(input,await doc.save());
  const {context,page,errors}=await launchEditor(dir);
  try{
    await page.locator('input[type="file"]').setInputFiles(input);
    await expect(page.locator(".pdf-canvas")).toBeVisible({timeout:25_000});
    await page.getByRole("button",{name:"Symbol Builder…"}).click();
    const builder=page.getByRole("dialog",{name:"Custom vector symbol builder"});
    await expect(builder).toBeVisible();
    await expect(builder.locator('select[aria-label="Symbol components"] option')).toHaveCount(2);
    await builder.getByLabel("Symbol components").selectOption("luminaire");
    const width=builder.getByLabel("Component width");
    await width.fill("-5");
    await expect(builder.getByRole("alert")).toContainText("Invalid symbol component");
    await expect(width).toHaveValue("110");
    await width.fill("160");
    await expect(width).toHaveValue("160");
    await builder.getByLabel("Symbol name").fill("Kitchen linear light 160");
    await builder.getByRole("button",{name:"Save as new symbol"}).click();
    await expect(builder.getByRole("status")).toContainText("Saved");
    await builder.getByRole("button",{name:"Use on drawing"}).click();
    await page.locator("svg.annotation-layer").click({position:{x:110,y:210}});
    await expect(page.locator(".comment-item")).toHaveCount(1);
    const pending=page.waitForEvent("download");
    await page.getByRole("button",{name:"Quick Export"}).click();
    await (await pending).saveAs(output);
    const exported=await PDFDocument.load(new Uint8Array(await readFile(output)));
    const anns=exported.getPage(0).node.lookup(PDFName.of("Annots"),PDFArray);
    expect(anns.size()).toBe(1);
    const dict=exported.context.lookup(anns.get(0),PDFDict);
    expect(dict.lookup(PDFName.of("Subtype"),PDFName).asString()).toBe("/Stamp");
    expect(dict.lookup(PDFName.of("AP"),PDFDict).get(PDFName.of("N"))).toBeTruthy();
    const stored=dict.lookup(PDFName.of("AxikSymbol"),PDFHexString);
    const metadata=JSON.parse(stored.decodeText());
    expect(metadata.primitives).toHaveLength(2);
    expect(metadata.primitives.find((part:{id:string;width:number})=>
      part.id==="luminaire")?.width).toBe(160);
    await page.locator('input[type="file"]').setInputFiles(output);
    await expect(page.locator(".comment-item")).toHaveCount(1,{timeout:25_000});
    expect(errors).toEqual([]);
  }finally{
    await context.close();
    await rm(dir,{recursive:true,force:true});
  }
});

test("custom noncontiguous print selection controls actual print-ready PDF pages",async()=>{
  test.setTimeout(90_000);
  const dir=await mkdtemp(join(tmpdir(),"axik-print-range-ui-"));
  const input=join(dir,"source.pdf"),output=join(dir,"selected.pdf");
  const doc=await PDFDocument.create();
  for(let i=0;i<6;i++){
    const p=doc.addPage(i%2?[792,612]:[612,792]);
    p.drawText("Plan page "+(i+1),{x:35,y:100,size:14});
  }
  await writeFile(input,await doc.save());
  const {context,page,errors}=await launchEditor(dir);
  try{
    await page.locator('input[type="file"]').setInputFiles(input);
    await expect(page.locator(".page-counter")).toHaveText("Page 1 / 6",{timeout:25_000});
    await page.getByRole("button",{name:"Print",exact:true}).click();
    const panel=page.getByRole("dialog",{name:"Print preparation"});
    await panel.getByRole("radio",{name:"Custom range"}).check();
    const range=panel.getByLabel("Custom page range");
    await range.fill("5, 2-3");
    await expect(panel.locator(".sheet-card")).toHaveCount(3,{timeout:20_000});
    expect(await panel.locator(".sheet-svg").evaluateAll((elements)=>
      elements.map(node=>node.getAttribute("aria-label"))))
      .toEqual(["Sheet 1, page 5","Sheet 2, page 2","Sheet 3, page 3"]);
    await range.fill("1, 1");
    await expect(panel.getByRole("alert")).toContainText("selected more than once");
    await expect(panel.getByRole("button",{name:"Prepare print-ready PDF"})).toBeDisabled();
    await range.fill("5, 2-3");
    await panel.getByRole("button",{name:"Prepare print-ready PDF"}).click();
    const downloadLink=panel.getByRole("link",{name:"Download printable PDF"});
    await expect(downloadLink).toBeVisible({timeout:30_000});
    const pending=page.waitForEvent("download");
    await downloadLink.click();
    await (await pending).saveAs(output);
    const selected=await PDFDocument.load(new Uint8Array(await readFile(output)));
    expect(selected.getPageCount()).toBe(3);
    expect(errors).toEqual([]);
  }finally{
    await context.close();
    await rm(dir,{recursive:true,force:true});
  }
});
