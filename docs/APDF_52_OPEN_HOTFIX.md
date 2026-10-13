# APDF-52 — Windows Open PDF regression hotfix

**Hotfix build:** Axik PDF Editor desktop 0.1.1, based on Core Alpha 0.1.0.
**User report:** Windows Core Alpha cannot open a PDF after the native Open/Save integration.
**Underlying failure mode:** Not yet independently observed on the user's computer.

## Source-level root-cause candidate

The primary **Open PDF** button was changed to exclusively invoke the new Rust
native Open command when the desktop app supplied \`onNativeOpen\`. The original
HTML file input, which worked in an earlier user-verified alpha, remained in the
DOM but could no longer be reached through the primary button.

That exclusive dependency was a regression in fallback/recovery design.
The separate native dialog's precise failure (blocked UI, missing dialog,
IPC error, file parsing, permissions or document type) is not yet known.
**Do not report a confirmed RFD/WebView2 failure without Windows diagnostics.**

## Hotfix behavior

- **Open PDF** in the Windows desktop always opens the ordinary \`input
  type=file\` chooser. It works as a local PDF viewer/markup file input and
  cannot silently overwrite the source.
- **Open for Save…** is a separate desktop-only action retaining the Rust
  native dialog and source token needed to authorize in-place Save with
  same-folder atomic replacement/backup.
- If native selection fails, the UI shows a visible error and explicitly
  guides the user back to **Open PDF**, **Quick Export**, or **Save As**.
- Browser extension behavior remains unchanged: the user-approved writable
  picker is preferred where available; otherwise its normal file input remains.
- The native printer/Save backend, callouts, annotation round-trip, page tools
  and telemetry are retained without adding any runtime Weave dependency.
- Desktop installer version is incremented to **0.1.1** to distinguish it
  from the defective **0.1.0** installer.

## Regression validation

A real Chromium browser test mounts the **desktop frontend** via Vite with
\`onNativeOpen\` defined, clicks the main **Open PDF** button and waits for an
actual **filechooser** event. It opens a one-page PDF, then a two-page PDF and
checks the filename, page count, document canvas and absence of JavaScript
exceptions. It also verifies the separate **Open for Save…** button exists.

This test would fail against the previous implementation, where Open PDF called
the native command directly instead of emitting a filechooser.

The existing extension tests, TypeScript checks, unit tests, Chromium build
and Windows desktop NSIS build are also required. Successful CI is **not**
a substitute for interactive Windows/WebView2 acceptance.

## User acceptance

Install the **0.1.1** hotfix only after successful Windows CI packaging.

1. Click **Open PDF**, choose a small nonconfidential PDF and confirm it renders.
2. Repeat with a multi-page PDF; verify navigation and quick export.
3. Try a landscape or drawing PDF, inspect its orientation and rendering.
4. If needed, separately try **Open for Save…**; if it fails, continue using
   the primary Open PDF. Report whether native dialog appears or displays an
   error, and export the diagnostic ZIP.
5. Avoid overwriting production drawings until native Save is independently
   qualified.

Jira: https://axikai.atlassian.net/browse/APDF-52
