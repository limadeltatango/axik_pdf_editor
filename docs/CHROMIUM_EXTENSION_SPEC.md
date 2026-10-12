# Axik PDF Editor — Chromium Browser Extension Specification

**Document ID:** AXP-EXT-001  
**Version:** 0.1 (proposed)  
**Date:** 2026-10-12  
**Manifest:** Chromium Manifest V3 (MV3) only; no reliance on deprecated MV2 webRequestBlocking.  
**Targets:** Current stable Google Chrome and Microsoft Edge on Windows first; Brave/Chromium/Vivaldi compatibility to be tested, not assumed.  
**Scope:** Browser-native editing experience plus optional secure desktop handoff. The extension must be useful without the desktop installation and must disclose native-only functions.

## 1. Product intent and independent operating modes

- **Extension-only mode:** Open a PDF with explicit user intent; view, search, navigate, create/edit standard markup and free-text callouts, comment, add a visual signature, save/export a PDF, and use normal browser printing. Operates offline on user-selected local files without creating an account.
- **Companion mode:** If a compatible Axik PDF Desktop installation is present, optional native messaging connects to advanced printing, high-confidence redaction, bulky page operations, and other local native features. Companion installation is never mandatory for basic use.
- **Degraded mode:** If native host is absent, unsupported, fails, or is out of version, the extension remains functional, indicates the unavailable action, offers normal download/export and never silently sends data to a network service.

The browser should not need Weave, a local LLM, any development runners, or an Axik background server. No cloud upload is necessary for core operations.

## 2. Installation, permissions and PDF acquisition

- **EXT-001 [P0]** Package signed MV3 builds with bundled JS/worker/WASM; no remotely hosted executable JavaScript or eval-based code. Use restrictive extension CSP, explicit permitted WebAssembly when needed.
- **EXT-002 [P0]** Toolbar action: **Open in Axik PDF** starts a dedicated full-size extension tab. Provide a local-file picker/drop zone independent of file:// permissions.
- **EXT-003 [P0]** For a normal browser PDF link, offer a context-menu or action-driven **Open PDF with Axik**. If host permission, authentication context, CORS, response type or browser restriction prevents fetching the document, explain and offer Download/Choose File/Open in Desktop. Never bypass site access control.
- **EXT-004 [P0]** Handle local file:// documents through an explicit file picker. Optional file URL integration must prompt the user to enable Chrome's "Allow access to file URLs"; do not require it for ordinary file uploads.
- **EXT-005 [P0]** Report limits for browser-embedded, blob:, data:, cross-origin iframe, authenticated/intranet URLs and protected document viewers. No promise that every site's in-page viewer is controllable.
- **EXT-006 [P1 / RISK]** Investigate user-opt-in PDF navigation takeover using supported MV3 declarativeNetRequest rules after a browser-version matrix spike. If unreliable or over-broad, default to explicit open actions; do not hijack websites or rewrite unrelated downloads.
- **EXT-007 [P0]** Request only necessary permissions up front; use optional host access for explicit-site access and optional nativeMessaging for companion. No universal <all_urls> grant by default. Show what each permission enables.
- **EXT-008 [P0]** On browser update, extension reload or service-worker termination, restore document edit state from a bounded, local persisted change journal with user-visible recovery choice; do not assume service-worker globals persist.
- **EXT-009 [P1]** Support browser PDF "Open With" affordances where browser policy allows, PDF links in email/download pages after explicit user action, and a configurable right-click menu.
- **EXT-010 [P2]** Firefox is out of scope for the Chromium first release; no unsupported promise of identical APIs.

## 3. Viewer experience and performance

- **EXT-VIEW-001 [P0]** Shared design language and shortcuts with desktop; full-tab document editor, thumbnail and outline panels, search, page navigation, continuous/single view, zoom, fit controls, rotate-view.
- **EXT-VIEW-002 [P0]** Progressive first-page display, on-demand rendering and tile/page virtualization. Dedicated workers for parsing; avoid blocking main browser UI and unrelated tabs.
- **EXT-VIEW-003 [P0]** GPU-backed compositing/pan/zoom/annotation overlay when available; actual acceleration paths and per-stage timings are measured. Browser GPU disable, blacklists, device loss and software fallback must remain correct and responsive.
- **EXT-VIEW-004 [P0]** Zero full-document eager rasterization; bounded per-tab caches, unload hidden pages, prioritize visible pages, cancel obsolete rendering tasks.
- **EXT-VIEW-005 [P0]** Document must remain editable without internet access once loaded; no remote dependency, analytics, remote font request or font CDN at render time.
- **EXT-VIEW-006 [P0]** Correct placement and appearance for MediaBox, CropBox, Rotate, UserUnit, page transparency, forms and annotation appearances.
- **EXT-VIEW-007 [P1]** Multiple open PDF tabs, autosaved per-tab changes, document comparison (read-only baseline), optionally side-panel comments. No background polling when all Axik tabs closed.
- **EXT-VIEW-008 [P1]** Support high-contrast interface, keyboard navigation, screen-reader labels and reduced-motion preference.

## 4. Annotation and editing model

- **EXT-ANN-001 [P0]** All shared editing actions use the same typed commands and coordinate normalization as the desktop application; annotation content and geometry serialize to standards-compatible PDF, never a proprietary-only exported artifact.
- **EXT-ANN-002 [P0]** Full free-text callouts: draw arrow target, leader/elbow and label box; edit, style, rotate, move and resize. Save as FreeText/FreeTextCallout with CL geometry and an appearance stream that Acrobat and PDF-XChange can display and edit.
- **EXT-ANN-003 [P0]** Highlight, underline, strikeout, free text, text notes, rectangles, circles, arrows, lines, freehand ink and simple stamps.
- **EXT-ANN-004 [P0]** Comments pane; add/edit/reply where supported; preserve imported metadata including author, dates and unknown fields. Basic replies should round-trip if supported by serialization prototype; if not, clearly restrict until parity established.
- **EXT-ANN-005 [P0]** Undo/redo, selection/multi-select, keyboard delete, clipboard text, zoom-invariant hit-testing, stable placement after rotated pages or resizing.
- **EXT-ANN-006 [P0]** Local unsaved-change journal; explicit **Download Edited PDF** and Save As. Only overwrite a source file when browser APIs and an explicit durable user-granted file handle allow it; otherwise create a downloaded copy.
- **EXT-ANN-007 [P0 / RISK]** Prove standards-compliant browser-only PDF annotation save/round-trip using a permissively licensed writer or packaged WASM backend; PDF.js rendering by itself is insufficient proof of comprehensive PDF write capability.
- **EXT-ANN-008 [P1]** Annotation templates, drawing measurements, revision clouds, XFDF import/export where correctly supported.
- **EXT-ANN-009 [P1]** Page reorder/rotate/split/merge under bounded document sizes. Large or complex files can be handed off to the companion if available; always disclose the boundary.
- **EXT-ANN-010 [P2]** Existing text reflow, advanced form design and deep content stream editing are not extension-only first release obligations.

## 5. Signatures, forms and redaction

- **EXT-SIGN-001 [P0]** Draw/type/import a visible signature, position accurately, save as ordinary visible content or standard stamp-like annotation, export reliably. Explicitly state this is not PKI-certified signing.
- **EXT-SIGN-002 [P1]** Forms: fill common AcroForm widgets and save validated appearances. Warn on unsupported XFA and digital-signature widgets.
- **EXT-REDACT-001 [P0]** User can mark areas for future redaction, but **must not be offered "Apply secure redaction"** unless a proven native or packaged verified backend is present.
- **EXT-REDACT-002 [P0]** When desktop companion is installed, **Apply secure redaction in Desktop** performs the same verified-redaction pipeline as the desktop application, with explicit handoff and review; never quietly convert markup rectangles to black redaction overlays.
- **EXT-REDACT-003 [P1 / RISK]** Investigate independently safe browser-only redaction, potentially isolated WASM with full-file reconstruction, signed-off security test corpus and explicit loss-of-content limitations. If not proven, retain companion requirement.
- **EXT-REDACT-004 [P0]** A visible black box is a shape annotation, never labeled redaction. Do not let users mistake a temporary mark for an irreversible sanitization.

## 6. Printing and capability disclosure

- **EXT-PRINT-001 [P0]** Browser-only printing uses the platform browser print dialog; show that mixed orientation and printer-driver controls are managed by the browser, and **do not promise** the desktop intelligent printing guarantee.
- **EXT-PRINT-002 [P0]** If desktop companion is available, one-click **Print with Axik Desktop** securely transfers/references the PDF and opens the sheet-accurate PrintPlan preview. Native printing must use the same plan and tests specified in docs/DESKTOP_SPEC.md.
- **EXT-PRINT-003 [P0]** Preserve annotations for print and distinguish printing the saved PDF vs current unsaved edited state; warn before using an old file.
- **EXT-PRINT-004 [P1]** Offer preview/export of a normalized printable PDF from the editor (not necessarily advanced native hardware control); no claim that browser-side PDF output guarantees arbitrary printer stock or duplex behavior.
- **EXT-PRINT-005 [P1]** If PDF was acquired via URL, never issue an automatic silent print action or server-side operation.

## 7. Native companion bridge (optional)

- **EXT-BRIDGE-001 [P0]** Use Chromium nativeMessaging with installer-registered Win32 host, restricted exact extension IDs and user-consented operations. Chrome and Edge marketplace IDs can differ and must be provisioned individually. Separate native bridge process from UI app.
- **EXT-BRIDGE-002 [P0]** Versioned handshake: protocol version, app version, capabilities, printer capabilities only on demand and per-request errors. Unsupported/older versions gracefully disable only affected actions.
- **EXT-BRIDGE-003 [P0]** All messages must be length-bounded and schema-validated. Browser-native messaging host responses have a documented approx. 1-MB message limit; never use a single huge base64 JSON message for a document. Use bounded chunks with backpressure/CRC or SHA-256 plus explicit transfer/session IDs, or a user-approved locally staged file handoff.
- **EXT-BRIDGE-004 [P0]** Restrict read/write privileges: native host cannot accept arbitrary path read/write commands from extension content or webpages; require explicit user-granted document transfers, reject traversal, origin spoofing and unsolicited printing.
- **EXT-BRIDGE-005 [P0]** Handoff must preserve unsaved annotations, page orientation, filename intent and document checksum; detect version mismatch and content changes; preview before native output.
- **EXT-BRIDGE-006 [P0]** Both apps remain fully functional if the other crashes or is upgraded, and the bridge closes cleanly. No mandatory resident daemon or idle GPU process.
- **EXT-BRIDGE-007 [P1]** Support large files via bounded streaming/staging instead of copying entire document through extension worker memory. Resume/retry guarded against duplicate saves and prints.
- **EXT-BRIDGE-008 [P1]** Granular user approval for each privileged action (print, overwrite, export redacted, access local directory); no "always trust all websites" mode.

## 8. Security, privacy and maintainability

- The MV3 service worker is transient. Document tab owns editing UI; persisted journal owns recovery; worker handles short browser API operations only. No state critical to saving lives only in a worker global.
- Reject active PDF JavaScript/Launch actions and dangerous external links; treat PDF metadata, comments, file names and URIs as untrusted. Escape annotations; sanitize HTML and rich text.
- Downloads must not retain cookies or arbitrary auth tokens in logs. No exfiltration of PDF bytes to a cloud API. Avoid persistent local storage of whole private documents unless the user enables recovery/retention with explicit rules.
- No remote JS, dynamic eval or injection into arbitrary pages. Bundle and pin parsers. Adhere to MV3 CSP and Web Store policy.
- Native messages are strictly typed, request-ID correlated and replay-resistant where applicable. Documents received from websites remain untrusted after handoff.
- Browser storage may not provide strong encryption-at-rest guarantees; do not claim encrypted private vault without an audited storage design.
- Never inject into special browser pages, banking sites, locked viewers or mail webapps to extract inaccessible content. User-initiated file selection/download is the baseline.
- Performance, stability, security, memory and compatibility tests from docs/QUALITY_AND_TESTS.md apply to every supported browser release.

## 9. Browser-specific acceptance scenarios

1. Open a selected local PDF while offline; annotate it and download a standards-compatible result.
2. Create a 2-point/3-point leader callout, save, reopen in Chrome/Edge, Acrobat and PDF-XChange, then edit the leader/text in a compatible native editor.
3. Open a permitted HTTPS PDF URL by explicit action. Refuse an inaccessible authenticated embed cleanly and offer the correct manual fallback without losing browser context.
4. Browser updates or terminates the MV3 worker mid-session; recovered annotation state survives.
5. Toggle hardware acceleration off and back on; no data loss or invisible annotations.
6. Use plain browser print with an honest capability label; native companion route opens the validated intelligent print preview.
7. Uninstall native desktop host while extension is open; common annotation/export features still work; no crashing or repeated intrusive popups.
8. Attempt insecure black-box "redaction" without a verified backend; action is refused or labeled only as a visual overlay.
9. Test Chrome and Edge current stable; Brave/Chromium/Vivaldi against an explicit per-version compatibility matrix before labeling supported.
10. Open a user-selected 100+ page document and scroll while unrelated browser tabs remain responsive.

## 10. Browser exit gates

Release cannot ship unless extension-only marking/callout export works, no unauthorized site/data access occurs, MV3 service-worker interruptions are survivable, GPU/fallback pathways are benchmarked, source documents are not overwritten silently and unsupported native features are prominently differentiated. Store publication and native companion acceptance are separate checkpoints.

### References

- Chrome MV3 declarativeNetRequest and its constraints: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
- Chrome extension service-worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome file-scheme permission: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- Chrome extension CSP and packaged WebAssembly: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
- ChromeOS-only printing extension API: https://developer.chrome.com/docs/extensions/reference/api/printing
- Chrome native messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Edge native messaging and installation: https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging
