# Axik PDF Editor — Performance, Stability, Security & Acceptance Test Plan

**Document ID:** AXP-QA-001  
**Version:** 0.1 (proposed / baseline not yet measured)  
**Date:** 2026-10-12  
**Applies to:** Desktop app, Chromium extension, optional native messaging host and print/redaction services.

## 1. Quality policy

Functional existence does not equal acceptance. Every first-release P0 feature needs a deterministic test, an observable user result and negative/failure-path coverage. GPU acceleration, mixed-orientation printing, annotation round-trips, file preservation and redact safety are **release gates**, not best-effort nice-to-haves.

The performance thresholds below are initial engineering objectives, **not measured claims or commitments already met**. Phase 0 must run baselines on reference hardware, establish realistic thresholds and record any formally approved changes in version control before feature development begins.

## 2. Reference device/baseline matrix

| Profile | Minimum test description | Purpose |
|---|---|---|
| H1 | Windows 10/11 supported build; 4-core CPU, 8–16 GB RAM; modern integrated Intel/AMD GPU | Low-resource real-world correctness and software fallback |
| H2 | Windows 11; 6–8 core CPU; 16–32 GB RAM; mainstream dedicated NVIDIA/AMD GPU | Typical accelerated desktop baseline |
| H3 | Windows 10/11 supported build; 8-core CPU, 32–48 GB RAM; AMD RX 7900 XTX 24 GB or comparable | High-end/large-plan stress; do not optimize exclusively for this hardware |
| H4 | Chromium browser on H1 and H2 with hardware acceleration enabled and disabled | Extension isolation and graceful degradation |
| P1 | Windows Microsoft Print to PDF / XPS virtual paths | Deterministic logical print artifact checks |
| P2 | At least one physically installed duplex-capable laser printer and a second distinct driver class/model | Physical orientation, margins, scale and duplex validation |
| P3 | Large-format printer/plotter if supported stock is advertised | Arch sizes, media selection and printed dimension correctness |

Record exact OS build, GPU model, driver date/version, WebView2 runtime, browser version, monitor DPI/resolution, power profile, printer model/firmware/driver and data corpus checksum for every benchmark.

## 3. Proposed latency and resource SLOs

Warm = process and OS filesystem cache warm; cold = fresh process and documented OS cache policy. Use at least 30 measured opens per fixture/device for P50/P95; long-haul tests separately.

| Metric | Initial goal | Profile |
|---|---|---|
| Usable shell after launch, document not yet loaded | P95 <= 1.5 s | H2, normal SSD |
| First visible page of 20 pages / <=10 MB vector PDF | P95 <= 2.0 s from Open action | H2, warm cache |
| First visible page of 100 pages / 50 MB mixed document | P95 <= 4.0 s; UI stays responsive | H2 |
| Toolbar/tool selection and annotation drag feedback | P95 <= 50 ms to visible acknowledgement | H2 |
| Continuous 1080p scrolling over 50 representative pages | >= 55 delivered frames/s for 95% of measured time | H2, warm tiles |
| Continued interaction while indexing/thumbnailing | > 95% UI events processed within 100 ms | H2 |
| 200-page document after scrolling all pages | <= 1.0 GB incremental resident memory goal (document-specific exceptions recorded) | H2 |
| Idle app, no PDFs open | Resource footprint measured; zero required GPU compute workers | H1/H2 |
| Extension open 10 MB document | P95 <= 2.5 s to useful first page | Chrome/Edge H2 |
| GPU disabled | Correct output, no hangs; record degraded FPS/latency | H1/H4 |

Additional proposed targets:
- No unbounded memory growth across a 1,000-cycle open/edit/save/close soak test.
- A multi-hour scroll/zoom/annotation stress test must end with stable memory and no crash, lost edit or GPU driver lock.
- Background tabs must stop needless active rasterization; only essential bounded save/journal tasks continue.
- Print preview for a 20-page mixed-orientation PDF should become interactive in <= 2 seconds P95 on H2 without fully rasterizing all sheets at print DPI.
- Each release includes paired CPU-only and accelerated traces, measuring I/O, PDF raster, GPU upload and composition. GPU hardware usage must be observed when enabled; use Windows graphics tracing or browser DevTools trace, not a marketing checkbox.
- Printing at 600 DPI may take longer than viewing; evaluate throughput with large sheets separately to avoid compromising correctness.

Thresholds may be revised by an explicit documented decision after measured Phase 0 baseline—not by silently relaxing a failing test.

## 4. Deterministic print acceptance matrix

Every printer-focused test captures: document hash, each source page's boxes/Rotate, chosen physical sheet, logical scale, displayed clip estimate, expected orientation, spool result, physical output verification method and checksum of generated preview/virtual output.

| ID | Test case | Pass condition |
|---|---|---|
| PRINT-T01 | 12-page sequence P-L-P-L ... on Letter stock | Every page oriented for reading, ordered, not clipped, no manual orientation changes |
| PRINT-T02 | Landscape Letter source amidst portrait pages | Landscape fits by content rotation on same physical stock; per-page preview matches |
| PRINT-T03 | Pages with Rotate=90/180/270 and nonzero CropBox origin | Visible content upright as intended; no double rotation |
| PRINT-T04 | Interleaved Letter/Legal/Tabloid source, physical Letter selected | All mapped using displayed scaling; warnings on non-actual size |
| PRINT-T05 | Letter plus Arch D actual-size request on printer lacking Arch D | Action blocked/warned with clear fallback; no silent shrink or stock mismatch |
| PRINT-T06 | Duplex short/long edge, alternating orientation | Front/back parity and physical reading direction correct |
| PRINT-T07 | Odd page count + duplex + 2 copies collated | Correct blank/back and page order; no duplicated or missed sheets |
| PRINT-T08 | Actual-size source with out-of-bounds content | Warn clipping instead of silently shrinking or losing content |
| PRINT-T09 | Thick annotations/callout arrows near margins | Preview/print annotation visibility and clip region accurate |
| PRINT-T10 | Printer goes offline, queue rejects job, user cancels | Clear status; no automatic duplicate job on retry |
| PRINT-T11 | Different driver paper capabilities and hard margins | Settings checked against real driver; no unsupported options claimed |
| PRINT-T12 | Mixed stock per-page ticket not supported | Offer contiguous segments or fixed-paper normalization; do not misstate single-job feasibility |
| PRINT-T13 | Save named preset and driver later changes | Revalidate and warn, do not blindly apply stale capabilities |
| PRINT-T14 | Large vector construction drawing tiled/high DPI | No OOM, correct physical scale/ruler grid, readable lineweights |
| PRINT-T15 | Normal job spool output vs PrintPlan preview | Same page order, transforms, annotation flag, stock choice and sheet count |

### Required fixture creation

Programmatically generate synthetic PDF fixtures with exact colored orientation labels, large arrows, asymmetric corner markers, inch/mm calibration grid, zero/90/180/270 rotations, offset CropBoxes and mixed media. For hardware acceptance physically measure alignment/size at printed sheet corners. Avoid confidential job drawings as public test fixtures.

Print acceptance is **100% test pass** on the supported printer reference matrix. A driver failing an optional capability may be declared unsupported, but the application must detect it and provide safe fallback before printing. No paper-waste regression is acceptable.

## 5. Annotation interoperability matrix

Minimum external readers/writers: Axik Desktop, Axik Chromium Extension, installed PDF-XChange Editor, free Adobe Acrobat Reader for display/comment inspection, PDF.js baseline viewer and at least one second independent PDF parser. Paid Acrobat licensing is **not required** to begin verification; advanced Acrobat editing can be confirmed later with an authorized trial/test seat if necessary.

Test vectors:

- FreeTextCallout with straight leader, elbow, arrowhead, rotated text box, transparent/opaque fill and different fonts, colors and line weights.
- Sticky note, highlight (quadpoint accuracy), ink paths, line/shape annotation, comment author/time, reply thread.
- Callout on rotated and cropped page: moving the text box must not change arrow-tip attachment when not requested.
- Create in Axik, export, reopen in PDF-XChange and edit text, move tip/leader; export and reopen in Axik unchanged within geometric tolerance.
- Create in PDF-XChange, import in Axik, edit, save; unknown dictionary fields and appearance streams survive.
- Open/export in Chromium then compare with desktop viewer: pixel/layout difference within measured tolerance, same comment geometry and text.
- Copy/move/rotate page with annotations; no dangling references, lost metadata or zero-size appearances.
- Reject "success" on a PDF containing only flattened drawings when true editable callouts were requested.

Geometry tolerance: <= 0.5 PDF point for stored annotation vertices under ordinary page transforms, unless a tighter test-specific bound is appropriate. Visual screenshot difference tolerances are measured separately due to font antialiasing.

## 6. Redaction verification — zero-leak bar

Secure redaction test files contain planted secret strings across:

- Visible digital text in multiple fonts, ligatures, direction and layers.
- OCR text invisibly behind scanned images.
- Images with colored/transparent layers, vector forms, XObjects and overlapping masks.
- Search indexes/metadata, document title, bookmarks, comments, annotations, attachments and hyperlinks.
- Prior incremental-save generations, object streams, cross-reference tables, compressed content, embedded XML, hidden layers and thumbnails.
- Large raster backgrounds or symbols crossing the proposed rectangle.
- Exact text selection and arbitrary rectangular region selection.
- Password-protected/partially corrupt documents with failed-save paths.

Pass condition: all sources targeted by the chosen redaction/sanitization policy are absent in saved output using multiple independent extractors, PDF object/byte inspections, text extraction, OCR on rendered redacted output and visual checks. Export must not contain old incremental PDF content or reachable sensitive objects. Confirm preserved non-redacted region matches expected visual output. Redaction marked but unapplied is explicitly unsafe; an attempted insecure mode cannot be labeled "redacted."

**Any secret recovery is a hard release blocker.** Do not quietly reduce test scope to make a redaction backend pass. If a document cannot be confidently sanitized, fail closed or use user-approved reconstruction with the disclosed limitations.

## 7. Crash, data preservation and resilience

| ID | Fault injection | Expected result |
|---|---|---|
| STAB-T01 | Kill desktop UI during unsaved annotation edit | Original unchanged, bounded journal restored on restart |
| STAB-T02 | Kill worker during PDF raster | UI survives and can reopen/rollback; no source mutation |
| STAB-T03 | Simulated GPU device removal/reset | Software fallback or graceful restart; no lost annotation |
| STAB-T04 | Disk full during Save/Save As | Clear error; original verified intact; incomplete output not presented as valid |
| STAB-T05 | Access denied / locked file | No overwrite; user can Save As |
| STAB-T06 | Modify original externally during editing | Conflict recognized; explicit overwrite/reload/copy choice |
| STAB-T07 | Broken xref, huge images and decompression bomb | Parser resource budget respected; controlled error |
| STAB-T08 | Close extension MV3 worker mid edit | Document tab and journal survive; save/export works after worker wakes |
| STAB-T09 | Uninstall native host while connected | Browser-only tools function; bridge error is contained |
| STAB-T10 | Print spool timeout then retry | No unexpected duplicate print job |
| STAB-T11 | Restore document after partial prior redaction export | Unredacted source not replaced by half-redacted file; safe incomplete export rejected |
| STAB-T12 | Extension storage quota exceeded | Warning and export opportunity, no false "saved" state |
| STAB-T13 | 1,000 file cycles + long editing soak | No data loss, sustained leak or crash |
| STAB-T14 | Loss of battery/power at transactional save boundaries | Original valid; temp/recovery state understandable after restart |

Proposed goal: >=99.9% crash-free measured test sessions across supported reference matrix (with opt-in anonymous production telemetry only if ever implemented). This statistical KPI is not proof of zero data loss; destructive-fault acceptance tests are mandatory regardless.

## 8. Security and dependency release gates

- Fuzz inputs for PDF parsing, annotation string parsing, PDF serialization, native messaging protocol and print ticket handling.
- Use process isolation/memory limits for hostile PDFs; no automatic PDF active content execution.
- Verify saved file output with an independent parser and render checks before replacing original.
- Native bridge: message size bounds, request-id validation, versioned capability checks, exact extension allowlist, no arbitrary filesystem RPC, user approval for privileged action and malicious-extension simulation.
- Extension: no blanket host permissions by default, no remote code, CSP compatible with MV3, no unauthorized access to other browser tabs/files.
- Release SBOM, dependency pinning, license review, high-severity CVE review, binary signature/installer verification and update rollback testing.
- Privacy tests verify offline PDF open, markup, print and export without external network connections from Axik components.
- Redact and clear any document text/file path from crash reports unless locally reviewed and explicitly attached by the user.

## 9. Manual vs automated tests

**Automatable:** PDF fixture generation, logical PrintPlan checks, virtual-printer output inspection, serializer round trips, image diffs, extraction/redaction leak detection, save fault injection, memory/performance traces, extension lifecycle tests and IPC threat-model regressions.

**Manual/hardware:** Physical duplex direction, actual margins and print scale, multi-stock tray switching, paper jam/offline recovery, GPU driver reset on target hardware, real-world handwriting/stylus UX, external Acrobat/PDF-XChange annotation editability.

One successful virtual print is not sufficient to claim mixed-orientation printing works on a real printer. The print claim must be qualified by tested printer and driver classes.

## 10. Release gates checklist

- [ ] Phase 0 target hardware and reproducible benchmark corpus captured.
- [ ] Supported browser/runtime/driver matrix documented.
- [ ] Startup, first page, frame consistency, memory and actual GPU usage pass approved target budgets.
- [ ] CPU fallback and GPU-device-loss handling verified.
- [ ] Mixed portrait/landscape on fixed stock passes 100% reference print suite and physical tests.
- [ ] Unsupported mixed-media/hardware features fail with clear warnings before printing.
- [ ] Native callouts/comments round-trip; Acrobat Reader/PDF-XChange display correctly and edit when supported.
- [ ] Visible signatures save in correct location, never misrepresented as cryptographic.
- [ ] Redaction passes independent zero-leak/anti-recovery tests or is not shipped as available.
- [ ] All save-failure/crash/restart tests preserve original and recover journal.
- [ ] MV3 browser-only editing works with host absent or disconnected.
- [ ] No Weave/runner/AI requirement in product installation, runtime or QA workflow.

**Interpretation:** The boxes document future acceptance. None has been checked by specification drafting.
