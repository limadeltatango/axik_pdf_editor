# Core editor usability & performance contract

**Scope:** APDF-53 draggable markups, APDF-54 viewing layouts, APDF-55 time-to-interact
and all future core features. First drafted 2026-10-14 after owner feedback.
**State:** Implementation under review; targets are design/QA acceptance criteria,
**not yet proven on real Windows desktops or actual construction drawing sets**.

## 1. Product priority

Usability and performance are equal, first-class gates alongside PDF output
correctness, privacy and document safety. "Feature is in a toolbar" is NOT
equivalent to "feature is usable." Every new feature should ship with:

- A sensible, discoverable default and at least one appropriate alternate way
  to use it (direct manipulation, keyboard navigation, explicit control).
- Clear indication of the current mode, document/page location, pending edits,
  and whether the action affects the original or a new copy.
- Accessible labels, focus affordances, Escape/cancel, undo where applicable,
  and discoverable disabled/error states.
- A path for common operation on both small one-page PDFs and large building
  plans (200+ mixed sheets, OCR scans, architectural page sizes).
- Deterministic regressions *and* a responsive real Windows user test;
  no claims about performance from synthetic single-page PDFs alone.
- No mandatory background startup work, AI service, Weave runner,
  network request or extra account to open and work with a PDF.

## 2. Markup options

| Operation | Primary interaction | Secondary |
|---|---|---|
| Add a callout | Callout tool, click target on drawing | Text edit in Comments & Markup |
| Move callout text box | Drag box in Select mode | Focus box and arrow-key nudge (Shift = 10 PDF pt) |
| Preserve arrow target | Move box only; arrow tip stays fixed | Undo returns to exact previous position |
| Change box font size | Comments sidebar number input | Saved/Quick Export native FreeTextCallout |
| Move new text box | Direct box drag | Keyboard nudge |
| Leave a comment | Comment tool and sidebar editing | Saved native Text annotation |
| Recover canceled drag | Escape / pointer cancellation | Drag never creates multiple undo entries |

**Boundaries:** Callout leader *tip* movement, resize handles, elbow repositioning,
style palettes, fill opacity, annotation templates and batch selection remain
separate follow-up improvements, not falsely implied by box dragging.
Dragging must respect visible CropBox and 90/180/270-degree transforms.

## 3. Viewer options

| Mode | User purpose | Rendering policy |
|---|---|---|
| Single Page | Focused detailed editing | One rendered page at a time |
| Continuous Scroll | Review plan set vertically | Virtualized; at most 10 live pages; offscreen placeholders |
| Two-Page Spread | Compare two sheets or book layout | One pair only; optional cover-alone |
| Two-Page Continuous | Browse facing pages across a set | Virtualized spreads, <=10 live page canvases |

Controls: view selector, optional Cover alone toggle in two-page modes,
Go to Page, Previous/Next (previous/next spread in two-up), zoom ±, Manual,
Fit Width and Fit Page (down to 10% for large ARCH sheets).
PageUp/PageDown, Home/End and click-to-select annotations should work
without surprising scroll resets. View preferences are local-only, small,
and do not include any PDF filename, location or contents.

**Progressive rendering:** First visible pages are requested immediately; offscreen
pages are only placeholders. The app must not call \`getPage\` or rasterize all
200 pages just to show page 1. The viewer schedules no more than 10 actual page
canvases at once. When an offscreen page drops out of the window, its canvas
is removed and any in-progress task is canceled; page source bytes remain
with the PDF.js worker.

**Raster budget:** Each page raster backing buffer is capped to 16 megapixels,
including high-DPI desktop environments. Use the appropriate PDF.js render
transform so CSS/PDF page coordinates and annotation hit targets remain exact
while backing resolution is bounded. Very large print jobs use a distinct print
backend and should not reuse the editor-view pixel budget blindly.

## 4. Proposed quantitative acceptance

The existing \`QUALITY_AND_TESTS.md\` includes initial goals for time to
interact, open-to-first-visible-page, scrolling FPS and input latency.
Treat these as goals until measured on reference Windows H1/H2/H3 machines.

Measure and record the following **without logging document names or text**:

- Navigation to interactable shell after launch; compare cold vs warm starts.
- PDF Open action to first canvas fully painted and markup tools responsive.
- Drag movement acknowledgement and committed history entry.
- Document scrolling P50/P95 frame time and viewport memory after many pages.
- Zoom changes and mode switches; no full-document rebuild on every scroll.
- Synchronous main-thread tasks over 50/100 ms.
- Time for undo/redo, Quick Export, reopen/re-edit.

Repeat against representative mixed-orientation plans including A/E-sized
technical drawings, a 50-page PDF and a 200-page set, both GPU acceleration
enabled and disabled. A Chromium compositor is NOT proof of GPU PDF raster.

## 5. Regression validation

Unit:
- Preserve leader tip under drag, clamp box to CropBox, rotate viewport map,
  keyboard nudge, undo/redo as one commit per move.
- Two-up grouping with and without cover page, zoom-fit on large sheets,
  fixed maximum active canvases and bounded pixel buffer allocation.

Browser integration:
- Pointer drag moves the box and leaves leader tip fixed; keyboard nudge works;
  export stores new native /CL and /Rect; Undo returns original box.
- 80-page synthetic PDF in Continuous and Two-Page Continuous shows <=10
  simultaneous canvases while scrolling/jumping to distant pages.
- Existing viewer tests continue to pass after changes.

Windows acceptance:
- Test a real drawing with dense text: position leader on intended object and
  drag label away from legend/dimensions, export and reopen in PDF-XChange.
- Exercise mouse pointer capture outside the box, high-DPI monitor, cropped and
  rotated sheets, Escape cancellation and keyboard-only navigation.
- Measure real CPU/GPU use, startup P50/P95 and interactions. Resolve any
  viewport stuck/scroll jumps. Do not promote to released until accepted.

## 6. Next usability decisions (not yet implemented)

1. Editable leader-tip/elbow, box resizing and smart auto-placement to avoid
   underlying plan text and avoid covering dimension leaders.
2. Pan tool/middle-mouse drag, fit selection, rotate view independently of
   physical page operations, bookmarks/outlines, thumbnail navigation.
3. Search-with-next/previous, split-pane comparison of unrelated PDFs,
   revision overlays and synchronized scroll/zoom in comparison mode.
4. User-configurable keyboard shortcuts, persistent session tabs, customizable
   toolbar, printer presets and optional side panel widths.
5. Tile virtualization for very large sheets, GPU upload/compositing
   instrumentation and accelerated-versus-CPU renderer qualification.

Backlog: https://axikai.atlassian.net/jira/software/projects/APDF/boards/39
