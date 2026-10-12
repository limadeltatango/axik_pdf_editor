/**
 * Deterministic physical sheet planning. This package does NOT talk to a printer.
 * All units are 1/72 inch. The output is usable by preview and a future native spooler.
 * The current implementation supports a single, fixed stock size only.
 */
import { visiblePageSize, type PageGeometry } from "@axik/document-core";

export interface PhysicalMedia {
  id: string;
  label: string;
  width: number;
  height: number;
}
export interface PrintMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface SourcePage {
  index: number; // zero-based, unique within the plan
  geometry: PageGeometry;
}
export type ScalePolicy = "shrink-to-fit" | "actual-size";
export type DuplexMode = "simplex" | "long-edge" | "short-edge";
export type PlanWarningCode = "SCALED_DOWN" | "CLIPPED_AT_ACTUAL_SIZE" | "NO_PRINTABLE_AREA";
export interface PlanWarning {
  code: PlanWarningCode;
  pageIndex?: number;
  message: string;
  blocksSubmission: boolean;
}
export interface PagePlacement {
  pageIndex: number;
  sourceWidth: number; // source dimensions AFTER PDF intrinsic /Rotate and /UserUnit
  sourceHeight: number;
  /** Additional print-sheet rotation only, independent of the document's /Rotate. */
  sheetRotation: 0 | 90;
  /** Physical sheet position in points, top-left origin, pre-driver orientation. */
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  clipped: boolean;
}
export interface SheetFace {
  side: "front" | "back";
  placement?: PagePlacement;
}
export interface Sheet {
  index: number;
  faces: readonly SheetFace[];
}
export interface PrintPlan {
  version: 1;
  media: PhysicalMedia;
  margins: PrintMargins;
  scaling: ScalePolicy;
  duplex: DuplexMode;
  sheets: readonly Sheet[];
  warnings: readonly PlanWarning[];
  /** Logical planning only: a spool backend must still independently validate driver capabilities. */
  logicallyValid: boolean;
}
export interface PlanOptions {
  pages: readonly SourcePage[];
  media: PhysicalMedia;
  margins: PrintMargins;
  scaling: ScalePolicy;
  duplex: DuplexMode;
}
export const LETTER_PORTRAIT: PhysicalMedia = {
  id: "na-letter", label: "US Letter (8.5 x 11 in)", width: 612, height: 792
};
export const LEGAL_PORTRAIT: PhysicalMedia = {
  id: "na-legal", label: "US Legal (8.5 x 14 in)", width: 612, height: 1008
};
export const TABLOID_PORTRAIT: PhysicalMedia = {
  id: "na-tabloid", label: "Tabloid (11 x 17 in)", width: 792, height: 1224
};
export const DEFAULT_MARGINS: PrintMargins = {
  left: 18, right: 18, top: 18, bottom: 18
};

function positive(number: number, label: string): number {
  if (!Number.isFinite(number) || number <= 0 || number > 1e6) {
    throw new RangeError(label + " must be positive, finite, and bounded.");
  }
  return number;
}
function nonnegative(number: number, label: string): number {
  if (!Number.isFinite(number) || number < 0 || number > 1e6) {
    throw new RangeError(label + " must be finite, nonnegative, and bounded.");
  }
  return number;
}

interface Candidate {
  sheetRotation: 0 | 90;
  placedWidth: number;
  placedHeight: number;
  scale: number;
  /** Fraction of page area that can land in printable region. */
  visibleFraction: number;
}

function selectOrientation(
  pageWidth: number,
  pageHeight: number,
  availableWidth: number,
  availableHeight: number,
  scaling: ScalePolicy
): Candidate {
  const candidates: Candidate[] = ([0, 90] as const).map((angle) => {
    const width = angle === 90 ? pageHeight : pageWidth;
    const height = angle === 90 ? pageWidth : pageHeight;
    const fit = Math.min(1, availableWidth / width, availableHeight / height);
    const scale = scaling === "actual-size" ? 1 : fit;
    const placedWidth = width * scale;
    const placedHeight = height * scale;
    const visibleFraction = Math.min(1, availableWidth / placedWidth) *
      Math.min(1, availableHeight / placedHeight);
    return { sheetRotation: angle, placedWidth, placedHeight, scale, visibleFraction };
  });
  // For shrink-to-fit maximize readable scale; for actual size minimize clipping.
  // Ties deliberately prefer zero additional rotation to avoid unnecessary turns.
  const a = candidates[0]!;
  const b = candidates[1]!;
  const scoreA = scaling === "actual-size" ? a.visibleFraction : a.scale;
  const scoreB = scaling === "actual-size" ? b.visibleFraction : b.scale;
  return scoreB > scoreA + 1e-9 ? b : a;
}

export function planFixedMedia(options: PlanOptions): PrintPlan {
  const { pages, media, scaling, duplex, margins } = options;
  positive(media.width, "Paper width");
  positive(media.height, "Paper height");
  if (!media.id.trim() || !media.label.trim()) throw new RangeError("Paper media identity required.");
  const left = nonnegative(margins.left, "Left margin");
  const right = nonnegative(margins.right, "Right margin");
  const top = nonnegative(margins.top, "Top margin");
  const bottom = nonnegative(margins.bottom, "Bottom margin");
  if (!["actual-size", "shrink-to-fit"].includes(scaling)) throw new RangeError("Unknown scale policy.");
  if (!["simplex", "long-edge", "short-edge"].includes(duplex)) throw new RangeError("Unknown duplex mode.");
  if (pages.length > 100_000) throw new RangeError("Too many source pages.");

  const availableWidth = media.width - left - right;
  const availableHeight = media.height - top - bottom;
  const warnings: PlanWarning[] = [];
  if (availableWidth <= 0 || availableHeight <= 0) {
    warnings.push({
      code: "NO_PRINTABLE_AREA",
      message: "Printer margins leave no printable area.",
      blocksSubmission: true
    });
    return {
      version: 1, media, margins, scaling, duplex, sheets: [],
      warnings, logicallyValid: false
    };
  }

  const seen = new Set<number>();
  const placements = pages.map(({ index, geometry }): PagePlacement => {
    if (!Number.isSafeInteger(index) || index < 0 || seen.has(index)) {
      throw new RangeError("Page indices must be distinct, nonnegative integers.");
    }
    seen.add(index);
    const { width, height } = visiblePageSize(geometry);
    positive(width, "Visible page width");
    positive(height, "Visible page height");
    const selected = selectOrientation(width, height, availableWidth, availableHeight, scaling);
    const clipped = selected.placedWidth > availableWidth + 1e-7 ||
      selected.placedHeight > availableHeight + 1e-7;
    if (clipped) {
      warnings.push({
        code: "CLIPPED_AT_ACTUAL_SIZE", pageIndex: index,
        message: "Page " + (index + 1) + " exceeds printer margins at actual size.",
        blocksSubmission: true
      });
    } else if (selected.scale < 1 - 1e-9) {
      warnings.push({
        code: "SCALED_DOWN", pageIndex: index,
        message: "Page " + (index + 1) + " will print at " +
          Math.round(selected.scale * 1000) / 10 + "% size.",
        blocksSubmission: false
      });
    }
    return {
      pageIndex: index, sourceWidth: width, sourceHeight: height,
      sheetRotation: selected.sheetRotation,
      scale: selected.scale,
      x: left + (availableWidth - selected.placedWidth) / 2,
      y: top + (availableHeight - selected.placedHeight) / 2,
      width: selected.placedWidth, height: selected.placedHeight, clipped
    };
  });

  const sheets: Sheet[] = [];
  const isDuplex = duplex !== "simplex";
  for (let i = 0; i < placements.length; i += isDuplex ? 2 : 1) {
    const first = placements[i]!;
    const second = isDuplex ? placements[i + 1] : undefined;
    const faces: SheetFace[] = [{ side: "front", placement: first }];
    if (isDuplex) faces.push({ side: "back", placement: second });
    sheets.push({ index: sheets.length, faces });
  }
  return {
    version: 1,
    media: { ...media }, margins: { ...margins }, scaling, duplex,
    sheets, warnings,
    logicallyValid: !warnings.some((warning) => warning.blocksSubmission)
  };
}

/**
 * Only a display summary. A native printer backend MUST not mistake this
 * helper's output for a physical printer's actual spool state.
 */
export function printPlanSummary(plan: PrintPlan): string {
  const pageCount = plan.sheets.reduce((sum, sheet) =>
    sum + sheet.faces.filter((face) => !!face.placement).length, 0);
  return pageCount + " page(s) on " + plan.sheets.length + " sheet(s), " +
    plan.media.label + ", " + plan.duplex + ".";
}
