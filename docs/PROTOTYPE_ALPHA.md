# Axik PDF Editor — Alpha Prototype Instructions

**Date:** 2026-10-13  
**Tracking:** [APDF-43](https://axikai.atlassian.net/browse/APDF-43)  
**Code:** [feat/prototype-alpha-20261013](https://github.com/limadeltatango/axik_pdf_editor/tree/feat/prototype-alpha-20261013)  
**CI:** [Chromium prototype runs](https://github.com/limadeltatango/axik_pdf_editor/actions/workflows/prototype.yml)  
**Windows CI (experimental):** [Windows installer runs](https://github.com/limadeltatango/axik_pdf_editor/actions/workflows/windows-prototype.yml)

## Try the Chromium extension

1. Download the latest successful **axik-pdf-chromium-prototype** artifact from the CI run. GitHub wraps it in an outer ZIP; extract it, then extract the included \`axik-pdf-chromium-prototype.zip\` into a permanent folder.
2. Navigate to \`chrome://extensions\` or \`edge://extensions\`.
3. Enable Developer mode, then **Load unpacked** and select the extracted folder containing \`manifest.json\`.
4. Pin the toolbar icon and click it to open the editor.
5. Open a **copy** of a non-sensitive PDF with **Open PDF**, or drag a PDF into the application.
6. Select **Callout ↗**, click the spot to point at, then edit the label from the Comments & markup sidebar. Use Undo/Redo if needed.
7. Click **Export edited PDF**. This downloads a **new** file named \`<original>-axik-edited.pdf\` rather than overwriting the source. Reopen the result in any PDF viewer to inspect appearance.
8. Click **Layout preview** to inspect a calculated sheet orientation/scale layout. This alpha does **not** yet send physical print jobs or guarantee mixed-paper driver behavior.
9. Click **Diagnostics**, optionally include environment/GPU characteristics, and export a local ZIP when reporting a problem. No PDF contents are uploaded.

### What is implemented

- PDF.js rendering, one visible page at a time, zoom, page navigation.
- Native FreeText/FreeTextCallout annotation dictionary writer with \`/CL\`, \`/IT\`, \`/RD\`, \`/AP\` via \`pdf-lib\`. This is a **prototype** serializer: Acrobat/PDF-XChange round-trip editability still needs verification.
- Selected callout text editing, local IndexedDB drafts, undo/redo.
- A separate, bounded source-PDF writer with explicit failures rather than fake save.
- Fixed-stock logical page orientation and scale planning with warnings.
- Local structured errors/performance metrics, seven-day/8-session retention intentions and manual ZIP export. No automatic upload.
- Browser extension without mandatory desktop install, with optional per-site user permission for explicit PDF links.

### Alpha limitations (important)

- Use copies, not production originals, confidential documents or contract-critical sign-offs.
- Callout appearance is based on Helvetica WinAnsi and may replace unsupported glyphs visually with \`?\`; original callout text is retained in \`/Contents\`.
- Very long labels may be clipped in the visible box. The native dictionary remains editable in standards-aware tools, subject to interoperability testing.
- The current appearance stream draws leader lines and simple arrowheads but is not a full PDF-XChange callout clone.
- Callout geometry can be created by clicking; dragging/repositioning box/elbow is not yet in this alpha.
- Existing imported callout annotations may display but are not yet exposed as editable objects in the Axik sidebar.
- Edited output up to 100 MiB input/1000 callouts; no secure redaction, stamps, real signatures, OCR, form editing or production print engine.
- Native GPU PDF rasterization is **not** proven. Chromium may GPU-composite the canvas, but hardware traces, tiled rendering and driver reset tests are future acceptance gates.
- Diagnostic ZIP/annotation storage need real-world crash/quota/performance testing.
- On Windows, a self-generated **unsigned** installer may produce Windows SmartScreen warnings, and user installation should be limited to trusted testing machines. Do not disable OS security settings solely to run the alpha.
- There is no automatic updating, no remote cloud processing, and no runtime dependency on Axik AI Weave.

## Reproducing a problem

Describe what you did, which feature failed, and whether the PDF opened or saved correctly. From Diagnostics, download the ZIP and attach it to the APDF Jira issue or the ChatGPT conversation. The ZIP intentionally excludes PDF bytes, document names, paths and full error messages; if a PDF fixture would help, attach a nonconfidential reproduction document **separately** and only when you choose.

## Developer validation (non-Weave-compatible)

The repository has an isolated GitHub Actions validation workflow on this branch:

- \`pnpm install --no-frozen-lockfile\`
- \`pnpm typecheck\`
- \`pnpm test\` (including pdf-lib native annotation dictionary round-trip, print geometry, ZIP format)
- \`pnpm build:extension\`
- \`node tools/check-extension-package.mjs\` (MV3/package integrity)
- Chromium extension end-to-end smoke test (browser loaded, PDF imported, callout added, new PDF exported and parsed, reopened)

These are *checks to be run*: only the individual workflow logs prove which ones passed. Do not infer all were successful from the presence of code alone.

A separate Windows-hosted workflow attempts unsigned Tauri/NSIS installation packaging, if current dependencies and build resources permit. The GitHub Actions workflow is not the Axik Weave scheduler, and product binaries operate independently of it.
