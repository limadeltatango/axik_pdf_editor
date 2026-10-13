import { invoke } from "@tauri-apps/api/core";
import { diagnostics } from "@axik/diagnostics";
import React from "react";
import { createRoot } from "react-dom/client";
import { EditorApp, EditorErrorBoundary } from "@axik/editor-ui";

diagnostics.configure("desktop", "0.1.0");

const mount = document.getElementById("root");
if (!mount) throw new Error("Axik editor root element is missing.");
createRoot(mount).render(
  <React.StrictMode><EditorErrorBoundary runtime="desktop" version="0.1.0"><EditorApp environment="desktop" onNativePrint={async bytes=>{
    if(bytes.byteLength > 100*1024*1024){
      throw new RangeError("Prepared print PDF exceeds Windows handoff limit.");
    }
    await invoke("open_print_ready_pdf",{pdfData:Array.from(bytes)});
  }} /></EditorErrorBoundary></React.StrictMode>
);
