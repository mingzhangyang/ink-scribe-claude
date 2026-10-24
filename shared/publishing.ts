import { ACCENTS, EN_FONTS, INKS, PAGE_SIZES, PAPERS, ZH_FONTS } from "./appearance.ts";
import { parseContentLines, splitHighlights } from "./content.ts";
import { DOODLE_FILLS, DOODLE_LIMITS, DOODLE_STROKES, type DoodleSpec } from "./doodle.ts";
import { NOTE_LIMITS, type NoteStructure } from "./note.ts";
import { STYLES, TEMPLATES, type Template } from "./options.ts";
import type { Settings } from "./settings.ts";
import { MAX_STICKERS, MAX_STICKER_Y, STICKER_TYPES, STICKER_VARIANTS, type StickerItem } from "./stickers.ts";
import { cleanText } from "./text.ts";
import { DOODLE_THEMES } from "./themes.ts";

export const PUBLISH_SCHEMA_VERSION = 1;

export type PublishRequest = {
  schemaVersion: typeof PUBLISH_SCHEMA_VERSION;
  note: NoteStructure;
  template?: Template;
  appearance?: Partial<Settings>;
  stickers?: StickerItem[];
  visibility?: "public" | "unlisted";
};

export type PublishedContent = { note: NoteStructure; settings: Settings; stickers: StickerItem[] };
export type ValidationIssue = { path: string; code: string; message: string };
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

/** The closed JSON Schema subset used by this contract and its runtime validator. */
type Schema = {
  $schema?: string;
  title?: string;
  description?: string;
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties?: false;
  items?: Schema;
  oneOf?: Schema[];
  const?: string | number;
  enum?: readonly string[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  default?: string | number;
  /** Formatting is part of the protocol: publishing never sanitizes submitted text. */
  "x-plainText"?: "single-line" | "multiline";
};

const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: "object", properties, required, additionalProperties: false,
});
const choices = (values: readonly string[]): Schema => ({ type: "string", enum: values });
const ids = (values: readonly { id: string }[]) => values.map(({ id }) => id);
const number = (minimum: number, maximum: number, multipleOf?: number): Schema => ({
  type: "number", minimum, maximum, ...(multipleOf ? { multipleOf } : {}),
});
const plainText = (maxLength: number, minLength = 0, multiline = false): Schema => ({
  type: "string", minLength, maxLength, "x-plainText": multiline ? "multiline" : "single-line",
  description: "Plain text, already trimmed; no HTML, Markdown emphasis/backticks, control characters or whitespace normalization. No text is silently changed.",
});

const coordinate = number(0, DOODLE_LIMITS.canvas, 0.1);
const stroke = { stroke: choices(DOODLE_STROKES), width: number(DOODLE_LIMITS.minWidth, DOODLE_LIMITS.maxWidth, 0.1) };
const filled = { ...stroke, fill: choices(DOODLE_FILLS) };
const doodleSchema = object({
  concept: plainText(DOODLE_LIMITS.concept),
  elements: {
    type: "array", minItems: 1, maxItems: DOODLE_LIMITS.maxElements,
    items: {
      oneOf: [
        ...(["line", "arrow"] as const).map((type) => ({
          ...object({ type: { type: "string", const: type }, x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate, ...stroke }),
          description: "Endpoints must differ.",
        })),
        object({ type: { type: "string", const: "circle" }, cx: coordinate, cy: coordinate,
          r: number(DOODLE_LIMITS.minRadius, DOODLE_LIMITS.maxRadius, 0.1), ...filled }),
        { ...object({ type: { type: "string", const: "rect" }, x: coordinate, y: coordinate,
          w: number(DOODLE_LIMITS.minSize, DOODLE_LIMITS.canvas, 0.1), h: number(DOODLE_LIMITS.minSize, DOODLE_LIMITS.canvas, 0.1),
          rx: number(0, DOODLE_LIMITS.maxCornerRadius, 0.1), ...filled }), description: "x + w and y + h must not exceed the 100 × 100 drawing canvas." },
        object({ type: { type: "string", const: "path" },
          points: { type: "array", minItems: DOODLE_LIMITS.minPoints, maxItems: DOODLE_LIMITS.maxPoints,
            items: { type: "array", minItems: 2, maxItems: 2, items: coordinate } },
          closed: { type: "boolean" }, smooth: { type: "boolean" }, ...filled }),
      ],
    },
  },
});

const noteSchema = object({
  title: plainText(NOTE_LIMITS.title, 1),
  date: plainText(NOTE_LIMITS.date, 1),
  cues: { type: "array", maxItems: NOTE_LIMITS.maxCues,
    items: object({ keyword: plainText(NOTE_LIMITS.cueKeyword, 1), note: plainText(NOTE_LIMITS.cueNote) }) },
  sections: { type: "array", minItems: 1, maxItems: NOTE_LIMITS.maxSections,
    items: object({
      heading: plainText(NOTE_LIMITS.heading, 1),
      content: plainText(NOTE_LIMITS.content, 1, true),
      highlights: { type: "array", maxItems: NOTE_LIMITS.maxHighlights, items: plainText(NOTE_LIMITS.highlight, 1),
        description: "Distinct phrases that each retain at least one non-overlapping match within a rendered content line after list markers are removed (Unicode case-insensitive). Earlier highlights take precedence over later overlapping matches." },
    }, ["content", "highlights"]) },
  summary: plainText(NOTE_LIMITS.summary, 0, true),
  doodlePrompt: plainText(NOTE_LIMITS.doodlePrompt, 1),
  doodleTheme: choices(DOODLE_THEMES),
  doodleSpec: doodleSchema,
}, ["title", "cues", "sections", "summary"]);

const appearanceProperties: Record<string, Schema> = {
  layout: choices(STYLES), paper: choices(ids(PAPERS)), zhFont: choices(ids(ZH_FONTS)), enFont: choices(ids(EN_FONTS)),
  ink: choices(ids(INKS)), accent: choices(ids(ACCENTS)), pageSize: choices(ids(PAGE_SIZES)),
  fontSize: number(12, 28), lineHeight: number(1.3, 2.4), letterSpacing: number(-0.02, 0.15), naturalness: number(0, 1),
  doodleMode: { ...choices(["auto", "theme", "none"]), description: "auto uses note.doodleSpec or its built-in theme; theme uses appearance.doodleTheme; none hides illustrations." },
  doodleTheme: choices(DOODLE_THEMES),
  seed: { type: "integer", minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
  overflow: { ...choices(["expand", "error"]), default: "expand",
    description: "After bounded fitting, expand switches to a long page; error blocks image export if the fixed page still overflows. Layout is checked by the browser, not by the publication API." },
};
const appearanceSchema = object(appearanceProperties, []);
const settingsSchema = object(appearanceProperties);
const stickerSchema: Schema = {
  oneOf: STICKER_TYPES.map((type) => ({ ...object({
    id: { type: "string", pattern: "^[\\w-]{1,40}$", minLength: 1, maxLength: 40 },
    type: { type: "string", const: type },
    x: { type: "integer", minimum: -40, maximum: 880 },
    y: { type: "integer", minimum: -40, maximum: MAX_STICKER_Y },
    rotation: number(-180, 180, 0.1), scale: number(0.3, 3, 0.01),
    variant: choices(type === "custom-doodle" ? DOODLE_THEMES : ids(STICKER_VARIANTS[type])),
    flip: { type: "boolean", description: "Mirror the sticker horizontally. Defaults to false." },
    ...(type === "custom-doodle" ? { doodle: doodleSchema } : {}),
  }, ["id", "type", "x", "y", "rotation", "scale"]),
    ...(type === "custom-doodle" ? { description: "Provide variant or doodle. When both are present, doodle supplies the drawing." } : {}),
  })),
};
const stickersSchema: Schema = { type: "array", maxItems: MAX_STICKERS, items: stickerSchema };

export const PUBLISH_COMPONENT_SCHEMAS = {
  NoteStructure: noteSchema, Appearance: appearanceSchema, Settings: settingsSchema,
  DoodleSpec: doodleSchema, Sticker: stickerSchema, Stickers: stickersSchema,
};

/** OpenAPI embeds this very schema; the runtime below consumes it without separate limit tables. */
export function publishRequestSchema(): Schema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "InkScribe agent publication",
    ...object({
      schemaVersion: { type: "integer", const: PUBLISH_SCHEMA_VERSION },
      note: noteSchema,
      template: { ...choices(TEMPLATES), default: "general" },
      appearance: appearanceSchema,
      stickers: stickersSchema,
      visibility: { ...choices(["public", "unlisted"]), default: "unlisted" },
    }, ["schemaVersion", "note"]),
  };
}

export const PUBLISH_REQUEST_SCHEMA = publishRequestSchema();
const publishedContentSchema = object({ note: noteSchema, settings: settingsSchema, stickers: stickersSchema });

const SCHEMA_KEYWORDS = new Set([
  "$schema", "title", "description", "type", "properties", "required", "additionalProperties", "items", "oneOf",
  "const", "enum", "minLength", "maxLength", "pattern", "minItems", "maxItems", "minimum", "maximum", "multipleOf", "default", "x-plainText",
]);

/** Fail during module initialization if a future contract adds a rule this walker cannot enforce. */
function assertSupported(schema: Schema): void {
  if (Object.keys(schema).some((key) => !SCHEMA_KEYWORDS.has(key))) throw new Error("Unsupported publication schema keyword");
  if (schema.oneOf) {
    const types = schema.oneOf.map((branch) => branch.properties?.type.const);
    if (types.some((type) => typeof type !== "string") || new Set(types).size !== types.length) {
      throw new Error("Publication unions must have distinct string type discriminators");
    }
    schema.oneOf.forEach(assertSupported);
  } else if (schema.type === "object") {
    if (!schema.properties || schema.additionalProperties !== false
      || schema.required?.some((key) => !Object.hasOwn(schema.properties!, key))) throw new Error("Invalid publication object schema");
    Object.values(schema.properties).forEach(assertSupported);
  } else if (schema.type === "array") {
    if (!schema.items) throw new Error("Publication arrays require an item schema");
    assertSupported(schema.items);
  } else if (!["string", "number", "integer", "boolean"].includes(schema.type ?? "")) {
    throw new Error("Unsupported publication schema type");
  }
}

assertSupported(PUBLISH_REQUEST_SCHEMA);
assertSupported(publishedContentSchema);

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const propertyPath = (path: string, key: string) => /^[A-Za-z_$][\w$]*$/.test(key)
  ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;
const MAX_ISSUES = 64;
const issue = (issues: ValidationIssue[], path: string, code: string, message: string) => {
  if (issues.length < MAX_ISSUES) issues.push({ path: path || "$", code, message });
};

/** No dynamic code generation: this deliberately supports only the closed subset declared above. */
function check(schema: Schema, value: unknown, path: string, issues: ValidationIssue[]): void {
  if (issues.length >= MAX_ISSUES) return;
  if (schema.oneOf) {
    // Every union in this contract is discriminated by an exact type field.
    const branch = isRecord(value) && schema.oneOf.find((s) => s.properties?.type.const === value.type);
    if (!branch) issue(issues, propertyPath(path, "type"), "INVALID_TYPE", "Expected a supported drawing or sticker type.");
    else check(branch, value, path, issues);
    return;
  }
  if (schema.const !== undefined && value !== schema.const) {
    issue(issues, path, "INVALID_VALUE", `Expected ${JSON.stringify(schema.const)}.`);
    return;
  }
  switch (schema.type) {
    case "object": {
      if (!isRecord(value)) return issue(issues, path, "INVALID_TYPE", "Expected an object.");
      const properties = schema.properties!;
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key)) issue(issues, propertyPath(path, key), "REQUIRED", "This field is required.");
      }
      for (const key of Object.keys(value)) {
        const fieldPath = propertyPath(path, key);
        if (!Object.hasOwn(properties, key)) issue(issues, fieldPath, "UNKNOWN_FIELD", "This field is not part of the publication contract.");
        else check(properties[key], value[key], fieldPath, issues);
      }
      return;
    }
    case "array":
      if (!Array.isArray(value)) return issue(issues, path, "INVALID_TYPE", "Expected an array.");
      if (schema.minItems !== undefined && value.length < schema.minItems) issue(issues, path, "TOO_FEW_ITEMS", `Provide at least ${schema.minItems} items.`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) issue(issues, path, "TOO_MANY_ITEMS", `Provide no more than ${schema.maxItems} items.`);
      value.slice(0, schema.maxItems ?? value.length).forEach((item, index) => check(schema.items!, item, `${path}[${index}]`, issues));
      return;
    case "string": {
      if (typeof value !== "string") return issue(issues, path, "INVALID_TYPE", "Expected a string.");
      const length = Array.from(value).length;
      if (schema.minLength !== undefined && length < schema.minLength) issue(issues, path, "TOO_SHORT", `Provide at least ${schema.minLength} characters.`);
      if (schema.maxLength !== undefined && length > schema.maxLength) issue(issues, path, "TOO_LONG", `Use no more than ${schema.maxLength} characters.`);
      if (schema.enum && !schema.enum.includes(value)) issue(issues, path, "INVALID_VALUE", "Choose a value listed in the schema.");
      if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) issue(issues, path, "INVALID_FORMAT", "The value does not match the schema's pattern.");
      if (schema["x-plainText"] && cleanText(value, schema.maxLength!, { multiline: schema["x-plainText"] === "multiline" }) !== value) {
        issue(issues, path, "TEXT_REQUIRES_EDIT", "Submit plain, already-trimmed text without markup, control characters or redundant whitespace. Publishing never rewrites text.");
      }
      return;
    }
    case "integer":
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isSafeInteger(value))) {
        return issue(issues, path, "INVALID_TYPE", schema.type === "integer" ? "Expected a safe integer." : "Expected a finite number.");
      }
      if (schema.minimum !== undefined && value < schema.minimum) issue(issues, path, "OUT_OF_RANGE", `Minimum is ${schema.minimum}.`);
      if (schema.maximum !== undefined && value > schema.maximum) issue(issues, path, "OUT_OF_RANGE", `Maximum is ${schema.maximum}.`);
      if (schema.multipleOf) {
        const factor = 1 / schema.multipleOf;
        if (Math.round(value * factor) / factor !== value) issue(issues, path, "INVALID_PRECISION", `Use increments of ${schema.multipleOf}.`);
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") issue(issues, path, "INVALID_TYPE", "Expected a boolean.");
      return;
    default:
      throw new Error("Unsupported publication schema type");
  }
}

function checkDoodle(doodle: DoodleSpec, path: string, issues: ValidationIssue[]): void {
  doodle.elements.forEach((element, index) => {
    const p = `${path}.elements[${index}]`;
    if ((element.type === "line" || element.type === "arrow") && element.x1 === element.x2 && element.y1 === element.y2) {
      issue(issues, p, "EMPTY_DRAWING", "Line endpoints must differ.");
    }
    if (element.type === "rect") {
      if (Math.round((element.x + element.w) * 10) > DOODLE_LIMITS.canvas * 10) issue(issues, `${p}.w`, "OUT_OF_BOUNDS", "The rectangle must fit within the drawing canvas.");
      if (Math.round((element.y + element.h) * 10) > DOODLE_LIMITS.canvas * 10) issue(issues, `${p}.h`, "OUT_OF_BOUNDS", "The rectangle must fit within the drawing canvas.");
    }
  });
}

function checkNote(note: NoteStructure, path: string, issues: ValidationIssue[]): void {
  note.sections.forEach((section, index) => {
    const lines = parseContentLines(section.content).flatMap((line) => line.kind === "gap" ? [] : [line.text]);
    const renderedHighlights = new Set(lines.flatMap((line) => splitHighlights(line, section.highlights)
      .flatMap((run) => run.highlight === null ? [] : [run.highlight])));
    const seen = new Set<string>();
    section.highlights.forEach((highlight, highlightIndex) => {
      const p = `${path}.sections[${index}].highlights[${highlightIndex}]`;
      const pattern = new RegExp(highlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
      // Match the renderer's Unicode case folding, without rewriting the submitted phrase.
      const actual = lines.map((line) => line.match(pattern)?.[0]).find((match) => match !== undefined);
      if (!actual) issue(issues, p, "HIGHLIGHT_NOT_FOUND", "The phrase must occur within a rendered content line, without a list marker.");
      else if (seen.has(actual)) issue(issues, p, "DUPLICATE_HIGHLIGHT", "Each highlight must identify a distinct phrase.");
      else {
        seen.add(actual);
        if (!renderedHighlights.has(highlightIndex)) issue(issues, p, "HIGHLIGHT_SHADOWED", "Every matching occurrence overlaps an earlier highlight. Remove or revise this phrase so at least one non-overlapping occurrence remains.");
      }
    });
  });
  if (note.doodleSpec) checkDoodle(note.doodleSpec, `${path}.doodleSpec`, issues);
}

function checkStickers(stickers: StickerItem[], path: string, issues: ValidationIssue[]): void {
  const ids = new Set<string>();
  stickers.forEach((sticker, index) => {
    const p = `${path}[${index}]`;
    if (ids.has(sticker.id)) issue(issues, `${p}.id`, "DUPLICATE_ID", "Each sticker must have a unique ID.");
    ids.add(sticker.id);
    if (sticker.type === "custom-doodle" && !sticker.variant && !sticker.doodle) {
      issue(issues, p, "DRAWING_REQUIRED", "A custom doodle sticker requires variant or doodle.");
    }
    if (sticker.doodle) checkDoodle(sticker.doodle, `${p}.doodle`, issues);
  });
}

function validate<T>(schema: Schema, input: unknown, path: string, semantics?: (value: T, issues: ValidationIssue[]) => void): ValidationResult<T> {
  const issues: ValidationIssue[] = [];
  check(schema, input, path, issues);
  if (issues.length === 0) semantics?.(input as T, issues);
  return issues.length ? { ok: false, issues } : { ok: true, value: input as T };
}

export function validatePublishRequest(input: unknown): ValidationResult<PublishRequest> {
  return validate<PublishRequest>(PUBLISH_REQUEST_SCHEMA, input, "", (value, issues) => {
    checkNote(value.note, "note", issues);
    checkStickers(value.stickers ?? [], "stickers", issues);
  });
}

/** New published snapshots are validated without any lossy AI-output normalization. */
export function validatePublishedContent(input: unknown): ValidationResult<PublishedContent> {
  return validate<PublishedContent>(publishedContentSchema, input, "", (value, issues) => {
    checkNote(value.note, "note", issues);
    checkStickers(value.stickers, "stickers", issues);
  });
}

export function validatePublishedNote(input: unknown): ValidationResult<NoteStructure> {
  return validate<NoteStructure>(noteSchema, input, "note", (value, issues) => checkNote(value, "note", issues));
}

export function validatePublishedStickers(input: unknown): ValidationResult<StickerItem[]> {
  return validate<StickerItem[]>(stickersSchema, input, "stickers", (value, issues) => checkStickers(value, "stickers", issues));
}

export function validatePublishAppearance(input: unknown): ValidationResult<Partial<Settings>> {
  return validate<Partial<Settings>>(appearanceSchema, input, "appearance");
}
