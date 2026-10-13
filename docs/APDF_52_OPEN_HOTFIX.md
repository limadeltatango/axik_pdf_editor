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


## Second user reproduction — Windows dialog disables its Open button (2026-10-13)

The original v0.1.1 change correctly made the HTML file picker visible,
but the user supplied a screenshot where the **Windows Common Item Dialog's
own Open action is greyed out**. The selector read:

\`\`\`text
Custom files (*.pdf;*.pdf)
\`\`\`

Source code used \`accept="application/pdf,.pdf"\`, causing Windows/WebView2
to build a duplicated PDF-specific filter. This duplicate filter is an
observable source/configuration defect, although it has **not yet been proven**
to be the only reason Windows disabled Open on this user's PC.

### Corrective change: v0.1.2

- On **Windows desktop**, remove the HTML file input \`accept\` attribute entirely
  to use Windows' default "All files" view. This prevents MIME-to-extension
  double expansion and any WebView2-side PDF filter restrictions.
- On **Chromium browser extension**, keep one extension specifier \`.pdf\` only.
- When the chosen file returns, validate PDF filename/type in TypeScript, then
  validate content with PDF.js. An invalid file yields a visible user error,
  leaving any previously loaded document intact.
- Remove PDF-specific filtering from the separate Rust \`rfd\` **Open for Save…**
  dialog too. Native code still checks \`.pdf\`, the canonical user-selected path,
  size and a \`%PDF-\` header after selection, without arbitrary path access.
- Preserve Quick Export, native Save, document recovery and all other editing
  features. Version the Windows installer **0.1.2** instead of overwriting
  v0.1.1 invisibly.

### Regressions and acceptance

CI desktop Vite test explicitly asserts the desktop file input has no
\`accept\` attribute, opens valid one- and two-page PDFs using the real
filechooser event and rejects a selected \`.txt\` without losing the open PDF.
The existing Chromium tests, Windows Rust compile/package and PDF writer tests
must pass too.

**Hardware acceptance remains necessary:** install v0.1.2, navigate to the
actual folder containing a PDF and click its file entry. Confirm that Open is
enabled, the document renders, and Quick Export remains usable. If the button
is greyed out with **All files** selected, the issue is not solely the duplicate
PDF filter; inspect whether the chosen filename exists in the current folder,
whether OneDrive has hydrated the file, and whether the native **Open for Save…**
option behaves differently. Collect diagnostics and report exact behavior
without sharing confidential document contents.

Related Windows/WebView2 file dialogs sometimes behave differently from real
Chrome dialogs, so green headless Chromium CI is necessary but not proof of
this user's OS-level control behavior.
