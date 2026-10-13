# APDF-32 — Visual, non-certified PDF signing

**Implementation branch:** feat/apdf-32-visual-signatures
**Status:** Alpha / external compatibility validation pending

## Basic workflow

1. Open a PDF and click Visual signature.
2. Draw with mouse, touch or stylus on the signature pad.
3. Click Use signature, then click on the target location on the PDF.
4. Quick Export or Save as a new PDF; ink is persisted as native PDF Ink subtype, InkList, and AP appearance stream.
5. Axik-authored Ink entries can be recognized and displayed again on reopening.

This is a visible handwritten mark only. It does not certify signer identity, digitally sign the PDF, generate a tamper-proof approval, apply trusted timestamps, or add a PDF cryptographic signature field.

## Privacy and limits

The drawing is stored as normalized vector strokes with bounded complexity (50 strokes, 10,000 points). No remote signing server or biometric analysis. The current general document recovery system saves edits locally in IndexedDB and may retain the visual signature until drafts are cleared; the source and draft should be considered sensitive. No reusable signature library is created and no automatic upload is performed.

## Validation and next steps

Unit test the PDF Ink annotation geometry and absence of signature form fields. Browser test draw with pointer input, place on PDF and Quick Export, then parse InkList and appearance dictionary. Test rendering, DPI, crop rotation, Windows installer and interoperability with Acrobat/PDF-XChange before acceptance.

Direct Windows printing, physical output, actual existing page-text stream editing, secure redaction, and GPU profiling remain separately tracked under APDF.
