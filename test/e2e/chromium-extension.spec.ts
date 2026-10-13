import { test, expect, chromium } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

test("real Chromium extension opens, annotates, exports and reopens a PDF", async () => {
  test.setTimeout(80_000);
  const tempDir = await mkdtemp(join(tmpdir(), "axik-prototype-e2e-"));
  const extensionPath = resolve("apps/chromium-extension/dist");
  const inputPath = join(tempDir, "source.pdf");
  const outputPath = join(tempDir, "edited.pdf");
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  page.drawText("Alpha prototype browser integration test", { x: 50, y: 690, size: 20 });
  await writeFile(inputPath, await source.save());

  const context = await chromium.launchPersistentContext(join(tempDir, "profile"), {
    headless: true,
    channel: "chromium",
    acceptDownloads: true,
    args: [
      "--disable-extensions-except=" + extensionPath,
      "--load-extension=" + extensionPath
    ]
  });

  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    expect(worker.url()).toContain("chrome-extension://");
    const extensionId = new URL(worker.url()).hostname;
    const tab = await context.newPage();
    const pageErrors: string[] = [];
    tab.on("pageerror", (error) => pageErrors.push(error.name));
    await tab.goto("chrome-extension://" + extensionId + "/viewer.html");
    await expect(tab.getByRole("heading", { name: /documents, without the overhead/i })).toBeVisible();

    await tab.locator('input[type="file"]').setInputFiles(inputPath);
    await expect(tab.locator(".page-counter")).toHaveText("Page 1 / 1", { timeout: 20_000 });
    await expect(tab.locator("svg.annotation-layer")).toBeVisible();

    await tab.getByRole("button", { name: /callout/i }).click();
    await tab.locator("svg.annotation-layer").click({ position: { x: 125, y: 165 } });
    await expect(tab.getByLabel("Callout text")).toBeVisible();
    await tab.getByLabel("Callout text").fill("Check partition detail A-101");
    const downloadPromise = tab.waitForEvent("download");
    await tab.getByRole("button", { name: "Quick Export" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("-axik-edited.pdf");
    await download.saveAs(outputPath);

    const exported = await PDFDocument.load(new Uint8Array(await readFile(outputPath)));
    expect(exported.getPageCount()).toBe(1);
    const annots = exported.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(1);
    const annotation = exported.context.lookup(annots.get(0), PDFDict);
    expect(annotation.lookup(PDFName.of("Subtype"), PDFName).asString()).toBe("/FreeText");
    expect(annotation.lookup(PDFName.of("IT"), PDFName).asString()).toBe("/FreeTextCallout");
    expect(annotation.lookup(PDFName.of("CL"), PDFArray).size()).toBe(6);
    expect(annotation.lookup(PDFName.of("AP"), PDFDict).get(PDFName.of("N"))).toBeTruthy();

    // Reopening the downloaded PDF must not crash the viewer.
    await tab.locator('input[type="file"]').setInputFiles(outputPath);
    await expect(tab.locator(".page-counter")).toHaveText("Page 1 / 1");
    await expect(tab.locator(".pdf-canvas")).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});
