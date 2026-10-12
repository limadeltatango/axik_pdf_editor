# Axik PDF Editor — Shared Architecture, Rendering and Printing Design

**Document ID:** AXP-ARCH-001  
**Version:** 0.1 (proposed architecture, subject to feasibility spikes)  
**Date:** 2026-10-12  
**Status:** Decision candidates, not implemented.

## 1. Architecture rules

- Desktop and Chromium extension are **separate deliverables** with shared UI components, user gestures, PDF coordinate transforms, annotation commands and PDF compatibility tests.
- PDF documents are standard PDF files, not an Axik-exclusive file type. An internal operation journal is a recovery mechanism, not the sole persistent representation.
- The desktop is a normal installed application, not a wrapper that needs a running development environment, localhost server, cloud API, Python daemon, Weave or AI inference.
- Browser-only editing is locally contained in the extension tab. An optional native bridge is privileged and minimal.
- GPU-accelerated interactive display is a target with explicit evidence and software fallback; parsing, font decoding and PDF object manipulation may remain CPU tasks.
- Prefer libraries with a verifiable, commercially compatible license and a strong, maintained security update path.

## 2. Proposed workspace

~~~
apps/
  desktop/                # Tauri 2 shell + Windows integration
  chromium-extension/     # Manifest V3 extension, full-tab viewer, service worker
packages/
  ui/                     # Shared accessible React/TypeScript components
  document-model/         # Geometry, typed edit commands, history, capabilities
  annotation-core/        # Standard annotation normalization and serialization adapters
  rendering-interface/    # Renderer-independent tile scheduling/caches/viewport
  print-plan/             # Pure page-to-physical-sheet planning and preview model
  ipc-contract/           # Versioned schemas for browser/native bridge
native/
  document-worker/        # Isolated Rust / C++ boundary for PDFium/qpdf and editing
  print-service/          # Windows XPS/PrintTicket and printer drivers
  native-messaging-host/  # Small optional bridge process
test/
  fixtures/               # Synthetic/non-confidential PDFs and expected outputs
  compatibility/          # Acrobat/PDF-XChange round-trip manifest
  performance/            # Device-specific reproducible benchmarks
docs/                      # Versioned requirements, architecture and release gates
~~~

These are proposed source directories, **not** code or files currently created.

## 3. Candidate stack and licensing gates

| Component | Proposed role | Status / risk |
|---|---|---|
| Tauri 2 + WebView2 | Compact Windows desktop shell, installer, OS integration | Candidate; verify cold-start time, GPU composition, memory and WebView2 runtime security |
| React + TypeScript | Shared editor tools, command gestures, panels, keyboard model | Candidate; careful subscriptions to avoid re-rendering thousands of pages |
| PDF.js (Apache-2.0) | Primary shared document view, text/search and page raster pipeline | Baseline candidate; evaluate browser and WebView2 performance and build compatibility |
| PDFium (BSD-style plus dependencies) | Native parsing/raster/print fallback, possible thumbnail or high-volume rendering | Spike; does **not** automatically establish GPU PDF rasterization or full editing capability |
| qpdf (Apache-2.0) | Native PDF structure transform, split/merge and safe low-level document serialization support | Candidate; **not** a renderer or by itself a redaction backend |
| Browser PDF writer (to select) | Browser-only standard annotation object creation, appearance streams, save/export | Critical feasibility spike; license and native-callout round trips required |
| Direct2D / Direct3D / WebGL / WebGPU | Candidate GPU composition/texture/overlay path | Benchmark against accelerated browser canvas and power/copy overhead |
| Windows XPS/PrintTicket | Physical sheet/job capabilities and possible page-scoped print options | Driver-dependent; hardware qualification gate |
| Redaction library / full reconstruction | Content-removing sanitized redacted PDF output | Critical security and licensing spike; cannot claim safe before passed |

**License note:** MuPDF and PyMuPDF use AGPL/commercial licensing and must not be added to a proprietary distribution by accident. Evaluate commercial licensing as an explicit business decision if chosen; do not assume QPDF has an equivalent safe-redact operation. Do not ship third-party binaries without their required notices and license checks.

Source material:
- https://mozilla.github.io/pdf.js
- https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE
- https://github.com/qpdf/qpdf
- https://learn.microsoft.com/en-us/windows/win32/direct2d/direct2d-portal

## 4. Module contracts

The domain must not know whether it runs in Tauri or an MV3 tab.

- **DocumentSource:** user-approved local file, browser File object, fetch-with-granted-host-access result or native handoff; expose stable document ID, content hash, original name and byte-source abstraction (random access / range where available).
- **PageDescriptor:** index, boxes, inherited rotation, UserUnit, visible bounds, form/annotation count, optional text and thumbnails. Never conflate visible page dimensions with physical printer paper.
- **DocumentCapabilities:** source permits view/edit, origin capabilities, writer implementation, native-host availability, signing/redaction modes and print backend capabilities.
- **Command:** create/move/delete/stylize annotation, reorder page, rotate page, stamp, visual signature and redaction mark; immutable edit intent, transaction ID and inverse operation where reversible.
- **Annotation:** normal form with stable ID, page, PDF coordinates, author, timestamps, visual properties and type-specific data. Native serialized object/appearance must be authoritative when saving; preserve unknown extension fields where possible.
- **PrintPlan:** immutable list of physical sheets plus each source page's placement transform, media, requested driver features, annotations policy, clipping flags and preflight warnings.
- **SaveResult:** output hash/path or browser download ID, validation outcome, original/backup status; do not declare success until write, flush and reopen checks pass.
- **NativeCommand:** versioned explicit request/response, operation ID, capability scopes and structured errors; prohibit arbitrary subprocess commands or unsanctioned file path reads.

Each interface gets a JSON Schema / TypeScript type, property-based tests and a backward compatibility versioning rule before native IPC ships.

## 5. Rendering pipeline — GPU is a first-class requirement, not a slogan

Proposed path:

~~~
File bytes -> Safe parser worker -> Visible-page scheduler -> Page raster/vector tiles
                                                      |
                                           GPU texture / composition
                                                      |
                               Text/selection/annotation overlay (shared UI)
                                                      |
                                        Presentation on desktop or tab
~~~

### Rules

1. Keep the editor shell interactive while document loading happens in workers. First visible page gets priority over thumbnails, OCR and text indexing.
2. Render only in/near the viewport at useful resolution. Tile oversized construction sheets and cache textures subject to GPU VRAM and system-memory budgets.
3. Use a multiresolution strategy: immediate thumbnail/low-resolution preview followed by crisp final tiles. Cancel outdated work on fast zoom/scroll.
4. Reuse GPU textures and avoid CPU-to-GPU transfers per animation frame. Zoom/pan should usually transform already-rendered textures before a sharper tile becomes available.
5. Draw interactions/annotation overlays separately from the expensive page background so moving a leader line does not rerender the PDF page.
6. Run expensive image/font decoding/search in bounded workers, not React component render paths.
7. Fallback to CPU/software canvas on GPU reset, driver blacklist, remote desktop limitations or unavailable API, without changing saved PDF semantics.
8. Record separate timings for file I/O, metadata parse, PDF painting/rasterization, texture upload, GPU compositing and UI frame. **Accelerated compositor != accelerated PDF painter.**
9. Never block the UI for an arbitrary page render or a save. Cancellation/backpressure and memory caps are required.
10. Browser memory and the desktop rendering process must be separately limited; a crash in a renderer should not poison the editor state or source file.

### Renderer decision spike (mandatory before build)

Compare three representative combinations on the exact same PDF corpus and hardware:

- **R1:** PDF.js rendering with WebView2/Chromium-backed canvas and GPU compositing (shared everywhere).
- **R2:** PDF.js shared frontend plus native PDFium image/print worker on desktop, GPU upload/cached composition.
- **R3:** R2 plus a Direct2D/Skia-or-equivalent accelerated path **only if** there is a supported implementation that actually improves measured high-resolution page rendering.

Compare cold and warm first-page latencies, 200+ page document scrolling, construction vector sheets, 600-DPI print raster throughput, memory/VRAM, visuals compared to known reference, failure rates and Windows 10/11 driver compatibility. Choose fastest robust design; do not increase binary complexity for theoretical GPU benefit.

## 6. Standard PDF geometry and annotations

- All pointer events are transformed through viewport -> displayed page -> unrotated PDF user space. Support CropBox offsets, inherited Rotate and UserUnit.
- Native PDF annotations must retain type-specific fields. Callouts are FreeText annotations with IT=FreeTextCallout and 4- or 6-number CL, appropriate line ending/appearance stream, not two unrelated graphics.
- PDF comments/markup keep standard annotation metadata, author/modification fields and in-reply-to relationships where supported.
- Generate appearance streams for imported and edited annotations, avoiding viewers that show a blank rectangle despite valid object content.
- Do not break existing annotations/forms because our UI cannot edit a subtype. Preserve or offer a deliberate flattening operation.
- Serializers must have test vectors generated by Acrobat and PDF-XChange and round-trip expectations. Reader-only success is insufficient.

Adobe's reference discusses FreeTextCallout under free-text annotation dictionaries: https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.6.pdf .

## 7. Print planning: separate PDF page intent from hardware sheets

### Processing flow

1. Read source PDF page boxes, Rotate and optional content bounding hints (without assuming that whitespace means intended rotation).
2. Obtain physical printer capabilities: available media, printable area, duplex options, trays, validated PrintTickets and hard margins.
3. Resolve user selection (page range, media policy, actual-size/fit, comments visibility, duplex/copies).
4. For each logical page independently choose placement rotation from allowed 0/90/180/270 transforms and scale subject to user policy.
5. Construct physical sheet sequence and duplex pairs in source order; if multiple physical stock sizes are required, assess verified per-page support or contiguous print segments with explicit confirmation.
6. Generate previews **from the PrintPlan** and display any source crops/clipping, orientation transform, sheet count and stock changes.
7. Preflight validates placement and driver capabilities; reject or warn on unsupported operations.
8. Submit to the Windows print backend; report job creation/queue state separately from actual physical completion.

### Crucial design choice for mixed portrait/landscape on one physical stock

When output stock is fixed (e.g., US Letter), **keep a stable printer sheet orientation and rotate the page content within that sheet** as needed. This avoids assuming the printer honors dynamic driver orientation changes between pages. A landscape 11 x 8.5 PDF can be rotated into an 8.5 x 11 physical sheet without necessarily requesting a new printer ticket orientation. Respect explicit 100% scale; do not silently shrink.

**Mixed physical stock is different:** For Letter and Arch D outputs to their intended physical sizes, per-page media/duplex tickets or user-approved print segments may be required. If printer or driver cannot guarantee it, do not pretend a single job can.

### Print backend feasibility gates

- Compare XPS per-page PrintTicket construction/validation with mainstream PCL and PostScript drivers, and a PDFium/tiled high-DPI raster spool fallback.
- Prevent massive bitmaps for oversized drawings; tile or use vector output where technically feasible and fidelity-safe.
- Print preview physical sheet dimensions must be derived from the same plan as spool output. Test against physical printed page corners and ruler/scale on actual hardware.
- A final **Spool ACK** confirms only queue acceptance, not that the last sheet exited the printer.
- Prevent duplicate submissions on UI retry and support deliberate cancellation.

Windows documentation: https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/how-to-validate-and-merge-printtickets ; https://learn.microsoft.com/en-us/dotnet/desktop/wpf/documents/printing-overview .

## 8. Document editing, secure save and redaction boundaries

- The document worker owns final PDF edits and write transactions. The UI maintains optimistic commands but reconciles against confirmed saves.
- Write to same-volume temporary output where possible; fsync/flush and reopen, then replace/rename, preserving an original/backup according to policy.
- No in-place bitwise mutation of a source PDF during user action. Incremental save may be acceptable for ordinary non-sensitive editing, but **not** for secure redaction/sanitization.
- Secure redaction is a separate export transaction with irreversible content removal, full rewrite without reachable/old sensitive bytes, post-write audits and signature invalidation warning.
- On redaction failure, keep source and marked edit state, delete invalid temporary output and refuse to label result "redacted".
- Possible secure reconstruction fallback for a complex PDF is a high-DPI image-only page replacement (after redaction and stripping the original content/metadata). Flag changed text-search/accessibility/vector quality and validate again. This is a fallback, not a promise of preserved vector editing.
- Keep autosave/recovery caches of pre-redaction originals out of exported files, and document local deletion/retention rules clearly.

## 9. Native browser bridge model

~~~
Chromium extension tab
       | typed user action / capability lookup
MV3 service worker
       | Chromium nativeMessaging (length-prefixed JSON)
Installed restricted native messaging host
       | authorized local IPC
Desktop document / print service
~~~

- The native host is installed only by a local installer; it lists exact Chrome/Edge extension IDs, validates message type/size/document content hash and explicit user-action tokens.
- Avoid passing huge PDF payloads in a single native message (the host -> extension size limit is approximately 1 MB). Use bounded chunking and verified stream assembly or explicit locally staged-file handoff with restricted permissions.
- Never expose unrestricted localhost HTTP endpoints. If any local socket/HTTP transport is eventually introduced for streaming, require independent threat model, authentication, CSRF and origin protection, per-session tokens, and bound ports.
- No native operation may be triggered by an untrusted webpage simply because the extension is installed.
- Native host optional and on demand; no resident GPU or document server.

Sources: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging and https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging .

## 10. Isolation, security and upgrades

1. PDF parser/native C++ libraries should run in a sandboxed low-privilege worker with resource limits and structured crash recovery. The editor process should survive worker exit.
2. Protect against object-count bombs, zip bombs, giant image payloads, malicious fonts, broken xref tables and active PDF content. Reject or request explicit repair for invalid files rather than corrupting.
3. Track native dependency SBOM/licenses, pinned hashes, reproducible builds, security advisories and signed installers/extension releases.
4. Extension permissions minimal; MV3 CSP; no remote code execution; document data does not leave the device without user action.
5. Browser extension service worker is not a durable session host; resume based on persisted, bounded user session state.
6. Versioned data migrations must allow rollback to previous stable application version without destroying user files or journals.
7. Avoid requiring proprietary GPU vendor compute runtimes. NVIDIA, AMD and Intel hardware paths must be tested independently.
8. Install/uninstall cleanly removes host registry entries, file associations only if Axik owns them, and leaves user PDFs untouched.

## 11. Open architecture decisions (do not silently lock)

- **ADR-001:** Tauri/WebView2 vs a fully native Windows UI: choose based on measured cold-start and editor interaction performance.
- **ADR-002:** PDF.js shared render baseline vs native PDFium fast-path: choose with 3-way benchmarking, not assumptions.
- **ADR-003:** Browser PDF writer and FreeTextCallout appearance stream implementation: prototype Acrobat/PDF-XChange round-trip before commitment.
- **ADR-004:** Windows print backend and driver matrix: physical tests before user-facing claims.
- **ADR-005:** Redaction engine: independent destructive security verification and licensing decision.
- **ADR-006:** Extension automatic PDF takeover vs explicit action: default to explicit unless MV3 and browser policy reliability proven.
- **ADR-007:** Target Windows 10 support: confirm supportable runtime/security baseline and document risk.

See docs/ROADMAP_AND_DECISIONS.md and docs/QUALITY_AND_TESTS.md for decision gates. No code development, CI action or Weave call is authorized by this architecture proposal.
