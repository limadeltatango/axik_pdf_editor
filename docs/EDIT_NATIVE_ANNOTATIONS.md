# Reopening and editing saved PDF annotations — APDF-22

**State:** Alpha implementation and interoperability regression tests; no production acceptance yet.

## Current scope

When Axik reopens a PDF it produced, it reads native PDF annotations marked
with the author \`Axik PDF\` and stable \`/NM\` IDs from actual PDF dictionaries:

- PDF FreeTextCallout: text, \`/IT\` callout intent, \`/CL\` leader and elbow,
  \`/Rect\`, \`/RD\` textbox inset, \`/LE\` ending and approximate appearance styling
- PDF FreeText: added text box, rectangle, contents and font size
- PDF Text annotation: sticky-note/comment content and placement

Existing annotation objects are considered **part of the saved original**, not unsaved edits.
If the user changes text or a callout, export replaces the matching **Axik-owned**
annotation object; if they remove it, export deletes precisely that stable ID.
Unchanged objects are never resynthesized. Foreign/unknown annotation dictionaries
remain untouched rather than being coerced into Axik's limited editor model.

## Explicit safety boundary

- This does **not** edit text already embedded in the underlying PDF page's
  content stream. APDF-47 still needs a separate font-aware, content-stream
  editing engine.
- Source \`/NM\` names must be stable, unique and Axik-owned. Ambiguous or absent
  references fail closed or remain read-only. The writer refuses attempts to
  impersonate imported IDs or change a non-Axik annotation.
- The open view may still display an imported annotation's saved PDF.js appearance
  while a faint editable overlay is active. Newly changed imported annotation
  previews may not be pixel-perfect until export/reopen, especially for long
  Unicode text and transparency; that requires the future unified appearance renderer.
- The writer creates a full derived PDF in memory and returns its bytes to
  **Quick Export**, guarded Save/Save As, Pages and Print preparation. It
  does not silently mutate source document bytes.
- Original third-party comments, embedded fields, drawing resources and custom
  annotation metadata may remain in the PDF but cannot necessarily be edited
  through the current Axik sidebar.
- Native PDF digital signatures may be invalidated by subsequent PDF writes.

## Validation

- Unit tests create callouts, text boxes and sticky notes, save them into an
  actual PDF, reopen them as editable objects and verify that an edit leaves
  the same number of native annotations.
- Deleting imported objects removes only their \`/NM\` entries.
- Third-party annotation objects remain in the document unmodified.
- Chromium integration opens a PDF, creates/exports a callout, reopens it,
  edits the label in the sidebar, and reexports without creating duplicates.
- Real Acrobat/PDF-XChange editable interoperability, annotations with malformed
  appearance streams and real-world signed/form PDFs remain untested.

## Next stages

1. Independent Acrobat/PDF-XChange editable text/callout/notes interoperability.
2. Persistent high-fidelity styling and exact appearance streams with arbitrary
   embedded fonts and Unicode.
3. Proper PDF.js layered editing so imported annotations have one editable
   WYSIWYG appearance, not an overlay in front of a prior saved appearance.
4. Selection, move, resize and arrow-tip/elbow manipulation for imported objects.
5. Bring *supported* third-party annotation subtypes into a standards-safe
   editing model without losing unknown dictionary properties.
