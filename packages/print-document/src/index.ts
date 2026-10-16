/**
 * APDF-18/19: page-normalized, vector-preserving, single-stock PDF for printing.
 *
 * Every output page has the SAME physical sheet dimensions and page orientation.
 * Source page contents get their own intrinsic /Rotate and an independent
 * PrintPlan rotation. The OS print dialog can therefore keep one orientation.
 *
 * This is an intermediate PRINT FILE, not a printer-driver backend.  Existing
 * PDF annotations/forms are intentionally rejected in the vector-only path,
 * because embedding a PDF page as a form XObject does not copy its /Annots.
 * NEVER silently drop source markup or claim that the physical printer ran.
 */
import {
  PDFArray, PDFDocument, PDFName, PDFNumber, degrees, type PDFPage
} from "pdf-lib";
import {
  normalizeRotation, type PageGeometry
} from "@axik/document-core";
import {
  planFixedMedia, validatePrintIndices, type PlanOptions, type PrintPlan,
  type SourcePage
} from "@axik/print-plan";

const MAX_INPUT_BYTES = 150 * 1024 * 1024;
const MAX_PRINT_PAGES = 500;

export type PrintJobSettings = Omit<PlanOptions,"pages"> & {
  /** Zero-based source indices, ordered exactly as the user requested. */
  selectedPageIndices?: readonly number[];
};

export class PrintPreparationError extends Error {
  constructor(message: string, readonly code:
    "ANNOTATIONS_UNSUPPORTED" | "UNSAFE_GEOMETRY" |
    "PREFLIGHT_BLOCKED" | "UNSUPPORTED_DOCUMENT") {
    super(message);
    this.name = "PrintPreparationError";
  }
}

export interface NormalizedPrintResult {
  pdf: Uint8Array;
  plan: PrintPlan;
  /** No physical device was contacted or selected. */
  spooled: false;
  pageCount: number;
  warnings: string[];
}

function userUnit(page: PDFPage): number {
  const raw = page.node.lookupMaybe(PDFName.of("UserUnit"), PDFNumber);
  const u = raw?.asNumber() ?? 1;
  if (!Number.isFinite(u) || u <= 0 || u > 75_000) {
    throw new PrintPreparationError("Invalid or unsupported PDF UserUnit.", "UNSAFE_GEOMETRY");
  }
  return u;
}

function pageDescriptor(page: PDFPage, index: number): SourcePage {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const geometry: PageGeometry = {
    mediaBox: [media.x, media.y, media.x + media.width, media.y + media.height],
    cropBox: [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height],
    rotate: normalizeRotation(page.getRotation().angle),
    userUnit: userUnit(page)
  };
  return { index, geometry };
}

/** Built only from the same source bytes as the eventual normalized output. */
export async function planPrintableDocument(
  input: Uint8Array, settings: PrintJobSettings
): Promise<PrintPlan> {
  if (!input.length || input.length > MAX_INPUT_BYTES) {
    throw new PrintPreparationError("PDF is empty or too large for the print alpha.", "UNSUPPORTED_DOCUMENT");
  }
  const source = await PDFDocument.load(input.slice(), { updateMetadata: false });
  if (source.getPageCount() > MAX_PRINT_PAGES) {
    throw new PrintPreparationError("The alpha supports at most 500 print pages.", "UNSUPPORTED_DOCUMENT");
  }
  const indices=validatePrintIndices(source.getPageCount(),settings.selectedPageIndices);
  return planFixedMedia({
    ...settings,
    pages: indices.map(index=>pageDescriptor(source.getPage(index),index))
  });
}

/** Check annotations explicitly. Flattening them is an independent, tested feature. */
function requiresAnnotationFlattening(page: PDFPage): boolean {
  const raw = page.node.get(PDFName.of("Annots"));
  if (!raw) return false;
  const array = page.doc.context.lookup(raw, PDFArray);
  return array.size() > 0;
}

function originForRotation(
  rotationCW: 0|90|180|270,
  width: number, height: number,
  scale: number,
  bottomLeftX: number, bottomLeftY: number
): { x: number; y: number } {
  if (rotationCW === 0) return {x:bottomLeftX,y:bottomLeftY};
  if (rotationCW === 90) return {x:bottomLeftX,y:bottomLeftY+width*scale};
  if (rotationCW === 180) return {x:bottomLeftX+width*scale,y:bottomLeftY+height*scale};
  return {x:bottomLeftX+height*scale,y:bottomLeftY};
}

export async function normalizeForFixedStockPrinting(
  input: Uint8Array,
  settings: PrintJobSettings,
  options: { allowEmptyPages?: boolean } = {}
): Promise<NormalizedPrintResult> {
  if (!input.length || input.length > MAX_INPUT_BYTES) {
    throw new PrintPreparationError("PDF is empty or too large for safe normalization.", "UNSUPPORTED_DOCUMENT");
  }
  const source = await PDFDocument.load(input.slice(), { updateMetadata: false });
  const pages = source.getPages();
  if (!pages.length || pages.length > MAX_PRINT_PAGES) {
    throw new PrintPreparationError("Unsupported page count (maximum 500).", "UNSUPPORTED_DOCUMENT");
  }
  const indices=validatePrintIndices(pages.length,settings.selectedPageIndices);
  for (const index of indices) {
    const page=pages[index]!;
    if (requiresAnnotationFlattening(page)) {
      throw new PrintPreparationError(
        "PDF contains annotations or form widgets. Vector print preparation would hide them; " +
          "export a flattened markup copy using a verified renderer before printing.",
        "ANNOTATIONS_UNSUPPORTED"
      );
    }
  }
  const descriptors = indices.map(index=>pageDescriptor(pages[index]!,index));
  const plan = planFixedMedia({ ...settings, pages: descriptors });
  if (!plan.logicallyValid || plan.warnings.some(w=>w.blocksSubmission)) {
    throw new PrintPreparationError(
      "Physical sheet layout has blocking warnings; revise paper size or scaling.",
      "PREFLIGHT_BLOCKED"
    );
  }

  const result = await PDFDocument.create();
  // A new PDF is a printable derivative, not a legal change to the source PDF.
  const exported: string[] = [];
  const flattened = new Map<number, Awaited<ReturnType<typeof result.embedPage>>>();
  for (const item of plan.sheets) {
    for (const face of item.faces) {
      const sheet = result.addPage([settings.media.width, settings.media.height]);
      const placement = face.placement;
      if (!placement) {
        if (options.allowEmptyPages === false) {
          throw new PrintPreparationError("An unpaired duplex back sheet exists.", "PREFLIGHT_BLOCKED");
        }
        continue;
      }
      const original = pages[placement.pageIndex];
      if (!original) throw new PrintPreparationError("Page mapping is invalid.", "UNSAFE_GEOMETRY");
      const crop = original.getCropBox();
      const unit = userUnit(original);
      const rotationCW = normalizeRotation(
        original.getRotation().angle + placement.sheetRotation
      );
      const expectedWidth =
        (rotationCW === 0 || rotationCW === 180 ? crop.width : crop.height) *
          unit * placement.scale;
      const expectedHeight =
        (rotationCW === 0 || rotationCW === 180 ? crop.height : crop.width) *
          unit * placement.scale;
      if (Math.abs(expectedWidth - placement.width) > 0.05 ||
          Math.abs(expectedHeight - placement.height) > 0.05) {
        throw new PrintPreparationError(
          "PDF crop, rotation or scale did not match the validated PrintPlan.",
          "UNSAFE_GEOMETRY"
        );
      }
      let embedded = flattened.get(placement.pageIndex);
      if (!embedded) {
        embedded = await result.embedPage(original, {
          left: crop.x, bottom: crop.y,
          right: crop.x + crop.width, top: crop.y + crop.height
        }, [1,0,0,1,-crop.x,-crop.y]);
        flattened.set(placement.pageIndex, embedded);
      }
      const scale = unit*placement.scale;
      const p = originForRotation(
        rotationCW, crop.width, crop.height, scale,
        placement.x,
        settings.media.height-placement.y-placement.height
      );
      sheet.drawPage(embedded, {
        x:p.x, y:p.y, xScale:scale, yScale:scale,
        rotate:degrees(-rotationCW)
      });
      exported.push(String(placement.pageIndex));
    }
  }
  const output = await result.save({
    useObjectStreams:true,addDefaultPage:false
  });
  const reopened = await PDFDocument.load(output);
  const expectedFaces=plan.sheets.reduce((n,s)=>n+s.faces.length,0);
  if (reopened.getPageCount() !== expectedFaces) {
    throw new PrintPreparationError("Generated sheet count mismatches PrintPlan.", "UNSAFE_GEOMETRY");
  }
  for (const sheet of reopened.getPages()) {
    if (Math.abs(sheet.getWidth()-settings.media.width)>0.01 ||
        Math.abs(sheet.getHeight()-settings.media.height)>0.01) {
      throw new PrintPreparationError("Generated output has mixed physical paper sizes.", "UNSAFE_GEOMETRY");
    }
  }
  return {
    pdf:output, plan, spooled:false,
    pageCount:exported.length,
    warnings:[
      "Prepared output has fixed physical stock and rotation; no printer has been contacted.",
      "Source annotations/form widgets are not supported in the vector-only mode.",
      "Check the operating system print dialog for Actual Size/100%, paper stock and duplex."
    ]
  };
}
