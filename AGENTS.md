# Axik PDF Editor — Repository Development Rules

## Project identity and work tracking

This repository is the sole home for the **Axik PDF Editor** product: a Windows-first
desktop application and a Chromium Manifest V3 extension sharing a PDF editing core.
The authoritative issue backlog and acceptance criteria are in
[APDF](https://axikai.atlassian.net/jira/software/projects/APDF/boards/39).
Do not create or track PDF Editor features under WEAV, MOSV, BuildAxis or OpenStorage.

Source code is authoritative for actual implementation; GitHub PR/check histories
are authoritative for code review and build/test results. Jira records the status
of work and decisions. Always link substantive PRs/commits to the appropriate
APDF issue; explain what changed, what was tested, what failed and what remains.

Draft branch ordering as of 2026-10-12:
1. PR #1 spec/desktop-chromium-v0.1 -> main (draft).
2. PR #2 feat/foundation-phase-1 -> spec/desktop-chromium-v0.1 (draft).
3. PR #3 feat/local-diagnostics-support-bundle -> feat/foundation-phase-1 (draft).

Do not merge or claim release-readiness from source-only commits without required
verification and explicit review. Avoid silently changing a PR's base.

## Weave development authorization

The owner authorized use of **Axik AI Weave** for development and validation on
October 12, 2026, Eastern time, superseding the prior temporary prohibition.
This authorization does NOT make Weave part of the PDF Editor application's
runtime, installer, document storage or telemetry collection.

Weave owns host admission, runner provision, local AI runtime management and
Gaming/Pause/resource-suspension policy. Never implement these in this product.
When Weave is configured and reachable, use its actual supported interfaces,
capability labels and JIT runners. Do not invent a Weave endpoint or report
scheduler placement as a running or completed job. If unavailable, state the
limitation; avoid sending the same job through unmanaged runners.

The user's PC and gaming/personal use outrank background development jobs.
Avoid involuntary compute workloads, GPU reservation or resident model services.

## Mandatory functional and quality gates

- **Intelligent printing:** fixed-stock mixed portrait/landscape placement must be
  correct without manual page-by-page orientation; output verified on actual
  printer/driver classes, including duplex and oversize media.
- **GPU and performance:** progressive first page, fast startup, bounded memory,
  composition-vs-raster measurement and software fallback; "GPU accelerated"
  requires observed evidence, not a composited browser window.
- **PDF interoperability:** native FreeTextCallout CL/IT and correct AP streams,
  comments/markup preservation and independent Acrobat/PDF-XChange checks.
- **Redaction:** do not label an opaque rectangle as secure redaction. Content
  removal, full rewrite and zero-leak independent verification are release gates.
- **Document safety:** never overwrite a PDF silently. Preserve original on failed
  writes, crashes, unsupported PDFs and interrupted operations.
- **Chromium security:** no blanket host access, auto URL hijacking, remote JS or
  unsafe native RPC. User-approved permissions and companion operations only.

## Diagnostics: APDF-38 and children

Local, bounded, user-exportable support ZIPs are required early. Keep diagnostics
usable without Weave, accounts, internet, or a working PDF file.

Diagnostic event payloads are explicitly whitelisted: fixed event codes, areas,
severity, timestamps, random session IDs, numeric measures and bounded error
*types*. Never collect file contents, PDF text, filenames, paths, URLs, annotation
text, passwords, document fingerprints/hashes, raw error messages, stack traces
or screenshots via the automatic event recorder.

Store at most 600 events/session, 8 recent sessions and 7 days' history when the
app is used. Recording is local; users must be able to disable and clear it.
The export ZIP is created **only on explicit user action**, with optional system
information and separately opt-in identifiable GPU details. Users inspect and
upload the ZIP manually. No cloud telemetry service or automatic transmission.

Future native crash dumps, printer drivers/system logs or document reproduction
capture are separate security-sensitive features requiring explicit opt-in and a
documented redaction/preview policy.

See [Diagnostics documentation](docs/DIAGNOSTICS.md),
[Quality gates](docs/QUALITY_AND_TESTS.md) and
[Foundation status](docs/FOUNDATION_IMPLEMENTATION_STATUS.md).

## Before marking work Done

Record the actual executed tests and their results. A file authored in GitHub
without install/build/typecheck is **coded but unverified**. A local test that
passes without real printer or cross-editor validation is not an accepted
hardware/interop release gate. Keep missing tests visible in APDF.

Avoid exposing customer documents, access tokens, source PDFs, personal file
paths or sensitive report content in PRs, fixtures, telemetry or logs.
