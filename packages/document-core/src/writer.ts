import type { Annotation } from "./annotations";

export interface PdfExportInput {
  original: Uint8Array;
  annotations: readonly Annotation[];
}

/**
 * PDF writer implementations must emit a valid PDF file with actual annotation
 * dictionaries, fonts/resources and appearance streams. A JSON/overlay is not
 * acceptable as a finished portable PDF.
 */
export interface PdfWriter {
  readonly id: string;
  readonly nativeCalloutSupport: boolean;
  exportPdf(input: PdfExportInput): Promise<Uint8Array>;
}

/** Never silently export an unmodified source after the user has edited it. */
export class PdfWriterUnavailableError extends Error {
  constructor() {
    super("Portable PDF editing/export has not been implemented. Edits are draft-only.");
    this.name = "PdfWriterUnavailableError";
  }
}

export class OriginalOnlyPdfWriter implements PdfWriter {
  readonly id = "original-only";
  readonly nativeCalloutSupport = false;

  async exportPdf({ original, annotations }: PdfExportInput): Promise<Uint8Array> {
    if (annotations.length > 0) throw new PdfWriterUnavailableError();
    return original.slice();
  }
}
