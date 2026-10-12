import React from "react";
import { createRoot } from "react-dom/client";
import { EditorApp, EditorErrorBoundary } from "@axik/editor-ui";

const mount = document.getElementById("root");
if (!mount) throw new Error("Axik editor root element is missing.");
createRoot(mount).render(
  <React.StrictMode><EditorErrorBoundary><EditorApp environment="desktop" /></EditorErrorBoundary></React.StrictMode>
);
