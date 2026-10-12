import { useEffect, useState } from "react";
import { normalizeRotation, type PageGeometry } from "@axik/document-core";
import {
  DEFAULT_MARGINS, LETTER_PORTRAIT, LEGAL_PORTRAIT,
  TABLOID_PORTRAIT, planFixedMedia, printPlanSummary,
  type PhysicalMedia, type PrintPlan, type SourcePage
} from "@axik/print-plan";
import type { PdfDocument } from "./pdf";

const MEDIA: PhysicalMedia[] = [LETTER_PORTRAIT, LEGAL_PORTRAIT, TABLOID_PORTRAIT];

/**
 * Geometry-only preview. Real Windows printer integration is deliberately NOT
 * wired: the button never sends a job or implies successful physical printing.
 */
export function PrintPlanPanel({ pdf, onClose }: {
  pdf: PdfDocument;
  onClose: () => void;
}) {
  const [medium, setMedium] = useState(MEDIA[0]!.id);
  const [scale, setScale] = useState<"shrink-to-fit" | "actual-size">("shrink-to-fit");
  const [duplex, setDuplex] = useState<"simplex" | "long-edge" | "short-edge">("simplex");
  const [pages, setPages] = useState<SourcePage[]>();
  const [error, setError] = useState<string>();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    setPages(undefined);
    setCount(0);
    setError(undefined);
    (async () => {
      const descriptors: SourcePage[] = [];
      for (let index = 0; index < pdf.numPages; index++) {
        if (!active) return;
        const page = await pdf.getPage(index + 1);
        const [x1 = 0, y1 = 0, x2 = 612, y2 = 792] = page.view;
        const geometry: PageGeometry = {
          mediaBox: [x1, y1, x2, y2],
          rotate: normalizeRotation(page.rotate),
          userUnit: page.userUnit || 1
        };
        descriptors.push({ index, geometry });
        if (active) setCount(index + 1);
      }
      if (active) setPages(descriptors);
    })().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Print planning failed.");
    });
    return () => { active = false; };
  }, [pdf]);

  let plan: PrintPlan | undefined;
  let planError: string | undefined;
  try {
    if (pages) {
      plan = planFixedMedia({
        pages, media: MEDIA.find((paper) => paper.id === medium) ?? MEDIA[0]!,
        margins: DEFAULT_MARGINS, scaling: scale, duplex
      });
    }
  } catch (reason) {
    planError = reason instanceof Error ? reason.message : "Invalid print options.";
  }

  return <div className="modal-backdrop">
    <section className="print-panel" role="dialog" aria-modal="true" aria-label="Print planning preview">
      <header className="panel-heading">
        <div>
          <h2>Physical sheet layout preview</h2>
          <p className="muted">Planning only — no printer is connected and nothing will be sent to print.</p>
        </div>
        <button onClick={onClose}>Close</button>
      </header>
      <div className="print-options">
        <label>Paper
          <select value={medium} onChange={(e) => setMedium(e.target.value)}>
            {MEDIA.map((paper) => <option key={paper.id} value={paper.id}>{paper.label}</option>)}
          </select>
        </label>
        <label>Scaling
          <select value={scale} onChange={(e) => setScale(e.target.value as typeof scale)}>
            <option value="shrink-to-fit">Shrink only to fit</option>
            <option value="actual-size">100% — warn on clipping</option>
          </select>
        </label>
        <label>Duplex
          <select value={duplex} onChange={(e) => setDuplex(e.target.value as typeof duplex)}>
            <option value="simplex">Single-sided</option>
            <option value="long-edge">Long-edge</option>
            <option value="short-edge">Short-edge</option>
          </select>
        </label>
      </div>
      {!pages && !error && <p role="status">Reading page geometry: {count} / {pdf.numPages}</p>}
      {(error || planError) && <p role="alert" className="error">{error || planError}</p>}
      {plan && <>
        <p>{printPlanSummary(plan)}</p>
        {plan.warnings.length > 0 && (
          <div className="print-warnings" role="status">
            <strong>Layout notices</strong>
            <ul>{plan.warnings.slice(0, 15).map((warning, i) =>
              <li key={i}>{warning.message}</li>)}</ul>
            {plan.warnings.length > 15 &&
              <p>{plan.warnings.length - 15} additional notices omitted here.</p>}
          </div>
        )}
        <div className="sheet-list">
          {plan.sheets.slice(0, 100).flatMap((sheet) =>
            sheet.faces.filter((face) => face.placement).map((face) => {
              const placement = face.placement!;
              const sheetWidth = 180;
              const sheetHeight = sheetWidth * plan!.media.height / plan!.media.width;
              return <div key={String(sheet.index) + face.side} className="sheet-card">
                <svg role="img" aria-label={"Sheet " + (sheet.index + 1) + " " + face.side}
                  viewBox={"0 0 " + plan!.media.width + " " + plan!.media.height}
                  width={sheetWidth} height={sheetHeight} className="sheet-svg">
                  <rect x={0} y={0} width={plan!.media.width} height={plan!.media.height}
                    fill="white" stroke="#334155" strokeWidth={3} />
                  <rect x={placement.x} y={placement.y}
                    width={placement.width} height={placement.height}
                    fill="#e1eeff" stroke={placement.clipped ? "#dc2626" : "#2563eb"}
                    strokeWidth={2}/>
                  <text x={placement.x + 8} y={placement.y + 20}
                    fontSize={15} fill="#1f2937">Page {placement.pageIndex + 1}</text>
                  <text x={placement.x + 8} y={placement.y + 39}
                    fontSize={12} fill="#1f2937">Turn {placement.sheetRotation}°</text>
                </svg>
                <span>Sheet {sheet.index + 1}, {face.side} — page {placement.pageIndex + 1}
                  {" (" + Math.round(placement.scale * 100) + "%)"}</span>
              </div>;
            })
          )}
          {plan.sheets.length > 100 && <p>Only the first 100 sheets are previewed.</p>}
        </div>
      </>}
      <p className="muted">This previews geometry, not rendered page content. Native Windows driver checks,
        duplex orientation verification, accurate printer margins and spooling still require implementation.</p>
    </section>
  </div>;
}
