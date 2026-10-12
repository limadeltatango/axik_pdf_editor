import React from "react";
import { createRoot } from "react-dom/client";
import { EditorApp } from "@axik/editor-ui";

const mount = document.getElementById("root");
if (!mount) throw new Error("Axik extension root element is missing.");
createRoot(mount).render(
  <React.StrictMode><EditorApp environment="extension" /></React.StrictMode>
);
