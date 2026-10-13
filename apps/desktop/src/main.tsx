import { invoke } from "@tauri-apps/api/core";
import { diagnostics } from "@axik/diagnostics";
import React from "react";
import { createRoot } from "react-dom/client";
import { EditorApp, EditorErrorBoundary } from "@axik/editor-ui";

diagnostics.configure("desktop", "0.1.0");

const mount = document.getElementById("root");
if (!mount) throw new Error("Axik editor root element is missing.");
createRoot(mount).render(
  <React.StrictMode><EditorErrorBoundary runtime="desktop" version="0.1.0"><EditorApp environment="desktop"
    onNativeOpen={async()=>{
      const record=await invoke<{token:string;name:string;bytes:number[]}|null>("open_native_pdf");
      if(!record)return null;
      return {token:record.token,name:record.name,bytes:new Uint8Array(record.bytes)};
    }}
    onNativeSave={async(token,bytes)=>{
      return await invoke<{token:string;name:string;backupName?:string|null}>(
        "save_native_pdf",{token,editedBytes:Array.from(bytes)}
      );
    }}
    onNativeSaveAs={async(bytes,suggestedName)=>{
      return await invoke<{token:string;name:string;backupName?:string|null}|null>(
        "save_native_pdf_as",{editedBytes:Array.from(bytes),suggestedName}
      );
    }}
    onNativePrint={async bytes=>{
    if(bytes.byteLength > 100*1024*1024){
      throw new RangeError("Prepared print PDF exceeds Windows handoff limit.");
    }
    await invoke("open_print_ready_pdf",{pdfData:Array.from(bytes)});
  }} /></EditorErrorBoundary></React.StrictMode>
);
