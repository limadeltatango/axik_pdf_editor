import { diagnostics } from "@axik/diagnostics";
import React from "react";
import { createRoot } from "react-dom/client";
import { EditorApp, EditorErrorBoundary } from "@axik/editor-ui";

diagnostics.configure("desktop", "0.0.1");

const mount = document.getElementById("root");
if (!mount) throw new Error("Axik editor root element is missing.");
createRoot(mount).render(
  <React.StrictMode><EditorErrorBoundary runtime="desktop" version="0.0.1"><EditorApp environment="desktop" /></EditorErrorBoundary></React.StrictMode>
);
