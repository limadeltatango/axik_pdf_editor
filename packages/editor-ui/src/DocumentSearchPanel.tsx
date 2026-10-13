import {useEffect,useRef,useState,type FormEvent} from "react";
import type {PdfDocument} from "./pdf";

/**
 * Non-destructive full-document text search using PDF.js text extraction.
 * Lazy: indexing begins ONLY after user submits a query, so first-page launch
 * and ordinary scrolling do not depend on scanning a large PDF.
 */
export interface SearchHit {
  pageIndex:number;
  preview:string;
  matchCount:number;
}

function extractText(items:readonly unknown[]):string{
  let result="";
  for(const raw of items){
    if(!raw||typeof raw!=="object"||!("str" in raw))continue;
    const item=raw as {str?:unknown;hasEOL?:unknown};
    if(typeof item.str!=="string")continue;
    // Search is for navigation, not a character-exact PDF text reconstruction.
    result+=item.str;
    result+=item.hasEOL?"\n":" ";
    if(result.length>150000)return result.slice(0,150000);
  }
  return result;
}

function matchCount(text:string,needle:string):number{
  if(!needle)return 0;
  const lower=text.toLocaleLowerCase("en-US");
  const query=needle.toLocaleLowerCase("en-US");
  let index=0,count=0;
  while(count<100){
    const at=lower.indexOf(query,index);
    if(at<0)break;
    count++;
    index=at+query.length;
  }
  return count;
}

export function DocumentSearchPanel({
  pdf,onJump,onClose
}:{
  pdf:PdfDocument;
  onJump:(page:number)=>void;
  onClose:()=>void;
}){
  const [query,setQuery]=useState("");
  const [results,setResults]=useState<SearchHit[]>([]);
  const [progress,setProgress]=useState(0);
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState<string>();
  const [error,setError]=useState<string>();
  const request=useRef(0);
  const cache=useRef(new Map<number,string>());

  useEffect(()=>{
    request.current++;
    cache.current.clear();
    setResults([]);
    setProgress(0);
    setLoading(false);
    setError(undefined);
    return ()=>{request.current++};
  },[pdf]);

  async function doSearch(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const needle=query.trim();
    const current=++request.current;
    setResults([]);
    setProgress(0);
    setNotice(undefined);
    setError(undefined);
    if(!needle)return;
    if(needle.length>256){
      setError("Search terms must not exceed 256 characters.");
      return;
    }
    setLoading(true);
    const matches:SearchHit[]=[];
    const maxPages=Math.min(pdf.numPages,1000);
    try{
      for(let i=0;i<maxPages;i++){
        if(request.current!==current)return;
        let text=cache.current.get(i);
        if(text===undefined){
          const page=await pdf.getPage(i+1);
          const content=await page.getTextContent();
          text=extractText(content.items);
          cache.current.set(i,text);
        }
        const n=matchCount(text,needle);
        if(n){
          const at=text.toLowerCase().indexOf(needle.toLowerCase());
          const from=Math.max(0,at-45),until=Math.min(text.length,at+needle.length+90);
          matches.push({
            pageIndex:i,preview:text.slice(from,until).trim(),
            matchCount:n
          });
        }
        if(i%8===0 || i===maxPages-1){
          setResults(matches.slice(0,200));
          setProgress(i+1);
          await Promise.resolve();
        }
      }
      if(current!==request.current)return;
      setNotice(matches.length===0?
        "No extractable text matched. Scanned images may require OCR.":
        "Found matches on "+matches.length+" page(s).");
      if(pdf.numPages>maxPages){
        setNotice("Search indexed the first "+maxPages+" pages only.");
      }
    }catch(reason){
      if(current===request.current){
        setError(reason instanceof Error?reason.message:"Document text indexing failed.");
      }
    }finally{
      if(current===request.current)setLoading(false);
    }
  }

  return <div className="modal-backdrop">
    <section className="search-panel" role="dialog" aria-modal="true"
      aria-label="Search PDF text">
      <header className="panel-heading">
        <div>
          <h2>Find text in document</h2>
          <p className="muted">Extracts searchable PDF text locally on demand.
            No document content is sent online.</p>
        </div>
        <button onClick={()=>{
          request.current++;setLoading(false);onClose();
        }}>Close</button>
      </header>
      <form onSubmit={event=>void doSearch(event)} className="search-controls">
        <input aria-label="Find text" type="search" value={query}
          onChange={event=>setQuery(event.target.value)}
          autoFocus maxLength={256} placeholder="Search notes, schedules, sheet text…"/>
        <button className="primary" type="submit" disabled={!query.trim()}>
          {loading?"Restart search":"Find"}
        </button>
      </form>
      {loading&&<p role="status" className="muted">
        Searching page {progress} of {Math.min(pdf.numPages,1000)}…
      </p>}
      {notice&&<p role="status" className="muted">{notice}</p>}
      {error&&<p role="alert" className="diagnostics-warning">{error}</p>}
      <div className="search-results">
        {results.map(hit=><button key={hit.pageIndex}
          className="search-result" onClick={()=>onJump(hit.pageIndex+1)}>
          <strong>Page {hit.pageIndex+1} · {hit.matchCount} match(es)</strong>
          <span>{hit.preview}</span>
        </button>)}
      </div>
      <p className="muted">This first version navigates to pages with matching
        extractable text. In-page highlighting, OCR and cross-glyph exact matching
        require separate work.</p>
    </section>
  </div>;
}
