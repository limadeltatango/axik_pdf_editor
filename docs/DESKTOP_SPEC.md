# Axik PDF Editor — Desktop Application Specification

**Document ID:** AXP-DESK-001  
**Version:** 0.1 (proposed, not yet approved)  
**Date:** 2026-10-12  
**Platform:** Windows desktop (Windows 10/11 validation; Windows 11 primary release target; Windows 10 compatibility explicitly tested where maintained runtime prerequisites allow).  
**Scope:** Functional requirements for a standalone, offline-capable, GPU-aware desktop PDF editor. No Weave execution or dependency.

## 1. Objective

Deliver an Acrobat-class general-purpose PDF editor whose daily operations are faster, more predictable, and safer than existing editors. Mixed portrait/landscape printing is a **release-blocking** requirement. Native PDF callouts, comments, genuine redaction, non-certified visible signing, and common page management are core requirements. Cold start, responsiveness, and resistance to crashes are first-class quality attributes.

The triggering problem is real: PDF-XChange Editor still printed incorrectly with Fit to Printer Margins, Auto-Rotate enabled and automatic page-size selection disabled. Do not redefine that failure as user error or ship a print engine that relies on those same manual orientation changes.

## 2. Priority vocabulary

- **P0:** Required to qualify the first usable desktop release; do not ship without passing acceptance criteria.
- **P1:** Needed for a credible Acrobat-class release, to follow the first focused release.
- **P2:** Planned expansion; architect for it now, implement later.
- **RISK:** A requirement requiring an isolated technical proof before committing to one implementation.

All acceptance tests refer to docs/QUALITY_AND_TESTS.md. Product-wide constraints are in docs/PRODUCT_REQUIREMENTS.md.

## 3. Desktop experience and file handling

- **DESK-001 [P0]** Native-feeling Windows application with single-click launch, document tabs, recent-files list (can be disabled), drag/drop, File > Open and Open With integration. Installation must not change PDF default app without consent.
- **DESK-002 [P0]** Show first useful content progressively instead of delaying UI for parsing the whole file. Opening and rendering must be cancellable; corrupt or encrypted PDFs must produce actionable errors.
- **DESK-003 [P0]** Thumbnail rail, outline/bookmarks, page-number navigation, search within actual extractable text, fit-to-width/page, continuous/single-page modes, pan, keyboard shortcuts, zoom to at least 800%, and rotate-view independently of page mutation.
- **DESK-004 [P0]** Undo/redo for user edits; Save, Save As, export; unsaved-change indicator; deterministic handling when another process changes the original file. No silent overwrite.
- **DESK-005 [P0]** Parse and respect MediaBox, CropBox, page Rotate, page UserUnit, annotations and printable area. Render correct page orientation without altering the source until explicitly saved.
- **DESK-006 [P0]** Safe incremental/document saves, bounded recovery journal, atomic replacement after validation, backup on replace, crash restore. Preserve original bytes until the new output passes reopen/integrity checks.
- **DESK-007 [P1]** Persistent customizable toolbar, keyboard remapping, multi-monitor and mixed DPI support, light/dark theme, accessibility semantics and high-contrast mode.
- **DESK-008 [P1]** Password-protected PDFs: prompt for password; read/save permitted content according to user permissions, warn about permissions and signature invalidation. Never persist passwords in logs.
- **DESK-009 [P1]** Extract attachments, inspect metadata and document properties, repair damaged PDF only with explicit confirmation, detect unsupported XFA/3D/multimedia content.
- **DESK-010 [P2]** Advanced editing of existing page text, font substitution and paragraph reflow, object/path editing, image replacement, link editing, PDF/A workflows, accessibility tagging and remediation.

## 4. Print engine — defining capability

**Print UX:** File > Print opens a sheet-accurate preview, not a simple preview of the source PDF page. Selecting Print means the previewed arrangement, selected printer capabilities and validated print settings are the actual requested output. Show physical sheet count, expected paper stock, portrait/landscape transforms, duplex sequence, scaling percentage and any clip warning.

### Required algorithms and behavior

- **PRINT-001 [P0]** Determine the logical, visibly rotated page geometry using MediaBox/CropBox/Rotate/UserUnit; select a sheet-relative transform separately for every source page. Never rely only on a single job-level orientation toggle.
- **PRINT-002 [P0]** Correctly place portrait and landscape PDF pages in a single ordered output on **one fixed physical stock**, even if driver orientation is job-scoped. Rotate/scale page content in sheet coordinates when necessary. Avoid silently duplicating, clipping or skipping a page.
- **PRINT-003 [P0]** Fit, shrink oversized, actual size (100%), custom percentage, center, auto-center, page range, odd/even, reverse order, copies, collate, grayscale/color and resolution policies. No unintended enlargement by default.
- **PRINT-004 [P0]** Paper size detection from printer capabilities; Letter, Legal, Tabloid and supported architectural sizes. Explicitly distinguish *logical page size* from *loaded physical paper*. If actual size is not available, warn before printing; no silent downgrade of Arch D to Letter.
- **PRINT-005 [P0]** Printer driver printable bounds, hard margins, duplex, paper tray, and unsupported features must be queried and validated. Driver-advertised features are not proof of correct physical behavior; keep printer-specific regression tests.
- **PRINT-006 [P0]** Per-sheet print preview must show placement, rotation, safe/clip margins, physical stock, copy count, page number and front/back pairing. Preview must be generated from the same PrintPlan used for spooling, not a separate estimate.
- **PRINT-007 [P0]** Print-plan preflight: warn or block if clipped, missing stock, likely blank, incompatible duplex, unrecognized printer/driver or an unsupported mixed-media request. Preserve settings after cancel.
- **PRINT-008 [P0]** A document with alternating landscape and portrait pages prints correctly with no manual orientation change, without page order corruption, and with the expected number of sheets.
- **PRINT-009 [P0]** Capture printer-job submission result and preserve a diagnostic plan manifest locally on demand (with no document text). Never claim that the physical printer succeeded solely because the OS spooler accepted the job.
- **PRINT-010 [P1]** Save named per-printer presets, including duplex, tray, media, borderless/printable margins, sheet scaling and construction drawing policy. Presets store logical intent, then revalidate against current driver capabilities.
- **PRINT-011 [P1]** Mixed *physical paper stocks* in one document: use validated XPS per-page PrintTickets when supported. Otherwise offer clearly labeled contiguous print segments or a fixed-paper normalization plan. Never imply guaranteed one-job automatic tray switching where unavailable.
- **PRINT-012 [P1]** Duplex long-edge/short-edge with landscape transforms, blank insertions and page order parity. Ensure the reverse side is not upside down; warn if a hardware driver changes behavior.
- **PRINT-013 [P1]** N-up, booklet mode, poster tiling, comments-only vs document+comments vs document-only, markup summary sheets and optional custom stamp overlays.
- **PRINT-014 [P2]** Batch printing across multiple files, print queue, sheet-set profiles, saved office printer configuration package, color-managed proofing.
- **PRINT-015 [RISK]** Evaluate Windows XPS/PrintTicket, printer drivers, PDFium-derived print backends and tiled high-DPI raster fallback. Spooling fidelity and per-page ticket support require real hardware trials before the print backend is finalized.

### Printed output invariants

Source-page order and selected range are preserved. Page orientation is computed per logical page. Annotation visibility matches user option. Drawings retain scale when 100% is explicitly selected. For any output that changes scale, the dialog displays the percentage before printing. The program must not waste paper by dispatching ambiguous output: require an explicit acknowledgement for any unsupported print combination.

## 5. Native annotations and comments

- **ANN-001 [P0]** A first-class Callout tool: click arrow-tip target, position elbow/leader, draw text box, type immediately; move head, bend, rotate, resize box independently; edit later.
- **ANN-002 [P0]** Store callouts as standard PDF FreeText annotations with callout intent (IT=FreeTextCallout), CL callout geometry, native content/style and valid appearance stream. The PDF object remains editable in Adobe Acrobat and PDF-XChange, subject to documented interoperability tests. A flattened image alone does not pass.
- **ANN-003 [P0]** Callout properties: font/size/weight, fill, opacity, border, line weight/type, arrowhead types, elbow vs straight leader, justification, author, subject and stacking order.
- **ANN-004 [P0]** Sticky notes, highlight, underline, strikeout, squiggly, free text/typewriter, text boxes, lines/arrows, rectangles, ellipses, pen/freehand, eraser where semantically valid, stamps and revision clouds (clouds may land P1).
- **ANN-005 [P0]** Comments pane with filtering by page/author/type/status, jump-to-location, add and edit notes, delete/undo, sorting; never silently discard embedded comments.
- **ANN-006 [P0]** Preserve existing annotation dictionaries not understood by Axik; do not strip unknown properties during save. Create appearance streams so other PDF renderers do not show blank annotations.
- **ANN-007 [P1]** Replies/threading mapped to standard PDF in-reply-to/reply-type where possible, review status, author metadata, import/export of annotations as XFDF where supported.
- **ANN-008 [P1]** Annotation templates and favorites, rubber stamps, sequential numbering and batch flatten/export after confirmation.
- **ANN-009 [P1]** Construction markup layer: revision clouds, dimension lines, scale calibration, linear/area measurement, snap aids; never claim certified takeoff/measurement precision without calibration and validation.
- **ANN-010 [P2]** Multi-user asynchronous collaboration; avoid building server infrastructure for the initial local-first product.

## 6. Redaction — high-trust operation

- **REDACT-001 [P0]** Mark regions or exact text matches for redaction; selection is reversible *until Apply*.
- **REDACT-002 [P0]** Applying redaction must irrevocably remove affected content from the **output PDF**: visible drawing, underlying text/content streams, OCR layers, hidden objects, images inside affected areas, relevant appearances and leaked references. Simply drawing a black box is forbidden.
- **REDACT-003 [P0]** Strip/normalize sensitive metadata, orphaned objects, revision history/incremental saves, attachments, hidden layers and annotations that can disclose removed content under a documented, user-visible sanitization policy; do not claim all secrets erased by a region-only redaction.
- **REDACT-004 [P0]** Implement Save Redacted Copy by default, preserve original, warn about irreversible operation and possible loss of digital signatures. Independently reopen and audit sanitized output before reporting success.
- **REDACT-005 [P0]** A redaction engine with inadequate coverage is never presented as safe. If vector-preserving removal cannot be proven for a document, offer a clearly labeled image-only secure reconstruction pathway (with resolution/searchability/accessibility tradeoffs) or refuse the operation.
- **REDACT-006 [P0]** Zero successful extraction of planted secrets after apply across extraction tools, incremental history/object scans, attachments, OCR layers and visual rendering tests in the supplied adversarial corpus. Any leak fails release.
- **REDACT-007 [P1]** Pattern-driven redaction suggestions for email, account numbers etc., review-before-apply, audit report without reproducing secret text.
- **REDACT-008 [RISK]** Vet a commercial-compatible redaction backend and licensing. QPDF alone is not a redaction solution; rendering a black rectangle is not a redaction solution.

## 7. Visual signatures, forms and document operations

- **SIGN-001 [P0]** Draw signature with pointer/stylus, type script-like signature (explicitly visual), import transparent image, position/scale/rotate, reuse locally by opt-in, add date/name text.
- **SIGN-002 [P0]** Label this as **visible/non-cryptographic signature**. Do not claim identity verification, certificate validation, tamper-proof signing or legal e-signature workflow guarantees.
- **SIGN-003 [P1]** Fill AcroForm fields, checkbox, radio, dropdown and multiline inputs; save filled values and associated appearances in standards-compatible form; warn before flattening.
- **SIGN-004 [P1]** Signature/stamp presets stored in user-local protected state; optional password protection for saved signature assets.
- **SIGN-005 [P2]** PKI certificate digital signing and validation, timestamp authorities, enterprise signature workflows are separate future products/epics.

- **DOC-001 [P0]** Insert/delete/extract/reorder/rotate pages, merge/split PDF files, crop and page labels; preview before destructive operations.
- **DOC-002 [P0]** Maintain bookmarks/outlines, links, annotations, rotation, boxes and inherited page resources where semantically correct through operations.
- **DOC-003 [P1]** Add editable new text boxes, images, watermarks, page numbers, headers/footers, hyperlinks and stamps.
- **DOC-004 [P1]** OCR for searchable scans with explicit quality/language limits and offline operation; no mandatory cloud OCR.
- **DOC-005 [P1]** Batch rename/merge/split/rotate; compare two PDFs visually and by text with diffs.
- **DOC-006 [P2]** Replace and reflow existing text, object-level editing, advanced forms, PDF/A export, professional prepress features. Do not include these in first-release promises until independently proven.

## 8. GPU, responsiveness and accessibility

- **DESK-PERF-001 [P0]** Launch a usable shell before importing the heavy render/edit subsystems. Background workers isolate parsing, thumbnails, OCR, image decoding, search and saves.
- **DESK-PERF-002 [P0]** Hardware acceleration for page compositing, zoom/pan/selection/annotation overlays when GPU available. Prefer GPU texture reuse and virtualization; CPU fallback must remain feature-correct, safe and usable.
- **DESK-PERF-003 [P0]** Avoid rendering unseen pages at full resolution. Use visible-page prioritization, tiles, scaled preview and bounded caches, with cancellation of stale work.
- **DESK-PERF-004 [P0]** GPU device-lost/driver-reset handling and software fallback without document corruption.
- **DESK-PERF-005 [P0]** Instrument parsing, rasterization, GPU compositing and I/O separately. A GPU-composited window alone is **not** evidence that PDF rendering is GPU accelerated.
- **DESK-PERF-006 [P0]** Support high-DPI and varied GPUs including integrated Intel/AMD and discrete NVIDIA/AMD without hardware-specific code paths being required to open a file.
- **DESK-PERF-007 [P1]** Keyboard-first tools, touch/stylus, screen-reader tool names, focus management, shortcut reference and accessible error messages.
- **DESK-PERF-008 [P1]** Preserve normal PC and gaming resources when app closed. No permanently running GPU compute service, hidden LLM or required background daemon.

Proposed quantitative SLOs and reproducible hardware profiles are in the quality specification; all numbers remain targets until baseline benchmarking.

## 9. Protection against data loss and malicious PDFs

- Parse untrusted PDFs in a lower-privilege, isolated worker/process wherever the platform allows; enforce document/page/image/decompression resource budgets.
- Prevent PDF JavaScript, launch actions, embedded executables and unsafe external links from executing automatically; external URL actions require explicit confirmation.
- Never require cloud upload to open, print, edit, redact, sign or save a PDF. Telemetry is opt-in, disabled by default and excludes content.
- Transactional saves to a temp file on the same volume, validate, flush/sync, atomically replace when supported, create recoverable backups with retention policy.
- On save failure, preserve source and document state and show actionable error. On crash, recover without replaying a partially committed unsafe redaction.
- Treat printing as external I/O: no duplicate queue submission during retry, and no false "printed successfully" from spooler acceptance.
- Maintain a compatibility and security update policy for WebView2 runtime, PDF parser and native libraries.

## 10. Desktop exit criteria

The first usable desktop release cannot be signed off unless: (1) the complete alternating-orientation printer corpus produces correct physical prints on reference printers; (2) callouts and comments survive Acrobat and PDF-XChange round trips; (3) visual signatures remain correctly positioned; (4) redaction independently passes zero-leak tests; (5) no data loss across save-failure/crash/restart tests; (6) GPU usage and latency have been measured against explicit budgets, with CPU fallback; (7) offline install/open/save/print work without Weave, account or network.

References: Adobe PDF Reference 1.6 free-text callouts (CL and IT) https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.6.pdf ; Windows PrintTicket capability validation https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/how-to-validate-and-merge-printtickets ; PDF-XChange Callout Tool https://help.pdf-xchange.com/pdfxt10/callout-tool_ed.html .
