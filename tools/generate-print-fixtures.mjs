/**
 * Synthetic, non-confidential print test PDFs; independent of Weave.
 * This file is an unexecuted fixture generator until the validation phase.
 *
 * Run later: node tools/generate-print-fixtures.mjs
 * Requires Node 22+; no third-party packages.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = new URL("../test/fixtures/generated/", import.meta.url);
const encoder = new TextEncoder();

function pdfText(text) {
  // PDF literal strings must escape backslashes and parentheses.
  return String(text).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function number(value) {
  if (!Number.isFinite(value)) throw new RangeError("Invalid PDF number.");
  return String(value);
}

const PAGE_INCH = 72;
const inch = (value) => value * PAGE_INCH;

function labelContent({ title, width, height, index, orientation }) {
  const label = pdfText(title);
  const portrait = orientation === "P";
  const other = portrait ? "PORTRAIT" : "LANDSCAPE";
  // The arrows are asymmetrically placed to catch inadvertent rotation.
  return [
    "q",
    "0.10 0.36 0.66 RG 2 w",
    "20 20 " + number(width - 40) + " " + number(height - 40) + " re S",
    "0.8 0.1 0.1 RG 5 w",
    "25 25 m 120 25 l 120 110 l S",
    "0 0.55 0 RG 5 w",
    number(width - 25) + " " + number(height - 25) + " m " +
      number(width - 140) + " " + number(height - 25) + " l S",
    "Q",
    "BT /F1 26 Tf 48 " + number(height - 80) + " Td (" + label + ") Tj ET",
    "BT /F1 19 Tf 48 " + number(height - 112) +
      " Td (Page " + number(index) + " - " + other + ") Tj ET",
    "BT /F1 13 Tf 48 " + number(height - 144) +
      " Td (Source " + number(width) + " x " + number(height) + " pt) Tj ET",
    "BT /F1 12 Tf 48 52 Td (BOTTOM LEFT) Tj ET",
    ""
  ].join("\n");
}

function makePdf(pages) {
  const objects = new Map();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];
  let nextId = 4;
  for (let i = 0; i < pages.length; i++) {
    const spec = pages[i];
    const pageId = nextId++;
    const streamId = nextId++;
    pageIds.push(pageId);
    const content = labelContent({ ...spec, index: i + 1 });
    const page = [
      "<< /Type /Page /Parent 2 0 R",
      "/MediaBox [0 0 " + number(spec.width) + " " + number(spec.height) + "]",
      spec.crop ? "/CropBox [" + spec.crop.map(number).join(" ") + "]" : "",
      spec.rotate === undefined ? "" : "/Rotate " + number(spec.rotate),
      "/Contents " + streamId + " 0 R",
      "/Resources << /Font << /F1 3 0 R >> >> >>"
    ].filter(Boolean).join("\n");
    objects.set(pageId, page);
    objects.set(streamId, "<< /Length " + encoder.encode(content).byteLength +
      " >>\nstream\n" + content + "\nendstream");
  }
  objects.set(2,
    "<< /Type /Pages /Kids [" + pageIds.map((id) => id + " 0 R").join(" ") +
    "] /Count " + pages.length + " >>");

  const chunks = ["%PDF-1.7\n% Axik synthetic orientation fixture\n"];
  const offsets = [0];
  let position = encoder.encode(chunks[0]).byteLength;
  for (let id = 1; id < nextId; id++) {
    const value = objects.get(id);
    if (value === undefined) throw new Error("Missing PDF object " + id);
    offsets.push(position);
    const chunk = id + " 0 obj\n" + value + "\nendobj\n";
    chunks.push(chunk);
    position += encoder.encode(chunk).byteLength;
  }
  const xrefStart = position;
  chunks.push("xref\n0 " + nextId + "\n0000000000 65535 f \n");
  for (let id = 1; id < nextId; id++) {
    chunks.push(String(offsets[id]).padStart(10, "0") + " 00000 n \n");
  }
  chunks.push(
    "trailer\n<< /Size " + nextId + " /Root 1 0 R >>\n" +
    "startxref\n" + xrefStart + "\n%%EOF\n"
  );
  return encoder.encode(chunks.join(""));
}

const LETTER_P = { width: inch(8.5), height: inch(11), orientation: "P" };
const LETTER_L = { width: inch(11), height: inch(8.5), orientation: "L" };
const LEGAL_P = { width: inch(8.5), height: inch(14), orientation: "P" };
const TABLOID_L = { width: inch(17), height: inch(11), orientation: "L" };
const ARCH_D_L = { width: inch(36), height: inch(24), orientation: "L" };

const variants = {
  "alternating-letter-12.pdf": Array.from({ length: 12 }, (_, index) => ({
    ...(index % 2 ? LETTER_L : LETTER_P), title: "Alternating orientation"
  })),
  "rotations-and-crop.pdf": [
    { ...LETTER_P, rotate: 0, title: "Normal page" },
    { ...LETTER_L, rotate: 90, title: "Landscape media plus /Rotate 90" },
    { ...LETTER_P, rotate: 180, title: "Rotated 180" },
    { ...LETTER_P, rotate: 270, title: "Rotated 270" },
    { ...LETTER_P, crop: [45, 55, 500, 700], rotate: 90,
      title: "Nonzero CropBox origin" }
  ],
  "mixed-source-media.pdf": [
    { ...LETTER_P, title: "Letter portrait" },
    { ...LEGAL_P, title: "Legal portrait" },
    { ...TABLOID_L, title: "Tabloid landscape" },
    { ...ARCH_D_L, title: "Arch D landscape" },
    { ...LETTER_L, title: "Letter landscape" }
  ],
  "duplex-odd-5.pdf": Array.from({ length: 5 }, (_, index) => ({
    ...(index % 2 ? LETTER_L : LETTER_P), title: "Odd duplex case"
  }))
};

await mkdir(OUT, { recursive: true });
for (const [filename, pages] of Object.entries(variants)) {
  const bytes = makePdf(pages);
  const destination = join(OUT.pathname, filename);
  await writeFile(destination, bytes);
  process.stdout.write(filename + " (" + pages.length + " pages, " +
    bytes.byteLength + " bytes)\n");
}
