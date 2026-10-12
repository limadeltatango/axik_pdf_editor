# Synthetic PDF print fixtures

The fixture generator is source-controlled but **has not been executed as part
of foundation work**. It creates four small PDFs with page labels, asymmetric
corner markers and deliberate page orientation/size variations. It does not use
customer construction documents, AI runners, GitHub Actions or Weave.

After the later testing phase is authorized:

- node tools/generate-print-fixtures.mjs
- Validate fixture output with two independent PDF parsers/renderers.
- Compare logical PrintPlan transforms to rendered sheet previews.
- Physically print on at least two different printer/driver combinations,
  including duplex and fixed-stock portrait/landscape interleaving.
- Measure Arch D scaling or preflight blocks; do not waste large media on
  unqualified drivers.
- Add regression fixtures for page UserUnit, negative coordinates, old PDF
  revisions, nested rotation, transparency and per-page stock selection.

**Important:** These are deliberately simple PDFs, not proof of fidelity for
real-world architecturals, vector drawings, forms or hostile content. The
generator produces test inputs; it does not prove printer behavior.

Generated output goes in test/fixtures/generated/ and should not be committed
until validated.
