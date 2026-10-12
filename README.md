# Axik PDF Editor

**Status:** Specification and research only; no application implementation has started.

Axik PDF Editor is a local-first PDF editing project with two user-facing experiences:

1. **Desktop:** Windows-first, GPU-aware, highly stable PDF editor with intelligent mixed-orientation printing, callouts, annotations, comments, visual signing, true redaction, page operations, and expanded Acrobat-class features.
2. **Chromium extension:** Manifest V3 PDF editing interface for Chrome, Edge and compatible Chromium browsers. Common markup and export should work without the desktop program; supported native integration adds advanced printing and document operations.

Both experiences will share the editing model, annotation behavior, UI components where practical, document compatibility rules and test corpus. Performance and reliability are release-blocking requirements.

## Development status

This repository was initialized on 2026-10-12 to develop a detailed specification before implementation. The specification, technical decisions, acceptance test plan and development roadmap are being proposed separately for review.

**Constraint:** Do not require, run, schedule or configure Axik AI Weave, local AI runners or related orchestration for this specification work.

## Core goals

- **Print correctly on the first attempt:** Mixed portrait/landscape documents must use intelligent sheet layout and printer-aware validation.
- **Be quick:** Measure cold startup, interactive first page, scroll smoothness, memory, CPU and actual GPU usage.
- **Protect documents:** Lossless open/save where possible, recoverable autosave, genuine redaction and cross-editor annotation interoperability.
- **Respect privacy:** Process local documents locally by default, without mandatory accounts or cloud uploads.
- **Remain maintainable:** Versioned interfaces, isolated native capabilities, repeatable performance and stability benchmarks.

See the documentation in the proposed specification branch for detailed functional and nonfunctional requirements.
