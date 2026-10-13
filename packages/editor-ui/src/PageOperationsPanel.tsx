import {useEffect,useState} from "react";
import {type Annotation,normalizeRotation,type Rotation} from "@axik/document-core";
import {applyPageOperations,type PageOperation} from "@axik/page-operations";
import {exportEditedPdf} from "@axik/pdf-writer";
import {diagnostics} from "@axik/diagnostics";
import type {PdfDocument} from "./pdf";

/** Author page changes as a new PDF; never overwrite the drawing set directly. */
export function PageOperationsPanel({
  pdf,source,annotations,name,onClose
}:{
  pdf:PdfDocument;
  source:Uint8Array;
  annotations:readonly Annotation[];
  name:string;
  onClose:()=>void;
}){
  const [pages,setPages]=useState<PageOperation[]>(()=>Array.from(
    {length:pdf.numPages},(_,i)=>({sourceIndex:i,additionalRotation:0}))
  );
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string>();
  const [success,setSuccess]=useState<string>();

  useEffect(()=>{
    setPages(Array.from(
      {length:pdf.numPages},(_,i)=>({sourceIndex:i,additionalRotation:0})
    ));
    setError(undefined);setSuccess(undefined);
  },[pdf]);

  function reorder(index:number,direction:-1|1){
    const nextIndex=index+direction;
    if(nextIndex<0||nextIndex>=pages.length)return;
    setPages(prev=>{
      const update=[...prev];
      const moved=update[index]!;
      update[index]=update[nextIndex]!;
      update[nextIndex]=moved;
      return update;
    });
  }
  function rotate(index:number){
    setPages(prev=>prev.map((page,i)=>i===index ? {
      ...page,additionalRotation:normalizeRotation(page.additionalRotation+90)
    }:page));
  }
  async function exportPages(){
    if(busy||!pages.length)return;
    setBusy(true);setError(undefined);setSuccess(undefined);
    try{
      const edited=annotations.length
        ? (await exportEditedPdf(source,annotations)).bytes : source;
      const result=await applyPageOperations(edited,pages);
      const bytes=new Uint8Array(result.bytes.byteLength);
      bytes.set(result.bytes);
      const url=URL.createObjectURL(new Blob([bytes.buffer],{type:"application/pdf"}));
      const link=document.createElement("a");
      link.href=url;
      link.download=name.replace(/\.pdf$/i,"").slice(0,100)+"-pages-edited.pdf";
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60_000);
      setSuccess("New "+result.pageCount+"-page PDF download requested. The original is unchanged.");
      diagnostics.record("document","PDF_EXPORT_OK","info",{pageCount:result.pageCount});
    }catch(reason){
      diagnostics.recordError("document","PDF_EXPORT_FAILED",reason);
      setError(reason instanceof Error?reason.message:"Page operation failed.");
    }finally{setBusy(false);}
  }
  return <div className="modal-backdrop">
    <section className="print-panel" role="dialog" aria-modal="true"
      aria-label="Manage PDF pages">
      <header className="panel-heading">
        <div>
          <h2>Manage pages</h2>
          <p className="muted">Reorder, rotate or remove pages.
            Export the result as a new PDF; the original remains unchanged.</p>
        </div>
        <button disabled={busy} onClick={onClose}>Close</button>
      </header>
      <div className="page-operation-list">
        {pages.map((entry,index)=><div key={index} className="page-operation-row">
          <span>
            <strong>Output {index+1}</strong> ← original page {entry.sourceIndex+1}
            {entry.additionalRotation?" · +" + entry.additionalRotation+"°":""}
          </span>
          <button disabled={busy||index===0} onClick={()=>reorder(index,-1)}
            aria-label={"Move original page "+(entry.sourceIndex+1)+" earlier"}>↑</button>
          <button disabled={busy||index===pages.length-1} onClick={()=>reorder(index,1)}
            aria-label={"Move original page "+(entry.sourceIndex+1)+" later"}>↓</button>
          <button disabled={busy} onClick={()=>rotate(index)}
            aria-label={"Rotate original page "+(entry.sourceIndex+1)+" clockwise"}>↻</button>
          <button disabled={busy||pages.length<=1} onClick={()=>
            setPages(old=>old.filter((_,i)=>i!==index))}
            aria-label={"Delete output page "+(index+1)}>✕</button>
        </div>)}
      </div>
      <div className="diagnostics-actions">
        <button disabled={busy||!pages.length} className="primary"
          onClick={()=>void exportPages()}>
          {busy?"Creating PDF…":"Export selected page order"}
        </button>
        <button disabled={busy} onClick={()=>
          setPages(Array.from({length:pdf.numPages},(_,i)=>({
            sourceIndex:i,additionalRotation:0 as Rotation
          })))}>Reset</button>
      </div>
      {error && <p role="alert" className="diagnostics-warning">{error}</p>}
      {success && <p role="status" className="diagnostics-success">{success}</p>}
      <p className="muted">Native digital signatures may become invalid; verify
        form fields and third-party annotations after copying or reordering.
        Permanent redaction is not implemented here.</p>
    </section>
  </div>;
}
