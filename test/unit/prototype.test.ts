import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import {
  applyCommand, initialEditorState, newCallout, normalizeRotation,
  undo, visiblePageSize
} from "@axik/document-core";
import {
  LETTER_PORTRAIT, DEFAULT_MARGINS, planFixedMedia, placementToSheetMatrix
} from "@axik/print-plan";
import { encodeDiagnosticZip, fileSizeBucketMiB, errorKind } from "@axik/diagnostics";
import { exportEditedPdf } from "@axik/pdf-writer";

test("PDF geometry handles rotations, crop offsets, and UserUnit", () => {
  assert.equal(normalizeRotation(-90), 270);
  assert.deepEqual(visiblePageSize({
    mediaBox: [-20, -50, 812, 562],
    cropBox: [10, 20, 730, 530],
    rotate: 90,
    userUnit: 1.5
  }), { width: 765, height: 1080 });
  assert.throws(() => normalizeRotation(45), RangeError);
});

test("fixed stock alternates page placement without changing printer sheet orientation", () => {
  const pages = Array.from({ length: 12 }, (_, index) => ({
    index,
    geometry: {
      mediaBox: index % 2
        ? [0, 0, 792, 612] as const
        : [0, 0, 612, 792] as const,
      rotate: 0 as const,
      userUnit: 1
    }
  }));
  const plan = planFixedMedia({
    pages, media: LETTER_PORTRAIT,
    margins: DEFAULT_MARGINS, scaling: "shrink-to-fit", duplex: "simplex"
  });
  assert.equal(plan.sheets.length, 12);
  assert.equal(plan.logicallyValid, true);
  const turns = plan.sheets.map((sheet) => sheet.faces[0]?.placement?.sheetRotation);
  assert.deepEqual(turns, [0, 90, 0, 90, 0, 90, 0, 90, 0, 90, 0, 90]);
  const p = plan.sheets[1]!.faces[0]!.placement!;
  const m = placementToSheetMatrix(p);
  assert.equal(m.length, 6);
  assert.equal(m[0], 0);
  assert.ok(m[1]! > 0);
});

test("actual-size clipping is a hard preflight blocker", () => {
  const plan = planFixedMedia({
    pages: [{ index: 0, geometry: { mediaBox: [0, 0, 2592, 1728], rotate: 0, userUnit: 1 } }],
    media: LETTER_PORTRAIT, margins: DEFAULT_MARGINS, duplex: "simplex", scaling: "actual-size"
  });
  assert.equal(plan.logicallyValid, false);
  assert.ok(plan.warnings.some((warning) => warning.code === "CLIPPED_AT_ACTUAL_SIZE" &&
    warning.blocksSubmission));
});

test("callout operations are immutable and undoable", () => {
  const callout = newCallout({
    id: "prototype-alpha-1", pageIndex: 0,
    tip: { x: 40, y: 200 }, pageBounds: { x: 0, y: 0, width: 612, height: 792 }
  });
  const initial = initialEditorState();
  const next = applyCommand(initial, { type: "add", annotation: callout });
  assert.equal(next.annotations.length, 1);
  assert.equal(initial.annotations.length, 0);
  assert.equal(undo(next).annotations.length, 0);
});

test("writer round-trips native FreeText callout dictionary and appearance reference", async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const bytes = await source.save();
  const callout = newCallout({
    id: "alpha-roundtrip-123", pageIndex: 0,
    tip: { x: 24, y: 160 }, pageBounds: { x: 0, y: 0, width: 612, height: 792 },
    text: "Review partition detail"
  });
  const exported = await exportEditedPdf(bytes, [callout]);
  assert.equal(exported.calloutsWritten, 1);
  const reopened = await PDFDocument.load(exported.bytes);
  assert.equal(reopened.getPageCount(), 1);
  const annotations = reopened.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray)!;
  assert.equal(annotations.size(), 1);
  const dict = reopened.context.lookup(annotations.get(0), PDFDict);
  assert.equal(dict.lookup(PDFName.of("Subtype"), PDFName).asString(), "/FreeText");
  assert.equal(dict.lookup(PDFName.of("IT"), PDFName).asString(), "/FreeTextCallout");
  const cl = dict.lookup(PDFName.of("CL"), PDFArray);
  assert.equal(cl.size(), 6);
  const ap = dict.lookup(PDFName.of("AP"), PDFDict);
  assert.ok(ap.get(PDFName.of("N")), "Appearance stream reference present");
  assert.ok(exported.bytes.byteLength > bytes.byteLength);
});

test("diagnostic errors are whitelisted, not full exception messages", () => {
  const error = new Error("C:\\Users\\Private\\secret-plan.pdf?token=hidden");
  assert.equal(errorKind(error), "Error");
  assert.equal(errorKind({ name: "secret-injected.pdf" }), "Unknown");
  assert.equal(fileSizeBucketMiB(5 * 1024 * 1024), 8);
});

test("ZIP support bundle has intact local headers and UTF-8 payloads", () => {
  const zip = encodeDiagnosticZip([
    { name: "README.txt", text: "hello" },
    { name: "events.jsonl", text: "{\"code\":\"PDF_OPEN_OK\"}\n" }
  ]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const length = view.getUint16(26, true);
  const first = new TextDecoder().decode(zip.slice(30, 30 + length));
  assert.equal(first, "README.txt");
  const firstContent = new TextDecoder().decode(zip.slice(30 + length, 35 + length));
  assert.equal(firstContent, "hello");
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
});
