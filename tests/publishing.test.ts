import { describe, expect, it } from "vitest";
import { normalizeDoodleSpec, type DoodleSpec } from "../shared/doodle.ts";
import { NOTE_LIMITS } from "../shared/note.ts";
import {
  PUBLISH_COMPONENT_SCHEMAS, PUBLISH_REQUEST_SCHEMA, publishRequestSchema,
  validatePublishRequest, validatePublishedContent, validatePublishedNote, type PublishRequest,
} from "../shared/publishing.ts";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";
import { normalizeStickers } from "../shared/stickers.ts";
import { parseContentLines, splitHighlights } from "../src/lib/segments.ts";

const request = (): PublishRequest => ({
  schemaVersion: 1,
  note: {
    title: "Read with focus",
    cues: [{ keyword: "Focus", note: "" }],
    sections: [{ heading: "One goal", content: "Write one clear goal.\n- Record the result.", highlights: ["ONE CLEAR GOAL", "Record the result"] }],
    summary: "",
  },
});

const doodle = (): DoodleSpec => ({
  concept: "An arrow",
  elements: [{ type: "arrow", x1: 10, y1: 30, x2: 80, y2: 70, stroke: "ink", width: 1.5 }],
});

function issues(input: unknown) {
  const result = validatePublishRequest(input);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected validation failure");
  return result.issues;
}

describe("strict agent publication contract", () => {
  it("requires complete structured data and a supported version without accepting source text", () => {
    for (const field of ["note", "schemaVersion"] as const) {
      const incomplete: Record<string, unknown> = { ...request() };
      delete incomplete[field];
      expect(issues(incomplete)).toContainEqual({ path: field, code: "REQUIRED", message: "This field is required." });
    }
    expect(issues({ ...request(), schemaVersion: 2 })).toContainEqual(expect.objectContaining({ path: "schemaVersion", code: "INVALID_VALUE" }));
    expect(issues({ ...request(), text: "Original source is not used by publication" })).toContainEqual(expect.objectContaining({ path: "text", code: "UNKNOWN_FIELD" }));
    for (const field of ["title", "cues", "sections", "summary"]) {
      const note: Record<string, unknown> = { ...request().note };
      delete note[field];
      expect(issues({ ...request(), note })).toContainEqual(expect.objectContaining({ path: `note.${field}`, code: "REQUIRED" }));
    }
  });

  it("returns the exact submitted content without sanitizing, inserting defaults, or changing highlight case", () => {
    const input = request();
    input.note.doodleSpec = doodle();
    input.appearance = { layout: "minimal", pageSize: "long", overflow: "expand" };
    input.stickers = [{ id: "star_1", type: "star", x: 40, y: 50, rotation: 1.5, scale: 1.25, variant: "gold" }];
    const before = structuredClone(input);
    expect(validatePublishRequest(input)).toEqual({ ok: true, value: before });
    expect(input).toEqual(before);
    expect(validatePublishedNote(input.note)).toEqual({ ok: true, value: before.note });
  });

  it("rejects unknown fields at every level instead of ignoring them", () => {
    const input = request();
    expect(issues({ ...input, detail: "concise", style: "minimal", language: "en", doodle: doodle() }).map(({ path }) => path))
      .toEqual(["detail", "style", "language", "doodle"]);
    expect(issues({ ...input, note: { ...input.note, extra: "secret" } })).toContainEqual(expect.objectContaining({ path: "note.extra", code: "UNKNOWN_FIELD" }));
    expect(issues({ ...input, note: { ...input.note, sections: [{ ...input.note.sections[0], highlightInput: "draft field" }] } }))
      .toContainEqual(expect.objectContaining({ path: "note.sections[0].highlightInput", code: "UNKNOWN_FIELD" }));
    expect(issues({ ...input, appearance: { font: "unknown" } })).toContainEqual(expect.objectContaining({ path: "appearance.font", code: "UNKNOWN_FIELD" }));
  });

  it("does not accept inherited fields or prototype keys as known schema fields", () => {
    const input = request();
    expect(issues({ ...input, note: Object.assign(Object.create({ title: "inherited" }), { cues: [], sections: input.note.sections, summary: "" }) }))
      .toContainEqual(expect.objectContaining({ path: "note.title", code: "REQUIRED" }));
    const polluted = JSON.parse(JSON.stringify(input).replace('"schemaVersion":1', '"schemaVersion":1,"__proto__":{"title":"evil"}'));
    expect(issues(polluted)).toContainEqual(expect.objectContaining({ path: "__proto__", code: "UNKNOWN_FIELD" }));
  });

  it("enforces rendered text limits by Unicode code points", () => {
    const input = request();
    input.note.title = "😀".repeat(NOTE_LIMITS.title);
    expect(validatePublishRequest(input).ok).toBe(true);
    input.note.title += "😀";
    expect(issues(input)).toContainEqual(expect.objectContaining({ path: "note.title", code: "TOO_LONG" }));
    expect(publishRequestSchema().properties).not.toHaveProperty("text");
  });

  it("reports all oversized note fields and arrays without truncation", () => {
    const input = request();
    input.note.title = "a".repeat(NOTE_LIMITS.title + 1);
    input.note.summary = "s".repeat(NOTE_LIMITS.summary + 1);
    input.note.sections[0].content = "c".repeat(NOTE_LIMITS.content + 1);
    input.note.sections = Array.from({ length: NOTE_LIMITS.maxSections + 1 }, () => ({ ...input.note.sections[0] }));
    const found = issues(input);
    for (const path of ["note.title", "note.summary", "note.sections[0].content"]) {
      expect(found).toContainEqual(expect.objectContaining({ path, code: "TOO_LONG" }));
    }
    expect(found).toContainEqual(expect.objectContaining({ path: "note.sections", code: "TOO_MANY_ITEMS" }));
    expect(input.note.sections).toHaveLength(NOTE_LIMITS.maxSections + 1);
  });

  it.each([" <b>Secret</b>", "**Secret**", "a\u0007b", "a\tb", " a", "a  b", "a\r\nb", "`Secret`"])("rejects note text that would be silently normalized: %j", (content) => {
    const input = request();
    input.note.sections = [{ content, highlights: [] }];
    const found = issues(input);
    expect(found).toContainEqual(expect.objectContaining({ path: "note.sections[0].content", code: "TEXT_REQUIRES_EDIT" }));
    expect(JSON.stringify(found)).not.toContain("Secret");
  });

  it("preserves code-like angle brackets and accepts empty summary without losing required fields", () => {
    const input = request();
    input.note.title = "Promise<string>";
    input.note.sections = [{ content: "Vec<u8> and __init__", highlights: [] }];
    expect(validatePublishRequest(input).ok).toBe(true);
    expect(issues({ ...input, note: { ...input.note, sections: ["raw section"] } }))
      .toContainEqual(expect.objectContaining({ path: "note.sections[0]", code: "INVALID_TYPE" }));
    expect(issues({ ...input, note: { ...input.note, sections: [{ content: "" }] } }))
      .toContainEqual(expect.objectContaining({ path: "note.sections[0].content", code: "TOO_SHORT" }));
  });

  it("validates highlight relationships using the renderer's Unicode case folding", () => {
    const input = request();
    input.note.sections = [{ content: "A Kelvin K and a long ſ.", highlights: ["kelvin k", "LONG S"] }];
    expect(validatePublishRequest(input).ok).toBe(true);
    input.note.sections[0].highlights.push("missing private phrase");
    const found = issues(input);
    expect(found).toContainEqual(expect.objectContaining({ path: "note.sections[0].highlights[2]", code: "HIGHLIGHT_NOT_FOUND" }));
    expect(JSON.stringify(found)).not.toContain("missing private phrase");
    input.note.sections[0].highlights = ["Kelvin", "KELVIN"];
    expect(issues(input)).toContainEqual(expect.objectContaining({ path: "note.sections[0].highlights[1]", code: "DUPLICATE_HIGHLIGHT" }));
  });

  it.each([
    { content: "Alpha beta gamma.", highlights: ["Alpha beta", "beta gamma"] },
    { content: "Alpha beta gamma.", highlights: ["Alpha beta", "beta"] },
    { content: "Alpha beta gamma. Alpha beta gamma.", highlights: ["Alpha beta", "beta gamma"] },
  ])("rejects a highlight when every occurrence is suppressed by earlier matches: %j", (section) => {
    const input = request();
    input.note.sections = [section];
    const before = structuredClone(input);
    const found = issues(input);
    expect(found).toEqual([expect.objectContaining({ path: "note.sections[0].highlights[1]", code: "HIGHLIGHT_SHADOWED" })]);
    expect(JSON.stringify(found)).not.toContain(section.highlights[1]);
    expect(input).toEqual(before);
  });

  it.each([
    "Alpha beta gamma. Later beta gamma.",
    "Alpha beta gamma.\n- beta gamma.",
  ])("accepts an overlapping phrase with another non-overlapping rendered occurrence: %j", (content) => {
    const input = request();
    input.note.sections = [{ content, highlights: ["Alpha beta", "beta gamma"] }];
    expect(validatePublishRequest(input)).toEqual({ ok: true, value: input });
    const lines = parseContentLines(content).flatMap((line) => line.kind === "gap" ? [] : [line.text]);
    const rendered = lines.map((line) => splitHighlights(line, input.note.sections[0].highlights));
    expect(rendered.flat().filter((run) => run.highlight !== null)).toEqual([
      { text: "Alpha beta", highlight: 0 },
      { text: "beta gamma", highlight: 1 },
    ]);
    expect(rendered.map((runs) => runs.map((run) => run.text).join(""))).toEqual(lines);
  });

  it("reports missing and duplicate highlights before overlap diagnostics", () => {
    const input = request();
    input.note.sections = [{ content: "Alpha beta gamma.", highlights: ["Alpha beta", "ALPHA BETA", "missing phrase"] }];
    expect(issues(input).map(({ path, code }) => ({ path, code }))).toEqual([
      { path: "note.sections[0].highlights[1]", code: "DUPLICATE_HIGHLIGHT" },
      { path: "note.sections[0].highlights[2]", code: "HIGHLIGHT_NOT_FOUND" },
    ]);
  });

  it.each(["- Finish", "* Finish", "• Finish", "· Finish", "1. Finish", "2) Finish", "3、Finish"])("rejects highlights that include removed list markers: %j", (highlight) => {
    const input = request();
    input.note.sections = [{ content: `${highlight} review`, highlights: [highlight] }];
    expect(issues(input)).toContainEqual(expect.objectContaining({ path: "note.sections[0].highlights[0]", code: "HIGHLIGHT_NOT_FOUND" }));
    input.note.sections[0].highlights = ["finish review"];
    expect(validatePublishRequest(input).ok).toBe(true);
    const line = parseContentLines(input.note.sections[0].content)[0];
    expect(line.kind).not.toBe("gap");
    if (line.kind === "gap") throw new Error("Expected a visible line");
    expect(splitHighlights(line.text, input.note.sections[0].highlights)).toEqual([{ text: "Finish review", highlight: 0 }]);
  });

  it("requires each highlight to fit within a visible content line and preserves literal decimals", () => {
    const input = request();
    input.note.sections = [{ content: "Finish\nreview", highlights: ["Finish review"] }];
    expect(issues(input)).toContainEqual(expect.objectContaining({ path: "note.sections[0].highlights[0]", code: "HIGHLIGHT_NOT_FOUND" }));
    input.note.sections[0].highlights = ["Finish\nreview"];
    expect(issues(input)).toContainEqual(expect.objectContaining({ path: "note.sections[0].highlights[0]", code: "TEXT_REQUIRES_EDIT" }));
    input.note.sections = [{ content: "Review\n3.14 is pi.\n- Finish later.", highlights: ["3.14", "finish later"] }];
    expect(validatePublishRequest(input).ok).toBe(true);
  });

  it("rejects drawing fields, types, precision and geometry that would otherwise be dropped or clamped", () => {
    const input = request();
    input.note.doodleSpec = doodle();
    expect(validatePublishRequest(input).ok).toBe(true);
    const draw = (element: unknown) => ({ ...input, note: { ...input.note, doodleSpec: { concept: "", elements: [element] } } });
    expect(issues(draw({ ...doodle().elements[0], href: "https://example.com" })))
      .toContainEqual(expect.objectContaining({ path: "note.doodleSpec.elements[0].href", code: "UNKNOWN_FIELD" }));
    expect(issues(draw({ ...doodle().elements[0], x1: 101 })))
      .toContainEqual(expect.objectContaining({ path: "note.doodleSpec.elements[0].x1", code: "OUT_OF_RANGE" }));
    expect(issues(draw({ ...doodle().elements[0], x1: 1.23 })))
      .toContainEqual(expect.objectContaining({ path: "note.doodleSpec.elements[0].x1", code: "INVALID_PRECISION" }));
    expect(issues(draw({ ...doodle().elements[0], x1: 80, y1: 70 })))
      .toContainEqual(expect.objectContaining({ path: "note.doodleSpec.elements[0]", code: "EMPTY_DRAWING" }));
    expect(issues(draw({ type: "rect", x: 80, y: 10, w: 30, h: 20, rx: 0, stroke: "ink", width: 1, fill: "none" })))
      .toContainEqual(expect.objectContaining({ path: "note.doodleSpec.elements[0].w", code: "OUT_OF_BOUNDS" }));
    expect(issues(draw({ type: "path", points: [[0, 0, 0], [1, 1]], closed: false, smooth: true, fill: "none", stroke: "ink", width: 2 })))
      .toContainEqual(expect.objectContaining({ path: "note.doodleSpec.elements[0].points[0]", code: "TOO_MANY_ITEMS" }));
  });

  it("rejects incomplete, duplicate or silently ignored sticker data", () => {
    const sticker = { id: "star_1", type: "star", x: 40, y: 50, rotation: 0, scale: 1 };
    expect(issues({ ...request(), stickers: [{ type: "star", x: 40, y: 50 }] }))
      .toContainEqual(expect.objectContaining({ path: "stickers[0].id", code: "REQUIRED" }));
    expect(issues({ ...request(), stickers: [sticker, sticker] }))
      .toContainEqual(expect.objectContaining({ path: "stickers[1].id", code: "DUPLICATE_ID" }));
    expect(issues({ ...request(), stickers: [{ ...sticker, x: 40.1 }] }))
      .toContainEqual(expect.objectContaining({ path: "stickers[0].x", code: "INVALID_TYPE" }));
    expect(issues({ ...request(), stickers: [{ ...sticker, type: "custom-doodle" }] }))
      .toContainEqual(expect.objectContaining({ path: "stickers[0]", code: "DRAWING_REQUIRED" }));
    expect(issues({ ...request(), stickers: [{ ...sticker, variant: "mint" }] }))
      .toContainEqual(expect.objectContaining({ path: "stickers[0].variant", code: "INVALID_VALUE" }));
    expect(issues({ ...request(), stickers: [{ ...sticker, doodle: doodle() }] }))
      .toContainEqual(expect.objectContaining({ path: "stickers[0].doodle", code: "UNKNOWN_FIELD" }));
  });

  it("accepts all supported drawing shapes without downstream drawing normalization changing them", () => {
    const spec: DoodleSpec = { concept: "Shapes", elements: [
      { type: "line", x1: 0.1, y1: 1, x2: 99.9, y2: 90, stroke: "accent", width: 0.5 },
      { type: "arrow", x1: 10, y1: 20, x2: 30, y2: 40, stroke: "muted", width: 4 },
      { type: "circle", cx: 50, cy: 50, r: 20, fill: "yellow", stroke: "ink", width: 2 },
      { type: "rect", x: 30.3, y: 10, w: 69.7, h: 80, rx: 3, fill: "none", stroke: "ink", width: 2 },
      { type: "path", points: [[0, 0], [33.3, 66.7], [100, 100]], closed: false, smooth: true, fill: "none", stroke: "ink", width: 2 },
    ] };
    const input = request();
    input.note.doodleSpec = spec;
    input.stickers = [{ id: "drawing", type: "custom-doodle", x: 420, y: 380, rotation: -12.3, scale: 0.67, doodle: spec }];
    expect(validatePublishRequest(input).ok).toBe(true);
    expect(normalizeDoodleSpec(spec)).toEqual({ ok: true, value: spec, warnings: [] });
    expect(normalizeStickers(input.stickers)).toEqual(input.stickers);
  });

  it("validates all appearance settings strictly including overflow and unsupported legacy AI mode", () => {
    for (const appearance of [{ fontSize: 29 }, { naturalness: Infinity }, { seed: Number.MAX_SAFE_INTEGER + 1 }, { doodleMode: "ai" }, { overflow: "truncate" }]) {
      expect(validatePublishRequest({ ...request(), appearance }).ok).toBe(false);
    }
    expect(validatePublishRequest({ ...request(), appearance: { overflow: "error", fontSize: 12 } }).ok).toBe(true);
    expect(Object.keys(PUBLISH_COMPONENT_SCHEMAS.Appearance.properties!).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it("validates published snapshots without requiring original text or mutating content", () => {
    const content = { note: request().note, settings: { ...DEFAULT_SETTINGS, overflow: "expand" }, stickers: [] };
    expect(validatePublishedContent(content)).toEqual({ ok: true, value: content });
    expect(validatePublishedContent({ ...content, settings: { pageSize: "long" } }).ok).toBe(false);
    expect(validatePublishedContent({ ...content, text: "Never store source text" }).ok).toBe(false);
    expect(validatePublishedContent({ ...content, settings: { ...content.settings, fontSize: 99 } }).ok).toBe(false);
  });

  it("exposes the same closed field and limit definitions to runtime and machine clients", () => {
    const schema = PUBLISH_REQUEST_SCHEMA;
    expect(schema.required).toEqual(["schemaVersion", "note"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.note).toBe(PUBLISH_COMPONENT_SCHEMAS.NoteStructure);
    expect(schema.properties?.appearance).toBe(PUBLISH_COMPONENT_SCHEMAS.Appearance);
    expect(schema.properties?.note.properties?.sections.maxItems).toBe(NOTE_LIMITS.maxSections);
    expect(JSON.stringify(schema)).not.toContain('"$ref"');
  });
});
