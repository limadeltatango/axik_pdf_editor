import { test, expect, chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression for APDF-52.
 *
 * The desktop entry supplies onNativeOpen, but the regular "Open PDF" button
 * MUST still emit a native browser/WebView2 HTML filechooser event. This
 * catches the regression where Open PDF silently invoked only the Rust RFD
 * picker and left no fallback.
 *
 * Run against Vite dev:web; no Tauri IPC or physical Windows shell required.
 */
test("desktop Open PDF shows standard filechooser and loads PDFs", async () => {
  test.setTimeout(45_000);
  const folder = await mkdtemp(join(tmpdir(), "axik-open-regression-"));
  const first = join(folder, "test-one.pdf");
  const second = join(folder, "test-two.pdf");
  const onePage = await PDFDocument.create();
  onePage.addPage([612,792]);
  const twoPages = await PDFDocument.create();
  twoPages.addPage([612,792]);
  twoPages.addPage([792,612]);
  await writeFile(first, await onePage.save());
  await writeFile(second, await twoPages.save());

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.name));
    await page.goto("http://127.0.0.1:1420", {
      waitUntil: "domcontentloaded", timeout: 15_000
    });
    await expect(page.getByRole("button", {name:"Open PDF", exact:true}))
      .toBeVisible();
    const nativeUnfilteredInput=page.locator('input[type="file"]');
    await expect(nativeUnfilteredInput).toHaveCount(1);
    // APDF-52 reproduction: Windows displayed
    // "Custom files (*.pdf;*.pdf)" from application/pdf,.pdf,
    // and disabled its Open action for a user-selected PDF.
    // The desktop picker must have NO MIME/extension filter.
    await expect(nativeUnfilteredInput).not.toHaveAttribute("accept");

    // The new advanced native dialog must NOT monopolize basic PDF opening.
    await expect(page.getByRole("button", {name:"Open for Save…"}))
      .toBeVisible();

    const firstChooser = page.waitForEvent("filechooser", {timeout: 5_000});
    await page.getByRole("button", {name:"Open PDF", exact:true}).click();
    await (await firstChooser).setFiles(first);
    await expect(page.locator(".filename")).toHaveText("test-one.pdf", {
      timeout: 20_000
    });
    await expect(page.locator(".page-counter")).toHaveText("Page 1 / 1");
    await expect(page.locator(".pdf-canvas")).toBeVisible();
    // Regular opens intentionally leave in-place overwrite unavailable.
    await expect(page.getByRole("button", {name:"Save",exact:true}))
      .toBeDisabled();

    const secondChooser = page.waitForEvent("filechooser", {timeout: 5_000});
    await page.getByRole("button", {name:"Open PDF", exact:true}).click();
    await (await secondChooser).setFiles(second);
    await expect(page.locator(".filename")).toHaveText("test-two.pdf", {
      timeout: 20_000
    });
    await expect(page.locator(".page-counter")).toHaveText("Page 1 / 2");

    // The unfiltered dialog can return a non-PDF: reject it explicitly.
    const notPdf=join(folder,"not-a-pdf.txt");
    await writeFile(notPdf,"Plain text, not a PDF");
    const thirdChooser=page.waitForEvent("filechooser", {timeout:5000});
    await page.getByRole("button",{name:"Open PDF",exact:true}).click();
    await (await thirdChooser).setFiles(notPdf);
    await expect(page.getByText("Please select an existing PDF document (.pdf)."))
      .toBeVisible();
    await expect(page.locator(".filename")).toHaveText("test-two.pdf");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await rm(folder, {recursive:true,force:true});
  }
});
