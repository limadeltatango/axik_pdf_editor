# Foundation Implementation Status — 2026-10-12

**Branch:** feat/foundation-phase-1  
**Base:** spec/desktop-chromium-v0.1  
**Status:** Source code committed; NOT dependency-installed, typechecked, built, benchmarked, tested or packaged.  
**Execution restriction:** No Axik AI Weave, local AI models, runners, GitHub Actions or automated CI was used or configured.

## Implemented as source (not yet validated)

| Area | Files | Present behavior |
|---|---|---|
| Monorepo | package.json, pnpm-workspace.yaml, tsconfig.base.json | pnpm workspaces for shared modules and two applications |
| PDF geometry | packages/document-core/src/geometry.ts | Affine transforms, crop/rotation/user-unit normalized page dimensions, validation |
| Callout model | packages/document-core/src/annotations.ts | Typed FreeTextCallout intent, leader/box geometry, bounds, styling validation |
| Undo/redo | packages/document-core/src/commands.ts | In-memory immutable annotation state and bounded history |
| Safe PDF writer boundary | packages/document-core/src/writer.ts | Original-only export; refuses to export changed annotations as if persisted |
| Print planning | packages/print-plan/src/index.ts | Logical per-page fixed-stock orientation/scale decisions, sheet/duplex grouping, clipping flags, page-to-sheet transform |
| Draft recovery | packages/recovery/src/index.ts | SHA-256 document identity, validated IndexedDB annotation journals, restore/discard |
| Render primitives | packages/render-core/src/index.ts | Bounded render queue, byte-budgeted LRU resource cache, stage-specific in-memory timing samples |
| Shared UI | packages/editor-ui/src/ | PDF.js source reader, single-page canvas view, zoom/page nav, new callout draft, text edit, undo/redo, local draft restore, geometry-only print-plan preview |
| Desktop shell | apps/desktop/ | Tauri 2 Windows-first shell, shared UI entry, no privileged native filesystem/spool commands |
| Browser extension | apps/chromium-extension/ | MV3 full-tab local editor via toolbar; right-click URL path with explicit host grant, size-bound cookie-free fetch |
| IPC boundary | packages/ipc-contract/ | Versioned typed handshake/ping validation; privileged commands not available |
| Test inputs | tools/generate-print-fixtures.mjs | Unexecuted standalone generator for alternating orientation, rotated/cropped, mixed media and odd duplex PDFs |
| UI containment | packages/editor-ui/src/ErrorBoundary.tsx | React render failure screen instead of silent blank window |

## Absolutely NOT implemented or proven

### Core user-visible missing features

- **No edited PDF output**: callout drafts are **not** serialized into PDF dictionaries, standard appearance streams, or the actual file. Export original is available only when no edit has been recorded.
- **No printing to hardware**: the fixed-media PrintPlan is pure math. Preview is a diagram, not the rendered final paper image. No printer enumeration, drivers, spooler, duplex direction qualification, print tickets, scale/ruler validation or actual print submission is present.
- **No real redaction**: do not treat black shapes, draft marks, or future annotations as a privacy/security scrub. Secure redaction must be entirely gated on independent anti-leak tests.
- **No visual signing or AcroForm filling yet**, no OCR, text editing, search UI, thumbnails, page merging, page splitting or reordering, advanced markup/tools or comments round-trip.
- **No native messaging companion** and no browser-only guarantee for advanced print or redaction.
- **No claimed GPU acceleration**: PDF.js draws page content into canvas and the Chromium/WebView2 compositor may use GPU, but the actual pipeline has not been profiled. Render queue/cache primitives are coded, not integrated in a GPU-aware tiled renderer; GPU reset/fallback tests await the implementation phase.
- **No stable release/installer**, binary signing, Web Store submission or enabled bundling.
- **No verified Windows 10/11, Chrome, Edge or third-party editor interoperability**.
- **No crash-proof saved output**: writing source PDFs is disabled. IndexedDB draft recovery is best-effort; it is not a guaranteed autosave, not encrypted, and not a substitute for versioned PDF saves.

### Important design limitations

- PDF.js currently renders just one page at a time, rerendering when zoom changes. This is intentionally simple foundation code, NOT the final tiled/multiresolution performance architecture.
- Local PDF loading buffers full document bytes, with a 512 MB foundation limit. Extension URL fetch has a 200 MB limit, streams with a bound, and omits authentication cookies. Some URLs and protected viewers cannot be opened; choose/download the file manually.
- Extension asks for host permission only when the user clicks an explicit link-open control. No broad automatic interception, script injection, or site scraping occurs.
- Proposed dependency versions have NOT been resolved or locked. Package interoperability, Tauri CSP/permissions, PDF.js workers and MV3 bundling require the first non-Weave validation pass.
- PDF page boxes, annotation geometry and printing logic are groundwork for actual writer/spool adapters. Their presence does not imply complete PDF-standard conformance.
- Native callout appearance streams and correct standard annotation bounds need independent Acrobat/PDF-XChange verification before use on real submittals.
- The project has no dependencies or runtime hooks for Weave, Atlas, Arbiter, BuildAxis or OpenStorage.

## Suggested next offline/local validation (ONLY after user authorizes it)

These are future operator commands, **not commands performed for this commit**:

1. Install supported Node 22+, pnpm, Rust stable, MSVC Windows build prerequisites and WebView2 runtime.
2. Resolve workspace dependencies with pnpm install and commit a verified lockfile. Update current unpinned Rust/Tauri dependency resolution policy.
3. Run pnpm typecheck and correct errors.
4. Build the extension, load unpacked in Chrome/Edge, and confirm PDF.js worker loads under the declared MV3 CSP.
5. Run the desktop under Tauri and verify WebView2 loads bundled pdf.worker and locally selected PDFs.
6. Generate PDF fixtures, validate with two independent readers, then run deterministic PrintPlan tests without physical printing.
7. Add and qualify the native PDF writer that emits editable standard FreeTextCallout and /AP objects. Until then export remains blocked for edited documents.
8. Benchmark actual cold-start, first-page, scroll, memory and CPU/GPU rendering profiles; select and implement the accelerated compositor based on measurements.
9. Build native Windows print service only after printer hardware/driver matrix is available.
10. Evaluate and security-test a genuine redaction backend before enabling it anywhere.

## Review contract

Treat every feature listed as source implementation only. Do not label this branch production-ready, merge to main as a finished product, install it on work machines for sensitive documents, or turn on printing/redaction workflows until explicit acceptance tests pass. The P0 product requirements in PRODUCT_REQUIREMENTS.md remain the target, NOT the current implementation state.

---

### Superseding development authorization and diagnostic branch

The no-Weave development restriction described above applies to the *original
foundation coding pass*. On October 12, 2026 (Eastern time), the owner explicitly
authorized use of Axik AI Weave for subsequent development and testing.

Separate feature work in `feat/local-diagnostics-support-bundle` introduces a
user-exportable local diagnostics ZIP and instrumentation:
[Diagnostics spec](DIAGNOSTICS.md) / [APDF-38](https://axikai.atlassian.net/browse/APDF-38).
Its code must remain runtime-independent of Weave. Tests and binary qualification
are not implied by committed diagnostic source.
