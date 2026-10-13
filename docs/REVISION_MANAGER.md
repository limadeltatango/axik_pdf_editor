# APDF-44 — Drawing Revision Manager v0.1

**State:** Product architecture and non-destructive contract only; **not implemented**.
**Priority:** After safe Save/Save As, print engine and text/object editing reach acceptable reliability.
**Owner:** APDF Jira project, [APDF-44](https://axikai.atlassian.net/browse/APDF-44).
**Existing foundation:** [Chromium/desktop alpha PR #4](https://github.com/limadeltatango/axik_pdf_editor/pull/4).

## Product vision

Take a construction PDF sheet or drawing set (such as an electrical or reflected ceiling plan), propose changes (e.g. add a light fixture), annotate them, send them for review, record the decision, and incorporate **only approved changes** into a controlled new PDF revision. The baseline/original remains intact and traceable.

A change proposal is different from a normal annotation and different from a verified design revision. A proposed light fixture symbol on the PDF is not yet an instruction to build, an approved code-compliant design, a subcontractor change order, or an alteration of the CAD/BIM source model.

## Non-negotiable source protection

- Baseline PDF is **read-only** for the lifetime of the proposal. A revision cannot call the ordinary overwrite command on it.
- A new **immutable version** is created at each incorporated revision: baseline V0 → approved V1; never modify V0 in place.
- Every markup/edit is associated with one proposal and a specific baseline PDF checksum, sheet identifier and page coordinates.
- A proposed revision can be updated/replaced before approval, but an approved/incorporated revision's audit trail cannot be silently edited or discarded. Corrections are append-only events or a superseding proposal.
- Existing, unrelated drafts, submitted proposals and rejected proposals are **not** merged into a revised sheet.
- A newly issued plan that differs from the baseline must trigger an explicit rebase/compare, not silently move markups to possibly shifted sheet coordinates.
- Offline-first: maintain version records and exportable review packages locally; no mandatory cloud, accounts, Weave or BuildAxis integration.

## Suggested workflow

1. **Establish baseline:** select original PDF and optionally drawing set, project, sheet IDs, plan version/date; record hash, page boxes/rotation and accessible labels.
2. **Create proposal:** enter revision title/reason, sheet(s), and author; automatically assign a stable proposal ID scoped to drawing set. Proposed markup layer is separate from other annotations.
3. **Author changes:** add PDF comments/callouts, typed text, graphic arrows, revision clouds and symbols (e.g. a light fixture icon). Attach structured notes and a proposed dimension or trade category where relevant.
4. **Review package:** use Quick Export into a new PDF with **PROPOSED — NOT FOR CONSTRUCTION** visible status; attach a simple change schedule and proposal ID, baseline reference and export date. Keep a JSON sidecar manifest for lossless round-trips; never require the recipient to have Axik installed.
5. **Decision:** an explicit reviewer (named, typed role) records Approved, Rejected or Changes Requested with date/time and optional PDF/email reference. This records user-entered provenance, **not cryptographically verified identity**.
6. **Incorporate:** only Approved proposals can be promoted to a **new** controlled PDF revision. Clearly distinguish a graphical incorporation (approved markup embedded in an issued PDF) from an updated design originating in CAD/BIM. Preserve parent version, linked approval and proposal ID.
7. **Close:** mark Incorporated after saving and validating the revised PDF and registering the new version. Rejected proposals remain in history but never appear in the issued revision. Superseded versions stay retrievable.
8. **Distribute:** controlled PDF, revision change register and original baseline reference; do not silently call the result a sealed plan or construction directive.

## Candidate state model

\`\`\`text
Draft ──> Submitted ──> Approved ──> Incorporated
  │           │             │
  │           ├──> Changes Requested ──> Draft (new attempt)
  │           └──> Rejected
  └──> Withdrawn

Any active proposal ──> Superseded (requires explicit reason).
\`\`\`

A decision event is immutable once recorded; a new decision must supersede it rather than editing the prior review record.

## Proposed data contracts (schemas to implement separately)

\`\`\`ts
type ProposalState =
  | "draft" | "submitted" | "changes-requested" | "approved"
  | "rejected" | "withdrawn" | "incorporated" | "superseded";

interface PlanVersion {
  id: string;
  drawingSetId: string;
  revisionLabel: string;
  sourcePdfSha256: string;      // Project storage only — NEVER diagnostics telemetry
  pageIdentities: Array<{
    sheetId: string;
    pageIndex: number;
    mediaBox: [number, number, number, number];
    cropBox?: [number, number, number, number];
    rotate: number;
  }>;
  derivedFromVersionId?: string;
  sourceAuthority: "pdf-only" | "cad-coordination-pending" | "cad-source-confirmed";
  createdAt: string;
}
interface ProposedRevision {
  id: string;
  baselineVersionId: string;
  title: string;
  reason?: string;
  state: ProposalState;
  editedObjectIds: string[];
  affectedSheetIds: string[];
  events: Array<{
    eventId: string;
    type: string; // fixed enum in implementation
    actorLabel: string;
    timestamp: string;
    notes?: string;
    attachmentRefs?: string[];
  }>;
  incorporatedVersionId?: string;
}
\`\`\`

These types describe future **project data**. They are not implemented code, and document checksums must never enter diagnostic bundles.

## Required business rules

- **Approval gating:** Only an approved proposal with matching baseline content may be incorporated.
- **Incorporate ≠ direct overwrite:** revision issue has a new PDF file name and revision ID, even if ordinary documents may use Save to overwrite.
- **PDF-only edit warning:** do not represent a PDF overlay/light-fixture symbol as updated native AutoCAD/Revit model content. Require coordination when source drawings exist.
- **Revision history:** every version has a timestamp, source content hash, parent ID and list of included approvals; export history separately with no reliance on PDF comment text alone.
- **Conflict detection:** stale drawings, moved page coordinates, changed scales and overlapping proposals require review.
- **Record privacy:** project data is stored locally and excluded from telemetry unless explicitly included as a user-approved support attachment.
- **Shared editing model:** use native standard PDF annotations and authoring commands; never flatten proposal annotations prematurely without user consent.

## Not part of foundation or current prototype

- An automated approval service, email approval authenticity, legally enforceable signatures, change order approval, construction contract authorization.
- Native DWG/RVT/IFC model edits.
- Real-time multiplayer revision collaboration, cloud project hosting.
- Automatic interpretation of a light fixture symbol as an electrical engineering design change.

## Dependencies and order

1. **APDF-45** — deliberate Save/Overwrite, Save As, Quick Export, backup and baseline protection.
2. **APDF-18/19/20** — sheet-accurate preview, Windows print spooler and physical mixed-orientation printing.
3. **APDF-46/47** — text additions, document object fidelity and appropriate existing-text editing.
4. **APDF-48** — immutable baseline/revision manifest, state machine and migration design.
5. **APDF-49** — proposal authoring and review packages.
6. **APDF-50** — decisions and approved-only incorporation.
7. **APDF-51** — compare/overlay, sheet revision register and change tracking.

Acceptance requires synthetic fixtures, actual construction drawing sample(s) that are nonconfidential, manual approval-path tests, original-byte preservation, and round-trip verification across Acrobat/PDF-XChange and Axik. This is **planned**, not feature parity claimed.

## Design rationale

Revision Manager is a workflow product above a dependable PDF editor, not a rewrite of the PDF format. Shipping it before real saving, printing and text editing would create confusing partial approvals and risk accidental corruption of original drawings.

[APDF backlog](https://axikai.atlassian.net/jira/software/projects/APDF/boards/39) is authoritative for work status and acceptance.
