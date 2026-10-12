# Axik PDF Editor — Product Requirements & Scope

**Document ID:** AXP-PRD-001  
**Version:** 0.1 (draft for review)  
**Date:** 2026-10-12  
**Repository:** https://github.com/limadeltatango/axik_pdf_editor  
**Products:** (A) standalone Windows desktop PDF editor; (B) Chrome/Edge/Chromium MV3 browser extension  
**Owner of development repository:** PDF Editor project only. Axik AI Weave is not an application dependency.

## 1. Purpose and motivating failure

Create a responsive, stable, locally executing PDF editor that rivals Acrobat for everyday work, with especially reliable mixed-orientation printing. The current PDF-XChange Editor setup still mishandles mixed portrait/landscape printing after Fit to Printer Margins, Auto-Rotate, and paper-size-related configuration were tested. A correct product must not make users manually select orientation page after page or discover a problem only after paper is wasted.

This product is intentionally general-purpose, with optional construction-document workflows later. It is not a BuildAxis module. Development orchestration may be introduced in the future **only on explicit subsequent approval**; no task in this planning scope uses Axik AI Weave, agents, runners, LLMs or CI execution.

## 2. Principles and non-negotiable requirements

1. **Fast to open, fluid to use.** Startup, first useful page, zooming, scrolling, thumbnails, search, save and print preview have independent measurable latency gates.
2. **GPU-aware by design.** Use accelerated page compositing and overlay rendering where reliable; benchmark actual rendering and transfers separately. The system must work correctly on integrated graphics or when hardware acceleration is disabled.
3. **Exceptionally stable.** Malformed PDFs, GPU resets, unavailable fonts, memory pressure, extension restarts and print-driver bugs must be contained and must not corrupt user files or lose edits.
4. **Intelligent printing.** Fixed-stock mixed portrait/landscape output must be correct by default without page-by-page user configuration. Printer-dependent mixed-stock printing must never be presented as guaranteed if it is not.
5. **PDF compatibility.** Standard annotations, including real FreeTextCallout and comment metadata, should open and remain editable in Acrobat/PDF-XChange. No secret proprietary document format required to exchange work.
6. **Genuine redaction.** Redaction is removing content, never painting over it. Do not advertise "redact" until the backend passes adversarial leak tests.
7. **Local-first and offline.** No mandatory account, cloud service, subscription, analytics, remote OCR or AI to use core desktop and browser editing.
8. **Low idle resource footprint.** No resident render service or idle GPU reservation after closing the app. Native companion starts on demand.
9. **Honest capability labels.** Browser-only printing, non-certified visual signatures, OCR uncertainty, advanced text editing and browser-only redaction have distinct scopes and warnings.
10. **Separate products, shared components.** Desktop and browser extension get their own delivery, security and acceptance criteria; reuse common types/commands/editor UI where feasible.

## 3. User workflows

- **WF-01:** Open an architectural PDF set (portrait cover, landscape plans, portrait schedules); select the office printer; preview physical sheets and print correctly with one action.
- **WF-02:** Open a submittal PDF; insert an arrow-and-text callout, place highlights, write threaded review comments, save and send to a colleague using Acrobat.
- **WF-03:** Remove private information from a document, verify its absence and save a separately named safely redacted PDF.
- **WF-04:** Add a handwritten-looking signature and date to a form or approval, without a certificate workflow.
- **WF-05:** Open a PDF from the browser using the extension; annotate and export without needing Adobe or a desktop install.
- **WF-06:** From a Chrome/Edge PDF tab, choose **Print with Axik Desktop**, review validated print layout and send it through the native print engine if installed.
- **WF-07:** Recover unfinished annotations after a crash or browser restart without losing the source or overwriting it unexpectedly.
- **WF-08:** Merge, split, reorder, extract and rotate pages with thumbnails; retain bookmarks and annotations where meaningful.

## 4. Product boundary and feature matrix

Legend: **Must** = first usable release; **Later** = committed future target; **Companion** = only available in browser through optional desktop integration; **Research** = feasibility decision before promise.

| Capability | Desktop | Extension alone | Extension + companion |
|---|---|---|---|
| Open/search/view/download | Must | Must | Must |
| GPU-backed display, bounded memory, CPU fallback | Must | Must | Must |
| Page-aware mixed-orientation printing on fixed stock | Must | Browser dialog only | Must via desktop |
| Printer profiles, hardware stock/duplex inspection | Later | Not exposed | Later via desktop |
| Standard FreeTextCallout annotation | Must | Must | Must |
| Other markup, notes/comments | Must | Must | Must |
| Visual, non-cryptographic signature | Must | Must | Must |
| Genuine permanent redaction | Must, verified | Research; no false promise | Must via desktop |
| Merge/split/reorder/rotate pages | Must | Later/bounded | Must via desktop |
| AcroForm filling | Later | Later | Later |
| Add new text/images/watermarks | Later | Later | Later |
| OCR offline | Later | Later or companion | Later via desktop |
| Edit/reflow existing text | Later | Not first release | Later via desktop |
| Document compare/measurement/revision clouds | Later | Later | Later |
| Certificates/digital signing | Later independent epic | Not first release | Later independent epic |

**Milestone interpretation:** The initial release is a focused replacement for daily work, not an assertion of complete Adobe feature parity. The desktop must deliver the stated Must set as one coherent usable product; native-only redaction remains gated on verification. Browser extension can ship separately once its Must set passes.

## 5. Platform support

- Desktop Windows 11 x64 is the primary qualification platform. Windows 10 x64 is a specific compatibility target due to existing environment requirements, conditioned on a supportable WebView2/native dependency baseline; its security support lifecycle must be documented before distributing binaries.
- Windows ARM64 is a future evaluation, not automatically supported.
- Chrome and Edge current stable on supported Windows versions are first extension qualification browsers. Brave and other Chromium derivatives are secondary test targets. MV3 platform quirks and host IDs may differ.
- No Mac/Linux desktop requirement in v0.1; shared UI/architecture should avoid unnecessary lock-in beyond the intentionally Windows-native printing layer.
- No mobile browser-extension or cloud editor requirement.

## 6. Release philosophy

All source is isolated in this repository. Version, benchmark datasets and release test results are recorded with every release. A release is blocked by orientation errors, redaction leaks, data loss, crashes in normal editing, annotation interoperability regressions or unsupported features represented as working. Third-party dependency licenses, redistributable binaries and signed installer obligations are reviewed before public distribution.

## 7. Outside first release

Collaborative cloud commenting, SaaS storage, electronic-signature identity-verification workflows, automated AI reading/editing, enterprise DLP management, full text layout reflow, all PDF/A archival variants, CAD-grade takeoff and a replacement for every Adobe prepress function. Plan for these only when their dependencies do not compromise fast startup or everyday core reliability.

## 8. Related specifications

- [Desktop functional specification](DESKTOP_SPEC.md)
- [Chromium extension functional specification](CHROMIUM_EXTENSION_SPEC.md)
- [Shared architecture, GPU and print design](SHARED_ARCHITECTURE.md)
- [Reliability, security and acceptance tests](QUALITY_AND_TESTS.md)
- [Delivery phases and unresolved decisions](ROADMAP_AND_DECISIONS.md)

## 9. Acceptance of this PRD

This is a **draft specification**, not an approved implementation contract. Signoff is required on product boundary, desktop/native print strategy, extension-only vs companion guarantees, licensing and measurable hardware baseline after technical research spikes. No application code or Weave task should be started as a side effect of approving these documents.
