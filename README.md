# Axik PDF Editor

**Status (2026-10-12): Draft product specification under review. No application source code or executable has been built.**

Axik PDF Editor is a locally running, performance-first Acrobat-class PDF editor with **two independently useful products**:

1. **Windows desktop application** — correct mixed portrait/landscape printing, standard editable callouts, comments and markup, visual signatures, verified permanent redaction, page operations and expanded PDF editing.
2. **Chromium Manifest V3 browser extension** — local/offline PDF viewing and annotation (including callouts), comments, visual signatures and PDF export in Chrome and Edge without requiring a desktop app; optional safe native integration adds high-reliability printing and other protected operations.

### Non-negotiable principles

- **Intelligent printing:** On one fixed physical paper stock, handle mixed source-page orientations without manual page-by-page orientation adjustments; validate preview against physical driver capability.
- **GPU-aware performance:** Actual accelerated page composition and responsiveness must be benchmarked and shown to improve real workloads. PDF decoding/rasterization and GPU composition are measured separately. CPU fallback is mandatory.
- **Stability:** Crash containment, cancellable heavy operations, bounded caches and atomic/recoverable saves. No document loss.
- **Editable, portable annotations:** PDF-native callout geometry (FreeTextCallout), valid appearance streams, Acrobat/PDF-XChange interoperability.
- **Safety:** Genuine redaction with independent no-leak verification, not opaque overlays; non-certified visual signatures described accurately.
- **Privacy and independence:** No mandatory Adobe license, cloud upload, account, subscription, background daemon, Axik AI Weave, LLM or runner.

## Read the specification

| Document | Description |
|---|---|
| [Product Requirements](docs/PRODUCT_REQUIREMENTS.md) | Overall scope, cross-product feature matrix, principles and constraints |
| [Desktop Specification](docs/DESKTOP_SPEC.md) | Windows UX, deterministic PrintPlan, comments/callouts, redaction, signing, editing |
| [Chromium Extension Specification](docs/CHROMIUM_EXTENSION_SPEC.md) | MV3 editor, extension-only functionality, browser restrictions, optional native host |
| [Shared Architecture](docs/SHARED_ARCHITECTURE.md) | Candidate tech stack, GPU rendering strategy, printing model, IPC and security |
| [Quality and Tests](docs/QUALITY_AND_TESTS.md) | Proposed measurable startup, performance, printer, redaction and stability gates |
| [Roadmap and Decisions](docs/ROADMAP_AND_DECISIONS.md) | Dependency-ordered work, explicit research spikes and unresolved ADRs |

**All technical stack options and performance targets are proposals until verified by benchmarks and implementation experiments.** The first phase is design and proof-of-concept qualification, not deployment.

## Development boundaries

- This is a standalone project with its own repo; no cross-project dependency on BuildAxis, OpenStorage, Weave, Arbiter or Atlas.
- Do **not** run or configure Weave, local AI reviewers, runners, orchestration, GitHub Actions or app builds as part of this specification work.
- Next steps after specification review: approve scope; collect mixed-orientation physical print fixtures; benchmark accelerated renderers; prototype browser-only standard callout export; evaluate redaction security/licensing.
