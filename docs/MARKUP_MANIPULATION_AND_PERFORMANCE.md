# Axik PDF Editor v0.1.3 — Markup Controls & Performance Slice

**Work items:** [APDF-56](https://axikai.atlassian.net/browse/APDF-56),
[APDF-57](https://axikai.atlassian.net/browse/APDF-57).
**Base:** v0.1.2 hotfix / usability draft PR #13.
**State:** implemented source with passing Chromium unit and browser integration
tests on initial commit; latest version and Windows package require build validation.
**No automatic release/merge.** App remains alpha.

## Practical UX: callout and text-box manipulation

Select the **Select** tool, then click a callout or text annotation.
Selected markup shows context controls:

- **Drag its text box:** move independently; an already positioned leader
  tip and custom elbow remain fixed. Attachment point follows the box edge.
- **Four box-corner circles:** direct resize; opposite corner stays stationary
  where possible, with minimum dimensions and CropBox clamping.
- **Callout arrow-tip circle:** move target to the actual fixture, object
  or drawing detail, independently from text and elbow.
- **Callout elbow circle:** reposition leader bend independently. Even straight
  two-point leaders acquire an editable elbow when first dragged.
- **Keyboard navigation:** focus a grip and use Arrow keys (one PDF point)
  or Shift + arrows (ten points), with a visible focus outline.
- **Escape:** cancel active pointer gesture. Pointer cancellation also discards
  uncommitted geometry. A completed drag creates exactly **one Undo entry**;
  preview frames themselves are not entered in edit history.

Geometry stays in PDF points, uses PDF.js inverse page transform for rotated,
cropped and zoomed pages, and enforces bounds. The exported native
FreeTextCallout PDF writer updates /CL, /Rect, /RD and /AP streams as appropriate.
The original is preserved when using Quick Export.

### Intentional gaps

Box resizing uses corner grips, not edge-middle grips yet. Color/font presets,
line leader ending styles, snapping/alignment, auto-avoid covered plan text,
automatic leader routing, free-form shape clouds and multi-select are future
options. The current system does not interpret source engineering drawings.

## Performance and latency guardrails

1. Continuous scroll uses binary search over page row offsets (roughly
   O(log N) geometry reads rather than O(N) bounding-box checks per frame).
   Pages remain native scroll elements and lazy canvas placeholders; 10 live
   page canvases is still the structural resource cap.
2. PDF.js canvas backing allocation stays at or below 16 megapixels per page,
   including architectural sheets and high-DPI displays. This is an editing
   viewport budget, not high-resolution plotting.
3. The existing app-level first-page-painted numeric telemetry is retained,
   along with bounded local error histories.
4. A new **200-page browser integration benchmark** measures open-to-first
   painted page, continuous mode entry, explicit far-page navigation,
   two-up mode change and canvas count. Timing observations are printed to
   GitHub Actions job logs as \`APDF_57_CI_SYNTHETIC_METRICS\`. Synthetic timings
   on a shared GitHub Linux runner are *trend data*, not measured user Windows
   startup SLOs or GPU vector-rendering claims.

### Initial synthetic CI observation (2026-10-14)

Observed on [Chromium run 38594504304](https://github.com/limadeltatango/axik_pdf_editor/actions/runs/38594504304):

| Metric | Observed |
|---|---:|
| Shell / initial viewer readiness | 198 ms |
| 200-page PDF Open to first rendered page | 278 ms |
| Switch to continuous | 42 ms |
| Jump to page 190 | 112 ms |
| Switch to two-page continuous | 47 ms |
| Live canvases after stress sequence | 5 |
| Maximum backing pixels of measured canvases | 484,704 |

These are single-run synthetic observations and were not repeated 30+ times
on H2 Windows hardware. They are **not** stable P95 latency claims. Actual
startup-to-*first usable markup manipulation*, hardware GPU/CPU tracing,
memory resident set, event-loop long tasks and 200-page full-scroll FPS
measurements are still unverified. Don't compare these numbers to Acrobat
using different hardware/fixtures.

## Testing and acceptance

- Unit tests cover move, leader tip, straight-to-elbow conversion, resizing
  every corner, page CropBox, minimums, inverse rotated viewport transform,
  keyboard nudging, Undo and native /CL /RD /AP round-trip.
- Chromium E2E checks selected SVG grips, pointer interaction, Undo/Redo and
  saved PDF annotation dictionaries. The synthetic large-set test enforces
  <=10 live raster canvases while jumping and scrolling through 200 pages.
- Windows packaging is a compile/package gate, **not real Windows interactive
  validation**. Run with a dense reflected ceiling plan and a crowded keynote
  detail to assess arrow placement, box readability and overlap.
- Keep high-DPI, /Rotate 90/180/270 and CropBox offset acceptance fixtures,
  multiple pages/zoom presets and PDF-XChange interoperability in the user
  hardware matrix. Drag performance should be responsive and inputs should
  never lock the UI.
- Failures are recorded as content-free diagnostic codes; no PDF content
  or user filenames are logged.

## Remaining core requirements

The usability work does not make the entire product feature-complete. True
editing of existing underlying PDF text (APDF-47), secure physical direct
Windows print spooling, independent PDF-XChange interoperability, correct
irreversible redaction, visual-signature acceptance, and GPU raster/tiling
performance qualification remain on the APDF board. Revision Manager
continues to be deferred.

Current backlog:
https://axikai.atlassian.net/jira/software/projects/APDF/boards/39
