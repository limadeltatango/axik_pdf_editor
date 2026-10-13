import { test, expect, chromium } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

test("Save Current creates and verifies backup before overwriting explicit source handle", async () => {
  test.setTimeout(80_000);
  const first = await PDFDocument.create();
  const page1 = first.addPage([612, 792]);
  page1.drawText("Original plan", { x: 60, y: 680, size: 20 });
  const initialBytes = Array.from(new Uint8Array(await first.save()));
  const tempDir = await mkdtemp(join(tmpdir(), "axik-save-e2e-"));
  const context = await chromium.launchPersistentContext(join(tempDir, "profile"), {
    headless: true, channel: "chromium",
    acceptDownloads: true,
    args: [
      "--disable-extensions-except=" + resolve("apps/chromium-extension/dist"),
      "--load-extension=" + resolve("apps/chromium-extension/dist")
    ]
  });

  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", {timeout: 15_000});
    const id = new URL(worker.url()).hostname;
    const tab = await context.newPage();
    const errors: string[] = [];
    tab.on("pageerror", e => errors.push(e.name));
    await tab.addInitScript(({pdf}) => {
      type MockState = {
        source: number[];
        backup: number[];
        backupWriteCount: number;
        sourceWriteCount: number;
      };
      const state: MockState = {
        source: pdf, backup: [],
        sourceWriteCount: 0, backupWriteCount: 0
      };
      const makeHandle = (name: string, key: "source" | "backup") => {
        const handle = {
          name,
          getFile: async () => new File([new Uint8Array(state[key])], name,
            {type: "application/pdf"}),
          isSameEntry: async (other: unknown) => other === handle,
          createWritable: async (options?: {mode?: string}) => {
            if (options?.mode !== "exclusive") throw Error("Unsafe non-exclusive save");
            let pending: number[] = [];
            return {
              write: async (bytes: Uint8Array) => { pending = Array.from(bytes); },
              close: async () => {
                state[key] = pending;
                if (key === "source") state.sourceWriteCount++;
                else state.backupWriteCount++;
              },
              abort: async () => { pending = []; }
            };
          }
        };
        return handle;
      };
      const source = makeHandle("plan.pdf", "source");
      const backup = makeHandle("plan.axik-before-save.pdf", "backup");
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true, value: async () => [source]
      });
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true, value: async () => backup
      });
      Object.defineProperty(window, "confirm", {
        configurable: true, value: () => true
      });
      (window as Window & {__testSaveState?: MockState}).__testSaveState = state;
    }, {pdf:initialBytes});

    await tab.goto("chrome-extension://" + id + "/viewer.html");
    await tab.getByRole("button", {name:"Open PDF"}).click();
    await expect(tab.locator(".page-counter")).toHaveText("Page 1 / 1", {timeout:20_000});
    await tab.getByRole("button", {name:/Callout/}).click();
    await tab.locator("svg.annotation-layer").click({position:{x:145,y:180}});
    await tab.getByLabel("Callout text").fill("Approved change to test plan");
    const save = tab.getByRole("button", {name:"Save", exact:true});
    await expect(save).toBeEnabled();
    await save.click();
    await expect(tab.getByText("Original overwritten after a separately verified backup", {exact:false}))
      .toBeVisible({timeout:20_000});
    await expect(save).toBeDisabled();

    const saved = await tab.evaluate(() => {
      const state = (window as Window & {__testSaveState?: {
        source:number[];backup:number[];sourceWriteCount:number;backupWriteCount:number
      }}).__testSaveState!;
      return state;
    });
    expect(saved.backupWriteCount).toBe(1);
    expect(saved.sourceWriteCount).toBe(1);
    expect(saved.backup).toEqual(initialBytes);
    const result = await PDFDocument.load(new Uint8Array(saved.source));
    const annots = result.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(1);
    const dict = result.context.lookup(annots.get(0), PDFDict);
    expect(dict.lookup(PDFName.of("IT"), PDFName).asString()).toBe("/FreeTextCallout");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(tempDir, {force:true,recursive:true});
  }
});
