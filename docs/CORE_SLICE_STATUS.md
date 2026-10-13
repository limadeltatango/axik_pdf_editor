# Axik PDF Editor — Core Capability Slice (2026-10-13)

**Branch:** \`feat/apdf-core-editor-print-text\` (based on guarded Save draft)
**Jira:** APDF-18, APDF-19, APDF-23, APDF-33, APDF-46
**Delivery status:** First core implementation slice; Chrome/WebView2 validation required before final acceptance.

## Confirmed in source and CI

- **Quick Export** still downloads a new PDF rather than overwriting original.
- **Save As / Save Current** remain the guarded File System Access implementation from APDF-45. Save Current requires a separate verified backup and checks original file content before overwrite.
- **Callouts** stored as native FreeTextCallout annotations with \`/CL\`, \`/IT\`, \`/AP\` and \`/RD\` entries.
- **New text boxes** are typed native PDF FreeText annotations with appearance streams. This is NOT editing existing page text.
- **Sticky-note comments** are native \`/Text\` annotation objects with persistent content and an appearance icon.
- **Page management** supports reorder, rotate and delete through a new-copy export; source remains unchanged. Code also supports PDF merge (UI pending).
- **Fixed-stock print preparation** takes portrait/landscape PDF pages and produces a derived PDF whose output sheet sizes and page orientation are identical, without requiring the driver to switch orientation per input page.
- **Two print render paths:** Unannotated pages are embedded vector-to-vector using PDF content Form XObjects; annotated/form PDFs are rasterized by PDF.js so markups won't be silently dropped. Raster fallback is bounded (75 pages, 12M pixels/page, user-selected 96/144/216 dpi).
- **Windows print handoff** accepts print-ready bytes via a restricted Tauri command, saves a random temporary PDF under app data, and opens it in the Windows default PDF viewer. User then selects a printer in that viewer. No printer job is sent directly by Axik, and OS printer settings must still match the fixed paper and scaling.
- **Diagnostics** retains fixed-code local telemetry and manual ZIP export, including print-ready success/failure.
- **Validation** in CI includes typecheck, Node unit tests, Chromium headless end-to-end tests (PDF open, FreeText, comments, quick export, print preparation), package sanity checks and Windows compilation separately.

## Practical initial print workflow

1. Open a PDF (a copy is safest in this alpha).
2. Click **Print**, choose paper (Letter/Legal/Tabloid), scaling and duplex.
3. The sheet preview calculates independent placement for every source page. Inspect all scaling/clipping warnings; \`actual-size\` blocks when source content would clip.
4. Click **Prepare print-ready PDF**.
5. Choose **Download printable PDF**, **Open PDF to Print** (browser), or **Open in Windows PDF Viewer** (desktop).
6. In the system print dialog select the SAME physical paper and **Actual Size/100%**, and configure duplex if necessary. The source PDF is not overwritten.

**Important:** A source 11x8.5 landscape page is rotated to fit a portrait 8.5x11 output sheet. This ensures one fixed job orientation, but you may physically rotate the page to read landscape content. A CAD-scale drawing that requires true Arch sizes must use proper large-format media. Do not use this alpha as proof of an accurate-scaled plot.

## Critical outstanding release blockers

1. **Direct Windows print engine (APDF-19/20):** Native driver capability enumeration, printer profiles, spooler queue state, duplex/print-ticket control, hard margins and physical printer verification. The system-viewer handoff is a pragmatic interim path, not full automated driver control.
2. **True editing of existing PDF content (APDF-47):** Added FreeText is an annotation, not replacement/removal of underlying text content. Existing text extraction/font reflow/content-stream editing requires an independently qualified engine.
3. **Genuine irreversible redaction (APDF-29/30):** Not enabled or simulated with opaque coverups.
4. **GPU-first rendering (APDF-15):** Canvas/Chromium may use an accelerated compositor but actual PDF vector raster pipeline, tiling, device reset recovery and GPU-vs-CPU benchmark gates remain open.
5. **Visual signing (APDF-32):** Still outstanding; no certificate-based signature system.
6. **Full comments/editable imported annotation parity:** Text notes and FreeText currently round-trip as native PDF objects, but importing annotations into the Axik in-memory editing model is not complete. Editing a saved text box after reopening in Axik is still not supported.
7. **High-scale robustness:** Digital signatures and AcroForm/XFA widgets, large PDFs, giant vector drawings, protected/encrypted documents, Unicode font embedding, page-operation preserving forms, and recovery under forced power loss need qualification.
8. **Packaging/distribution:** Windows installer is unsigned development output and needs real installation/print testing. No silent auto-updates or unattended print jobs.

The user verified the initial Windows alpha Quick Export/reopen flow with callouts and provided a diagnostic ZIP with no recorded errors. That does not constitute acceptance of the newly added features.

**Source of truth for project status:** https://axikai.atlassian.net/jira/software/projects/APDF/boards/39
