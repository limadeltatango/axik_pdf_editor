import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorApp, EditorErrorBoundary } from "@axik/editor-ui";
import { ExternalPdfLoader } from "./ExternalPdfLoader";
import "./extension.css";

function ExtensionEntry() {
  const [requestedFile, setRequestedFile] = useState<File>();
  return <>
    <ExternalPdfLoader onLoaded={setRequestedFile} />
    <EditorApp environment="extension" requestedFile={requestedFile} />
  </>;
}

const mount = document.getElementById("root");
if (!mount) throw new Error("Axik extension root element is missing.");
createRoot(mount).render(
  <React.StrictMode><EditorErrorBoundary><ExtensionEntry /></EditorErrorBoundary></React.StrictMode>
);
