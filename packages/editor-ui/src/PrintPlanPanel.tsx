import { useEffect, useState } from "react";
import { diagnostics } from "@axik/diagnostics";
import { normalizeRotation, type Annotation, type PageGeometry } from "@axik/document-core";
import {
  DEFAULT_MARGINS, LETTER_PORTRAIT, LEGAL_PORTRAIT,
  TABLOID_PORTRAIT, ARCH_C_PORTRAIT, ARCH_D_PORTRAIT, ARCH_E_PORTRAIT,
  planFixedMedia, printPlanSummary, checkPrinterMedia,
  type PhysicalMedia, type PrintPlan, type SourcePage,
  type InstalledPrinter, type DriverPrinterCapabilities
} from "@axik/print-plan";
import { preparePrintDocument } from "./prepare-print";
import type { PdfDocument } from "./pdf";

const MEDIA: PhysicalMedia[] = [
  LETTER_PORTRAIT, LEGAL_PORTRAIT, TABLOID_PORTRAIT,
  ARCH_C_PORTRAIT, ARCH_D_PORTRAIT, ARCH_E_PORTRAIT
];

/**
 * The first REAL print capability: prepare a fixed-stock PDF with every sheet
 * portrait, then hand it to the system's native PDF/print dialog. This is not
 * a replacement for Windows driver controls (APDF-19) and does not promise a
 * physical print completion. It gives a practical mixed-orientation workaround.
 */
export function PrintPlanPanel({
  pdf, source, annotations, name, onClose, onNativePrint,
  onPrinterList, onPrinterCapabilities
}: {
  pdf: PdfDocument;
  source: Uint8Array;
  annotations: readonly Annotation[];
  name: string;
  onClose: () => void;
  onNativePrint?: (bytes:Uint8Array)=>Promise<void>;
  onPrinterList?: ()=>Promise<InstalledPrinter[]>;
  onPrinterCapabilities?: (printerName:string)=>Promise<DriverPrinterCapabilities>;
}) {
  const [medium, setMedium] = useState(MEDIA[0]!.id);
  const [scale, setScale] = useState<"shrink-to-fit" | "actual-size">("shrink-to-fit");
  const [duplex, setDuplex] = useState<"simplex" | "long-edge" | "short-edge">("simplex");
  const [rasterDpi, setRasterDpi] = useState(144);
  const [pages, setPages] = useState<SourcePage[]>();
  const [error, setError] = useState<string>();
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [printers, setPrinters] = useState<InstalledPrinter[]>();
  const [selectedPrinter,setSelectedPrinter]=useState("");
  const [selectedCapabilities,setSelectedCapabilities]=useState<DriverPrinterCapabilities>();
  const [printerError,setPrinterError]=useState<string>();
  const [printerBusy,setPrinterBusy]=useState(false);
  const [prepared, setPrepared] = useState<{
    url: string;
    mode: "vector" | "raster";
    warnings: readonly string[];
    plan: PrintPlan;
    bytes: Uint8Array;
  }>();

  useEffect(() => () => {
    if(prepared?.url)URL.revokeObjectURL(prepared.url);
  }, [prepared?.url]);

  useEffect(()=>{
    if(!onPrinterList)return;
    let live=true;
    onPrinterList().then(value=>{
      if(live)setPrinters(value);
    }).catch(()=>{
      if(live)setPrinterError("Installed printer discovery failed. You may still prepare a PDF.");
    });
    return ()=>{live=false};
  },[onPrinterList]);

  useEffect(()=>{
    if(!selectedPrinter || !onPrinterCapabilities){
      setSelectedCapabilities(undefined);
      setPrinterError(undefined);
      return;
    }
    let live=true;
    setPrinterBusy(true);
    setPrinterError(undefined);
    setSelectedCapabilities(undefined);
    onPrinterCapabilities(selectedPrinter).then(result=>{
      if(live)setSelectedCapabilities(result);
    }).catch(()=>{
      if(live)setPrinterError(
        "The driver did not provide media capability information. Verify the paper in the system print dialog."
      );
    }).finally(()=>{
      if(live)setPrinterBusy(false);
    });
    return ()=>{live=false};
  },[selectedPrinter,onPrinterCapabilities]);

  useEffect(() => {
    // A prepared file is invalid as soon as any physical print option changes.
    setPrepared(undefined);
  }, [medium,scale,duplex,rasterDpi,annotations,source]);

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
  const media = MEDIA.find(paper => paper.id === medium) ?? MEDIA[0]!;
  const selectedCheck=selectedCapabilities
    ? checkPrinterMedia(media,duplex,selectedCapabilities) : undefined;
  const printerMismatch=Boolean(selectedPrinter && selectedCheck &&
    (selectedCheck.paper==="unsupported" || selectedCheck.duplex==="unsupported"));
  try {
    if (pages) plan = planFixedMedia({
      pages, media, margins: DEFAULT_MARGINS, scaling: scale, duplex
    });
  } catch (reason) {
    planError = reason instanceof Error ? reason.message : "Invalid print options.";
  }

  useEffect(() => {
    if (!pages) return;
    try {
      const completed = planFixedMedia({
        pages, media: MEDIA.find(p=>p.id===medium)??MEDIA[0]!,
        margins:DEFAULT_MARGINS,scaling:scale,duplex
      });
      diagnostics.record("print","PRINT_PLAN_OK","info",{
        sheetCount:completed.sheets.length,warningCount:completed.warnings.length
      });
    }catch(reason){
      diagnostics.recordError("print","PRINT_PLAN_FAILED",reason);
    }
  },[pages,medium,scale,duplex]);

  async function prepare() {
    if(busy || !plan?.logicallyValid)return;
    setError(undefined);
    setBusy(true);
    setProgress("Preparing sheets…");
    const started=performance.now();
    try{
      const result=await preparePrintDocument(source,annotations,{
        media,margins:DEFAULT_MARGINS,scaling:scale,duplex
      },{
        rasterDpi,
        onProgress:(current,total)=>setProgress("Rendering print pages "+current+" / "+total)
      });
      const bytes=new Uint8Array(result.bytes.byteLength);
      bytes.set(result.bytes);
      const url=URL.createObjectURL(new Blob([bytes.buffer],{type:"application/pdf"}));
      setPrepared({
        url,mode:result.mode,bytes,
        warnings:result.warnings,plan:result.plan
      });
      diagnostics.record("print","PRINT_READY_OK","info",{
        durationMs:performance.now()-started,
        sheetCount:result.plan.sheets.length,
        pageCount:result.plan.sheets.reduce((n,s)=>n+s.faces.filter(f=>f.placement).length,0)
      });
      setProgress("Prepared. Download or open the PDF in your print viewer.");
    }catch(reason){
      diagnostics.recordError("print","PRINT_READY_FAILED",reason,{
        durationMs:performance.now()-started
      });
      setError(reason instanceof Error?reason.message:"Could not prepare a printable PDF.");
    }finally{setBusy(false);}
  }

  const safeName=name.replace(/\.pdf$/i,"").replace(/[\\/:*?"<>|\x00-\x1f]/g,"_")
    .slice(0,100)+"-print-ready.pdf";

  return <div className="modal-backdrop">
    <section className="print-panel" role="dialog" aria-modal="true" aria-label="Print preparation">
      <header className="panel-heading">
        <div>
          <h2>Intelligent print preparation</h2>
          <p className="muted">Normalize every source page into the same physical sheet
            size. This removes per-page driver orientation changes.</p>
        </div>
        <button onClick={onClose} disabled={busy}>Close</button>
      </header>
      <div className="print-options">
        <label>Paper
          <select value={medium} disabled={busy} onChange={e=>setMedium(e.target.value)}>
            {MEDIA.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label>Scaling
          <select value={scale} disabled={busy} onChange={e=>setScale(e.target.value as typeof scale)}>
            <option value="shrink-to-fit">Shrink only to fit</option>
            <option value="actual-size">100% — block if clipped</option>
          </select>
        </label>
        <label>Duplex sequence
          <select value={duplex} disabled={busy} onChange={e=>setDuplex(e.target.value as typeof duplex)}>
            <option value="simplex">Single-sided</option>
            <option value="long-edge">Long-edge (set in printer too)</option>
            <option value="short-edge">Short-edge (set in printer too)</option>
          </select>
        </label>
        <label>Annotated page raster quality
          <select value={rasterDpi} disabled={busy}
            onChange={e=>setRasterDpi(Number(e.target.value))}>
            <option value={96}>96 DPI (smaller)</option>
            <option value={144}>144 DPI (default)</option>
            <option value={216}>216 DPI (sharper)</option>
          </select>
        </label>
      </div>
      {onPrinterList && <div className="printer-capabilities">
        <h3>Windows printer capability check</h3>
        <p className="muted">Optional preflight. Axik reads installed driver capabilities;
          it does not choose the printer for the external PDF viewer.</p>
        <label>Check this installed printer:
          <select value={selectedPrinter} disabled={printerBusy}
            onChange={event=>setSelectedPrinter(event.target.value)}>
            <option value="">No printer selected</option>
            {(printers??[]).map(printer=><option value={printer.name}
              key={printer.name}>{printer.name}{printer.isNetwork?" (network)":""}</option>)}
          </select>
        </label>
        {printerBusy && <p role="status">Reading printer driver capabilities…</p>}
        {printerError && <p className="diagnostics-warning" role="status">{printerError}</p>}
        {selectedCheck && <p role="status" className={
          printerMismatch?"diagnostics-warning":"muted"
        }>
          Paper: {selectedCheck.paper};
          duplex: {selectedCheck.duplex}.
          {" "+selectedCheck.note}
        </p>}
        {selectedCapabilities && <p className="muted">
          {selectedCapabilities.papers.length} advertised media size(s);
          driver duplex: {selectedCapabilities.duplexAdvertised?"yes":"no"}.
          This does not confirm loaded trays or physical output.
        </p>}
        {!printers?.length && !printerError && <p className="muted">
          No installed printers found, or discovery is pending.
        </p>}
      </div>}
      {!pages && !error && <p role="status">Reading page geometry: {count} / {pdf.numPages}</p>
      {(error || planError) && <p role="alert" className="diagnostics-warning">{error || planError}</p>}
      {plan && <>
        <p>{printPlanSummary(plan)}</p>
        {plan.warnings.length > 0 && <div className="print-warnings" role="status">
          <strong>Layout notices</strong>
          <ul>{plan.warnings.slice(0,12).map((w,i)=><li key={i}>{w.message}</li>)}</ul>
        </div>}
        <div className="sheet-list">
          {plan.sheets.slice(0,50).flatMap(sheet=>sheet.faces.filter(face=>face.placement)
            .map(face=>{
              const p=face.placement!;
              const height=170*plan!.media.height/plan!.media.width;
              return <div className="sheet-card" key={sheet.index+face.side}>
                <svg viewBox={"0 0 "+plan!.media.width+" "+plan!.media.height}
                  width={170} height={height} className="sheet-svg"
                  aria-label={"Sheet "+(sheet.index+1)+", page "+(p.pageIndex+1)}>
                  <rect x={0} y={0} width={plan!.media.width} height={plan!.media.height}
                    fill="#fff" stroke="#284060" strokeWidth={3}/>
                  <rect x={p.x} y={p.y} width={p.width} height={p.height}
                    fill="#e1eeff" stroke={p.clipped?"#dc2626":"#2563eb"} strokeWidth={2}/>
                  <text x={p.x+8} y={p.y+20} fontSize={14} fill="#172334">
                    Page {p.pageIndex+1} · {p.sheetRotation}°
                  </text>
                </svg>
                <span>Sheet {sheet.index+1} {face.side}, {Math.round(p.scale*100)}%</span>
              </div>;
            }))}
        </div>
        {plan.sheets.length>50 && <p className="muted">Only 50 sheet thumbnails displayed.</p>}
      </>}
      <div className="diagnostics-actions">
        <button className="primary" disabled={!plan?.logicallyValid || busy}
          onClick={()=>void prepare()}>
          {busy?"Preparing…":"Prepare print-ready PDF"}
        </button>
        {prepared && <>
          <a className="print-download-link" download={safeName} href={prepared.url}>
            Download printable PDF
          </a>
          <a className="print-download-link" href={prepared.url}
            target="_blank" rel="noopener noreferrer">
            Open PDF to Print
          </a>
          {onNativePrint && <button disabled={printerMismatch}
            title={printerMismatch?"Printer capabilities do not support these selected settings":""}
            onClick={async()=>{
            try{
              await onNativePrint(prepared.bytes);
              setProgress("Print-ready PDF opened in the system viewer. Use its Print dialog.");
            }catch(reason){
              setError(reason instanceof Error ? reason.message :
                "Could not open the system PDF viewer.");
            }
          }}>
            Open in Windows PDF Viewer
          </button>}
        </>}
      </div>
      {progress && <p role="status" className="muted">{progress}</p>}
      {prepared && <>
        <p className="diagnostics-success">
          Prepared {prepared.plan.sheets.length} physical sheet(s) using
          {" "+prepared.mode} rendering. No printer job was submitted.
        </p>
        <ul className="muted">
          {prepared.warnings.map((warning,i)=><li key={i}>{warning}</li>)}
        </ul>
      </>}
      <p className="diagnostics-warning">
        Before printing, select {media.label}, Actual Size / 100% and the correct
        duplex setting in the OS print dialog. Physical printer-driver
        enumeration, validated hardware margins, print spool status, and Arch
        drawing sizes are not yet implemented. The preview above shows sheet geometry,
        not a pixel-identical rendered print preview.
      </p>
    </section>
  </div>;
}
