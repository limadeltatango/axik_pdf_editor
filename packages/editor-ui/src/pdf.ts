/**
 * PDF.js is used for rendering and extraction only.
 * Saving new native PDF annotation dictionaries needs a separate validated writer.
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = pdfjs.PDFDocumentProxy;
export type PdfPage = pdfjs.PDFPageProxy;
export type PdfLoadingTask = pdfjs.PDFDocumentLoadingTask;

export function startOpenPdf(bytes: Uint8Array): PdfLoadingTask {
  // PDF.js transfers the supplied buffer to its worker; keep original bytes.
  const workerBytes = bytes.slice();
  return pdfjs.getDocument({
    data: workerBytes,
    isEvalSupported: false,
    useSystemFonts: true
  });
}

export function pdfError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "The PDF could not be opened or rendered.";
}
