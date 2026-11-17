# InkScribe Diagram Blocks · D1 Contract

Date: 2026-11-17. This document covers **D1 (contract + flow rendering)** and **D2 (template insertion + parameters)** from the InkScribe Diagram v0.1 specification. D3's interactive shape editor is still planned.

## Model

An optional note.diagrams array contains at most two blocks. Existing documents without this field work unchanged. Every block has a required zero-based afterSection index pointing to an existing note.sections item and an optional 0–40-character plain-text caption.

Diagram blocks use exactly one representation:

- Template mode: template plus params, with NO primitives field.
- Assembly mode: a nonempty primitives array (maximum 40 elements), with NO template or params fields.

The unused form must be omitted, not assigned null. The editor preview, published note viewer and PNG exporter share the same NotePage SVG DOM. The gallery listing is still text-only; its individual published note pages render diagrams.

Coordinates use a normalized 1000 × 750 (4:3) SVG viewport: x is 0–1000, y is 0–750. Note that the example y=800 from the initial product spec was out of bounds. Supported primitives: line, arrow (including optional double-headed flag), polyline, rect, circle, ellipse, arc and label. Line and arrow take from/to coordinate pairs, rectangle takes at/width/height/optional rotation, circle center/r, ellipse center/rx/ry, arc center/radius/startDeg/sweepDeg and optional label, text label at/text. All labels must be nonempty, at most 40 characters, and all shapes must fit the canvas.

Optional handDrawn defaults true; jitterPx defaults 1.2 (accepted range 0–3, 0.1 increments). Only lines and outlines receive deterministic seeded jitter; arrows and angle arcs remain geometrically precise. Ink, paper, and the current handwriting font come from the containing note, with no opaque white illustration background.

## Template parameters

| template | params | bounds |
| --- | --- | --- |
| inclined-plane | thetaDeg, friction | thetaDeg 5–60 degrees, friction boolean |
| right-triangle | legRatio | 0.25–4 |
| number-line | start, end, step | values -1000 to 1000, end > start, step >= 0.1 and <= 19 tick marks |
| coordinate-plane | grid, quadrants | grid boolean; quadrants is all or first |

Templates expand into deterministic primitives at render time. Edits in D3 will materialize primitives; D1 never converts or changes the stored template parameters.

Example optional field in a note with at least two sections:

    "diagrams": [
      {
        "afterSection": 0,
        "caption": "斜面上的重力分解",
        "template": "inclined-plane",
        "params": { "thetaDeg": 30, "friction": false }
      },
      {
        "afterSection": 1,
        "caption": "",
        "primitives": [
          { "type": "arrow", "from": [120, 650], "to": [460, 650], "label": "x" },
          { "type": "label", "at": [500, 120], "text": "N = mgcosθ" }
        ]
      }
    ]

No schema version bump is needed (schemaVersion remains 1). The existing JSON publishing CLI transmits this optional field unchanged. POST /api/v1/notes/validate returns HTTP 422 with error.issues containing path/code/message for invalid geometry, out-of-range parameters or incorrect section associations. Publication stores the exact authored block. Read-only published pages and local drafts preserve it.

## Layout and future gates

- DiagramBlockView is rendered from SectionBlock after its visible section text, never in the cue column, in all four layouts.
- A block occupies full available content width, with an aspect ratio of 4:3 and ordinary flow height. Existing page fitting and long-page expansion should prevent silent clipping; browser regression is required before v1 release.
- D1 regression tests are in tests/diagram.test.ts: contract validation, deterministic geometry, local draft round-trip and four layout render paths.
- **D2**: implemented — template picker, caption and parameter editing, add/remove interactions, fast insertion targets.
- **D3**: shape handles, moving/resizing/rotation, grid snapping, label collision avoidance, undo/redo and full export/performance acceptance.

Full v1 release is blocked until the long-note worst-case (8 cues, 6 long sections and 2 diagrams, minimal and classic-cornell), exported labels, cross-view consistency and 1.5x export-performance target are verified in the browser. D1 alone does not certify those targets.

Local-only verification (no CI):

    npm ci
    npm run typecheck
    npm test -- tests/diagram.test.ts
    npm run build
    npm run test:e2e


## D2 — Quick template insertion and parameter editing

Implemented after D1's merge (2026-11-17). The **Content** tab now shows an **Insert diagram** action under every section. Choose one of four visual template cards to place the diagram immediately after that section's body text. The newly inserted block automatically opens an inline preview and inspector.

The inspector includes:
- Inclined plane: θ 5–60° slider and optional uphill-friction arrow (use only for a downhill-sliding/tending object).
- Right triangle: leg ratio slider 0.25–4.
- Number line: numeric start/end/interval inputs. Each edit is accepted only if it keeps the entire block valid (finite range, ascending values, interval at least 0.1, at most 19 ticks), otherwise an error is shown and the authored note is preserved.
- Coordinate axes: optional grid and first/all quadrants selector.
- All templates and existing assembled blocks: optional plain-text caption (40 Unicode characters), natural-hand-drawn style toggle, and delete.
- Existing manually assembled diagrams are visible and removable, but their individual primitives remain read-only until D3.

The visual picker, inspector and validation messages are localized for Chinese and English, and the picker adapts to narrow devices. The template list is disabled when a note already has two diagrams; deleting a block immediately frees a slot. Reordering sections moves their attached diagrams. When deleting a section that owns diagrams, a separate explicit confirmation and cancel action protect against accidental data loss; after confirmation, attached diagrams are removed and remaining indices are remapped atomically. Sections without diagrams keep the original direct removal behavior.

D2 uses pure validated functions in src/diagrams/editor.ts and the existing note store; no parallel canvas or persistence format is introduced. Data remains compatible with schemaVersion 1, local drafts, public detail pages and PNG export.

Local-only checks:
- npm run typecheck
- npm test -- tests/diagram-editor.test.ts
- npm test -- tests/diagram.test.ts
- npm run build
- npm run test:e2e — includes 390px Chinese and 1280px English D2 browser smoke tests, screenshots, live SVG/caption/slider, invalid ranges, Escape cancel vs Enter commit, protected section removal, two-block limit and section reorder.

**Not part of D2:** shape manipulation, snapping, geometry history/undo/redo, end-to-end 1.5× PNG-performance benchmarking, and full six-section worst-case clipping acceptance (D3).
