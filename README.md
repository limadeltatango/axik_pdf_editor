# Axik PDF Editor

**Development state (October 12, 2026): Foundation implementation in draft review. NOT built, tested, packaged or suitable for production PDFs.**

Axik PDF Editor is a local-first Acrobat-class PDF editor project with two separate delivery experiences:

1. **Windows desktop application** — a Tauri 2 shell using the shared React/PDF.js viewer; the eventual advanced printing, standard callout export, redaction, signing and document operations will be native services and PDF-writer integrations.
2. **Chromium Manifest V3 extension** — a Chrome/Edge full-tab editor with a local file picker, plus a user-initiated right-click PDF link path that asks permission before fetching a PDF from that site. No mandatory desktop companion.

Both products share annotation geometry, edit commands, drawing behavior and quality requirements. The editor is a **standalone repo**, not part of Axik AI Weave, Atlas, Arbiter, BuildAxis or OpenStorage.

## What the foundation actually does

- Opens local PDFs with PDF.js (one visible page at a time) and supports page navigation and zoom.
- Creates **in-session** callout drafts with arrow/leader/box geometry and editable text; supports undo/redo.
- Stores annotation drafts in local browser IndexedDB, keyed to the source PDF fingerprint, with a restore action. This is not encrypted storage or a guaranteed backup.
- Builds geometry-only fixed-stock PrintPlans using per-page sheet orientation and scaling decisions, with clipping/scale warnings and duplex sheet grouping.
- Provides the shared TypeScript page-coordinate model, annotation validation, versioned IPC envelope, bounded rendering queue/cache primitives and unexecuted synthetic test fixture generator.
- Gives each application its own entry point, manifest/configuration and source boundaries. The extension requires explicit per-site permission for link fetching and does not send login cookies.

**No edited PDF can be exported yet.** The only enabled PDF export downloads the original when no edits exist. Intelligent printing, redaction, signing, PDF-native annotation writing, actual GPU acceleration, text editing, OCR, form filling and page manipulation are not yet implemented. The UI labels unfinished actions rather than simulating them.

**Start here:** [Current foundation status and safe next steps](docs/FOUNDATION_IMPLEMENTATION_STATUS.md).

## Early-stage diagnostic bundles

The desktop and Chromium foundation now include a **Diagnostics** panel with bounded
local event recording, a recording toggle, clear-history control, and an optional
environment/GPU information export. Click **Export diagnostics ZIP** to download a
report you can inspect and attach to ChatGPT or an APDF issue. No PDF contents,
filenames, document paths, annotation text, URLs or raw exception messages are
collected by this recorder, and nothing uploads automatically.

The diagnostic exporter is source-coded but still needs build, ZIP compatibility,
privacy, crash recovery and cross-browser verification. Read
[Local Diagnostics Specification](docs/DIAGNOSTICS.md) and
[APDF-38](https://axikai.atlassian.net/browse/APDF-38).

**Updated authorization:** Axik AI Weave is now permitted for development and
testing when supported and appropriate (authorization given October 12, 2026
Eastern time). The editor itself has no runtime Weave dependency. The prior
no-Weave restriction was historical for foundation coding, not an ongoing ban.

## Proposed local development workflow (not executed yet)

Prerequisites for subsequent validation: Node 22+, pnpm, Rust stable and Windows Tauri/MSVC/WebView2 dependencies. Only the extension requires a Chromium browser.

```sh
pnpm install
pnpm typecheck
pnpm build:extension
pnpm dev:desktop
```

The exact dependency versions/Cargo manifests, local development CSP and build compatibility must be validated before relying on these commands. A lockfile is intentionally not claimed as resolved/verified yet; the first local dependency installation should produce and check in the lockfiles before a release.

For the extension, the future validated workflow will load `apps/chromium-extension/dist` as an unpacked extension. For the Windows desktop, Tauri bundling is deliberately disabled until installer design and runtime/security prerequisites have been qualified.

## Construction drawing revisions (planned, not implemented)

The future [Revision Manager](docs/REVISION_MANAGER.md) will preserve an immutable
baseline PDF, let users create reviewable proposed changes, record explicit
approval decisions and incorporate **approved changes only** into a new controlled
PDF revision. It must never claim PDF markups alter a CAD/BIM authoring file.

This workflow follows **safe Save/Overwrite**, real mixed-orientation
**physical printing**, and **text editing**. Quick Export remains independent and
non-destructive. See [APDF-44](https://axikai.atlassian.net/browse/APDF-44).

## Specification (draft)

| Document | Coverage |
|---|---|
| [Product Requirements](docs/PRODUCT_REQUIREMENTS.md) | Two-product feature boundary, user workflows and goals |
| [Desktop Specification](docs/DESKTOP_SPEC.md) | Correct mixed-orientation hardware printing, native callouts, redaction, signatures |
| [Chromium Extension Specification](docs/CHROMIUM_EXTENSION_SPEC.md) | MV3, offline editor, optional companion integration |
| [Shared Architecture](docs/SHARED_ARCHITECTURE.md) | Candidate PDF engines, GPU, print service and IPC |
| [Quality and Tests](docs/QUALITY_AND_TESTS.md) | Measurable performance, printer and data-loss acceptance |
| [Roadmap and Decisions](docs/ROADMAP_AND_DECISIONS.md) | Feasibility gates and sequencing |
| [Foundation Implementation Status](docs/FOUNDATION_IMPLEMENTATION_STATUS.md) | Exact code present, known risks and deferred validation |

## Development boundaries

No Weave jobs, AI agents, local LLMs, runners, GitHub Actions, builds or tests were started while producing this code foundation. The foundation is isolated in its own review branch, and the specification is tracked separately. A successful GitHub commit is not an indication of successful execution or interoperability.
