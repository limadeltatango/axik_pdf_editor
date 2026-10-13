# Axik PDF Editor — Development Roadmap, Decision Register and Research Plan

**Document ID:** AXP-PLAN-001  
**Version:** 0.1 (proposed)  
**Date:** 2026-10-12  
**Execution state:** Specification only. No implementation work, code generation, Weave invocation, runner execution or CI configuration is authorized by this document.

## 1. Governing rule

Prove the riskiest assumptions early, especially the exact things users are unhappy about: **mixed-orientation physical printing**, fast first-page display and GPU compositing, PDF-native callout compatibility, secure redaction and extension-only annotation export.

Avoid an enormous UI rewrite or development fabric integration until we can demonstrate the core with small reproducible proofs. This is a product repo, not a Weave/BuildAxis/OpenStorage component.

No calendar promises are implied. Work stages are ordered by risk and dependencies; schedule and staffing can be decided separately.

## 2. Phase 0 — Specification, feasibility and measured architecture selection

**Deliverables**
- Ratified product requirements, desktop and extension boundaries and scoped first release.
- Print corpus, simulated PrintPlan reference vectors and two real printer/driver qualification profiles.
- GPU/renderer benchmark comparing PDF.js, PDFium as desktop auxiliary, browser composition and possible native accelerated renderer; CPU fallback cost identified.
- First successful native FreeTextCallout with generated appearance stream and independently editable export to PDF-XChange (and displayed in Acrobat Reader), using a license-compatible writer.
- Browser-only callout save/export proof-of-concept on MV3 (Chrome/Edge).
- Redaction backend security and licensing decision with no unverified "redact" claim.
- Runtime and installer support decision for Windows 10 x64, Windows 11 x64 and WebView2.
- Browser URL/file access MVP path and permission/security model, plus automatic navigation takeover feasibility determination.
- Dependency SBOM and license inventory; no decision to open-source or commercially license product code without explicit owner choice.

**Exit:** Recorded ADR outcomes and reference benchmark results. No "GPU accelerated" launch claim until measured. No "correct mixed orientation" claim until real printer tests.

## 3. Phase 1 — Thin vertical slice and performance foundation

- Establish monorepo package boundaries: shared types/commands/UI, desktop shell, browser-extension shell, native worker and test-fixture tooling.
- Implement PDF open/view/search for a small representative corpus and common keyboard/tool navigation.
- Add progressive first page, visible-page tiling/virtualization, GPU texture compositing, bounded caching and cancellation.
- Implement crash-safe edit journal skeleton, file save transaction, isolate parser/renderer failure and collect CPU/GPU latency traces.
- Make both viewers work offline without companion requirement.
- Decide desktop shell vs native UI based on measured benchmark instead of aesthetics.
- Add no Weave-specific code, runners or services.

**Exit:** Cold and warm latency budgets approached/met on reference hardware; no UI block or data loss in renderer kill test; browser opens offline.

## 4. Phase 2 — Intelligent desktop printing (first major acceptance gate)

- Build a pure deterministic PrintPlan engine independent from Windows printer API.
- Correctly map page boxes/rotation to physical sheet transforms per source page, respecting 100%-scale and fit policies.
- Show precise per-sheet preview with hard margins, physical stock, duplex front/back, scale and clipping warnings.
- Implement and qualify Windows spool backend with real printers and XPS/PrintTicket capability handling. Normalize orientation on fixed paper without per-page driver orientation dependence.
- Explicit mixed-media strategy: validated page-scoped stock switching or contiguous segment print prompts; never silent guessed tray switching.
- Record cancellation, queue submission and spool status without promising physical completion.
- Add 15-case print suite and physically verify alternating portrait/landscape, duplex and construction paper sizes.

**Exit:** Physical reference prints correct and repeatable; unsupported stock/duplex cases preflight and warn.

## 5. Phase 3 — Standard editing and native annotation interoperability

- Shared annotations: callout, markup, sticky notes, freehand, shapes, notes, comments pane and keyboard commands.
- Author Acrobat/PDF-XChange-interoperable standard FreeTextCallout including CL/IT/appearance streams; cross-editor roundtrip suite.
- Implement saving browser-only edited PDFs with safe download/export and desktop atomic Save As.
- Add visual signing and annotation templates.
- Add page manipulations (merge/split/rotate/reorder/extract) with resource-reference preservation.
- Implement form filling if milestone scope allows; otherwise preserve forms unchanged.
- Maintain exact source/modified-file recovery rules and test third-party files.

**Exit:** Both apps can create/edit/export callouts and standard markup correctly; no unsupported page/annotation corruption.

## 6. Phase 4 — Chromium extension release track

Extension milestones may overlap desktop work after shared geometry/model/writer contracts stabilize.

- MV3 packaging with bundled resources and optional host permissions; context-menu/manual file acquisition that works without automatic network interception.
- Full tab view, callout tools, comments, visual signature, undo/redo, journal/recovery and local export.
- Test Chrome and Edge versions, user-granted file:// path option, cross-origin/authenticated PDF fallback and service-worker lifecycle.
- Implement independent offline browser-only usage and accurate native-feature capability labels.
- Optional native messaging companion protocol with version negotiation, bounded file transfer, permission prompts and fallbacks.
- Connect **Print with Axik Desktop** to the same validated desktop PrintPlan; no invented extension-only Windows printer privilege.
- Audit extension security, Chrome Web Store/Edge Add-ons policies and installer origin ID lists.

**Exit:** Extension works without desktop for common editing and export; host failure does not impact it; companion printing is explicitly controlled and validated.

## 7. Phase 5 — Destructive security capabilities and first focused releases

- Ship secure desktop redaction only after independent zero-leak suite; safely default to a separate redacted-copy output.
- Use an appropriately licensed backend or reconstructed/verified output; forbid cosmetic redaction.
- Publish honest signing distinction (visible signature, not PKI certificate signature).
- Run long soak tests, printer hardware requalification, GPU device-loss tests, Windows version and Chromium compatibility.
- Sign and package Windows installer and extension releases with documented rollback and uninstall safety.
- First focused desktop release must meet **all** designated P0 quality gates; if redaction readiness lags, product stays pre-release rather than falsely advertising it.

**Exit:** Approved quality gate checklist, documented limitations and support boundaries.

## 8. Phase 6 — Full editor and advanced construction workflows

Later work, only after core reliability:

- AcroForm editing, OCR/searchable scans, addition/replacement of text/images, stamps and watermarks.
- Sophisticated text reflow and object editing; compare/overlay PDFs; XFDF; print batch/presets and full page manipulation.
- Calibrated scale measurement, revision clouds, drawing set management, batch stamping, drawing overlays, page labels and submittal review tools.
- Optional certificate-based digital signatures, PDF/A, richer accessibility, metadata sanitization profiles and additional platforms.
- Other integrations must be explicit opt-in, not installed dependencies.

## 9. Decision register (draft)

| ID | Decision to settle | Candidate path / position | Evidence necessary |
|---|---|---|---|
| ADR-001 | Desktop application UI/shell | Tauri 2 + WebView2 baseline; benchmark fully native alternative if necessary | Startup, memory, UI latency, Windows 10/11 compatibility |
| ADR-002 | Shared PDF rendering | PDF.js primary; PDFium native worker if measured advantage | Cold/warm render, vector accuracy, memory/VRAM, security |
| ADR-003 | GPU layer | GPU texture composite with Direct2D/WebGL/WebGPU as justified | Actual GPU traces and speedups vs software; reset fallback |
| ADR-004 | PDF writing/annotation | Shared annotation model; native qpdf/PDFium adapters; browser-specific writer to select | Appearance streams, Acrobat/PDF-XChange editability, license |
| ADR-005 | Windows printing | Pure PrintPlan + Windows spool path; fixed-media content rotation default | Physical P/L, duplex, XPS/driver matrix |
| ADR-006 | Mixed actual paper stocks | Per-page media tickets only when validated; otherwise segments/manual approval | Real stock/tray switching tests |
| ADR-007 | Redaction engine | Security-vetted content removal; reconstructed image fallback | Zero-leak adversarial corpus, legal redistribution |
| ADR-008 | MV3 PDF interception | Explicit open actions default; opt-in DNR redirect only after testing | Chrome/Edge and secure URL/cross-origin matrix |
| ADR-009 | Companion protocol | Optional nativeMessaging typed messages, bounded streaming | Security threat model and large-file test |
| ADR-010 | Windows 10 lifecycle | Conditional tested support | Secure dependencies, WebView2 runtime and maintenance policy |
| ADR-011 | Repo/code license | Not selected | Owner's preferred distribution model, dependency obligations |
| ADR-012 | Release partition | Desktop P0 independent; browser P0 independent plus optional host | Both separate acceptance suites and extension-only data safety |

**All ADRs are currently PROPOSED/UNDECIDED.** A specification commit is not evidence of an implemented option.

## 10. Potential later GitHub issue hierarchy

After owner review, convert approved work into separately scoped issues under this repository, not WEAV or MOSV:

- Core architecture and performance / GPU proof
- Physical print engine and mixed-orientation acceptance
- Shared PDF annotation and native callout serialization
- Browser extension MV3 standalone viewer/editor
- Native companion host and secure document transfer
- Genuine redaction/security audit
- Visual signature, page operations, forms and OCR
- Installer, update, crash-recovery and long-haul quality

Don't launch Actions or invoke Weave as part of issue or document creation. CI runners, AI code review and Weave orchestration will be decided only if explicitly approved later.

## 11. Research and platform authority references

- PDF.js baseline: https://mozilla.github.io/pdf.js/ and https://github.com/mozilla/pdf.js
- PDFium native API and license: https://pdfium.googlesource.com/pdfium/ and https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE
- qpdf (low-level structure only): https://github.com/qpdf/qpdf
- Adobe standard PDF FreeTextCallout field definitions: https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.6.pdf
- Windows PrintTicket/PrintCapabilities: https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/how-to-validate-and-merge-printtickets
- Direct2D hardware acceleration and software path: https://learn.microsoft.com/en-us/windows/win32/direct2d/direct2d-portal
- WebView2 printing controls and limits: https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/print
- Chrome MV3 permissions and file scheme: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- MV3 DNR (not equivalent to old blocking webRequest): https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
- MV3 worker lifetime: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome extension printing only on ChromeOS: https://developer.chrome.com/docs/extensions/reference/api/printing
- Chrome native messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Edge native messaging: https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging
- Chrome extension CSP: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy

## 12. What was explicitly not done

No Axik AI Weave run, local model inference, Codex job, GitHub Actions setup/run, AI reviewer, source implementation, build, installer creation, external application deployment or printer test is authorized by producing this specification. These are next-stage activities only after the owner approves scope and an execution path.

## Save and revision workflow sequencing (2026-10-13)

The owner manually confirmed that the Windows alpha could export a marked-up PDF and reopen the edited copy with the callout intact. Quick Export should remain immediate and never overwrite its input.

The next three general-purpose editor priorities are:
1. **APDF-45:** separate **Save** (deliberate overwrite with recoverable backup, conflict detection, written-output validation), **Save As** (new chosen path), and **Quick Export** (new copy without switching the active file);
2. **APDF-18/19/20:** actual Windows mixed-orientation printing, real printer capability negotiation and physical acceptance;
3. **APDF-46/47:** adding new native PDF text and eventually modifying existing page text with real content-stream/font fidelity. A cosmetic cover-up is not true text replacement.

**APDF-44 — Revision Manager** is documented separately in [REVISION_MANAGER.md](REVISION_MANAGER.md), with immutable baseline PDF versions, proposed changes, review packages, recorded decisions and approved-only incorporation. It must not take precedence over Save/Overwrite, printing or text editing. An approved PDF revision does **not** modify CAD/BIM design source files by itself.
