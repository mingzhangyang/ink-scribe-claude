# InkScribe Diagram Blocks · D1–D3

## User entry point and production-build recovery (2026-11-17)

The D1/D2/D3 implementations were merged in PRs #30/#31/#32, but **all three post-merge main CI jobs failed at TypeScript typecheck**, so their checks and builds are not certified. The underlying source already placed Insert diagram at the bottom of every section within the **Content** tab. It was difficult to find, especially on mobile because the entire editing panel is below the canvas.

The recovery PR keeps the **note canvas completely uncluttered**. In the **Content** tab, a single restrained **+ Insert diagram (0/2)** row appears above the regular title/section fields. It is collapsed by default; tapping it expands a section selector plus four diagram templates. A template click inserts the block and collapses the picker again; a compact success link opens the block's parameter inspector. When two blocks exist, the same entry expands a short list of existing diagrams for editing instead of showing more templates. Redundant per-section insertion pickers were removed; their diagram inspection/editing controls remain.

The same recovery PR fixes the errors seen in the GitHub Actions logs: unknown polyline-point property within a callback, generic TypeScript parameter-update mismatch, template-vs-primitives discriminated union violations in geometry methods, and an unused test import. It also changes the production build command to **run typecheck before Vite**, preventing a future deploy that bypasses the TypeScript gate.

Release checklist (do not merge / redeploy on a red check):

    npm ci
    npm run typecheck
    npm test
    npm run build
    npm run test:e2e
    npx wrangler deploy

The tests and browser export acceptance must run in an environment with the real repository dependencies. Check the new service worker's update notification when opening an already-installed PWA: a waiting worker deliberately keeps the previous version running until the user accepts the refresh. For a fresh smoke test, use a new/incognito browser session, open the editor, switch to Content, expand the single Insert diagram row and confirm the four template choices.



Date: 2026-11-17. This document covers D1 (contract and flow), D2 (template insertion) and D3 (direct primitive editing and release gates).

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

Templates expand into deterministic primitives at render time. Direct primitive edits in D3 materialize templates into plain primitives only after an actual geometric change; D1 and D2 parameter adjustments preserve the template.

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
- **D3**: primitive editing and undo/redo implemented; browser, PNG and performance gates instrumented but not yet executed.

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

**Not part of D2:** primitive manipulation, snapping, history/undo/redo, full browser export and performance validation, which belong to D3 below.


## D3: Direct primitive editing and release acceptance

### Fine editing

- In the Content tab, expand a diagram and select Fine edit shapes. The original SVG diagram is covered by a separate touch-friendly editor overlay. The overlay is NOT part of the public/PNG NotePage.
- Select a shape by its stroke or center marker; drag to move it, or drag its visible shape handles to resize endpoints, polygon vertices, or radii. Rotate with a dedicated handle in 15-degree increments.
- Grid positions are 25 normalized units (1/40 of the 1000-unit width). Disabling grid also disables position snapping. Alignment guides follow the selected shape.
- Add line, arrow, polyline, rectangle, circle, ellipse, angle arc and label from a compact tool strip. Selected text labels and line/arrow/arc annotations can be edited. Every edit uses the original closed primitive schema; invalid geometry is rejected.
- A parameterized template remains parameterized until the first effective shape change; only then is it expanded into editable primitives, without losing the caption, section anchor or hand-drawn style.
- Authored text labels reflow away from overlapping strokes where space permits, while the existing D1 label renderer protects text near the canvas edges. The jitter seed stays stable when moving a shape.

### Undo, redo and data safety

- Gesture preview is local; releasing the pointer commits a single validated change with one undo snapshot. This avoids one history entry per pointer-move event.
- All diagram edits use one bounded 30-step undo/redo stack in the note store, including D2 insertion, parameter changes and deletion. Keyboard arrow keys nudge the selected shape; Delete removes; Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes. Native keyboard input remains intact.
- Undo history is in memory only, never saved into the publication schema or draft JSON. Loading/replacing a document and editing unrelated text/section layout clears history; redo is invalidated by a fresh edit.
- Prior D2 deletion/section confirmation remains in place. No new schema version or second export renderer is introduced.

### Verification and release gate

- Pure tests: tests/diagram-geometry.test.ts and tests/diagram-history.test.ts cover transform geometry, invalid bounds, template conversion, history isolation and label clearance.
- Browser acceptance: e2e/diagram-primitive.mjs covers mobile (390px, Chinese) and desktop (1280px, English) shape editing, keyboard, undo/redo and SVG preview consistency.
- Worst-case fixture: 8 cues, 6 long body sections, 2 diagrams in minimal and classic Cornell; measure overflow, label ratio >=0.9 of small body, and execute actual PNG exports.
- Export performance fixture compares a two-diagram document with its zero-diagram baseline. Acceptance criterion is <=1.5x elapsed PNG rendering time, with metrics saved in e2e-results/diagram-d3-export-metrics.json.
- These tests are wired to the existing local e2e/acceptance.mjs runner; the entire npm test/typecheck/build/browser suite must still be executed locally before declaring the D3 release gate passed. Changes have been made without launching CI.

Local-only commands:

    npm ci
    npm run typecheck
    npm test
    npm run build
    npm run test:e2e

Any measured overflow, label-size or export performance failure remains a release blocker, not an exception silently waived by PR merge.

## Acceptance review fixes (2026-11-19)

- **Number line:** the last tick is matched to `end` with a step-relative tolerance, so float accumulation (`0.1 * 12 = 1.2000000000000002`) no longer drops the second-to-last tick (0–1.2 step 0.1 now draws all 13 evenly spaced ticks). The start tick is never snapped, so tiny publish-valid ranges keep both endpoints.
- **Fine edit:** the first shape edit no longer re-flows every template label. Only labels newly crowded at their anchor or newly/more severely crossed by the edited stroke at painted text bounds move; guide grid lines are ignored as hard clearance obstacles during this selective reflow. All other primitives stay byte-identical. Previously nudging a number-line axis snapped all values to the grid and stacked "1"/"2" and "4"/"5" onto one anchor.
- **Coordinate plane:** grid lines now run through integer coordinates measured from the origin (78 units per x, 76 per y, the function plot scale), and lines coinciding with an axis are omitted. Key-point annotations choose the first nearby position whose text box crosses neither axis, the curve, its own dot, nor another annotation.
- Regression tests: `tests/diagram.test.ts` ("template math regressions") and `tests/diagram-geometry.test.ts` ("first shape edit preserves untouched template labels").


## Diagram polish: ground, sampled labels and editor history (2026-11-18)

- The inclined-plane angle arc now has a solid horizontal ground reference from the same vertex. The angle label is searched near the arc with both the ground and incline as obstacles; force-vector math is unchanged.
- Number-line tick marks remain fully preserved, including endpoints and the existing floating-point terminal-tick correction. Intermediate label **visibility** uses one regular tick-index stride, anchored at zero where zero is an actual tick. The two endpoints remain mandatory. Very small ranges fall back to endpoints when adding a zero label would collide.
- D2 and D3 expose the same document-scoped 30-step diagram history controls. Changes to a range input (slope, leg ratio, per-diagram jitter) re-render live but coalesce into one undo step per pointer/keyboard gesture; pointerup/keyup/blur ends the transaction. New documents, ordinary text edits, undo and redo clear the active transaction.
- A diagram caption is local until blur (or Enter), then a single history step is recorded if the cleaned value differs. Escape discards the edit. A note-serial and diagram-identity guard rejects stale blur commits.
- A short force arrow uses an optional, language-independent `callout: "short-force-not-to-scale"` rather than putting an English system note into an editable arrow label. The view renders the locale-specific note outside the SVG. Previously persisted `label: "Short force arrow not to scale."` arrows remain readable; conversion to editable primitives migrates the marker. The optional field is allowed for arrows only, and publish schemaVersion stays 1.
- The editor, local draft reader and publishing validator use the same 0..3, exact 0.1-increment jitter rule. Invalid imported values (such as 1.25) are rejected rather than silently rounded.

Local release gate: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, and actual Chinese/English SVG/PNG inspection at 5°, 15°, 30° and 60°. No CI dispatch is required.
