import { normalizeDoodleSpec, type DoodleSpec } from "./doodle.ts";
import type { NoteStructure } from "./note.ts";
import { DETAILS, LANGUAGES, TEMPLATES, isOneOf, type Detail, type Language, type Template } from "./options.ts";
import { sanitizeSettings, type Settings } from "./settings.ts";
import { STICKER_TYPES, type StickerItem } from "./stickers.ts";
import { DOODLE_THEMES } from "./themes.ts";

export type NoteDocument = {
  input: { text: string; template: Template; language: Language; detail: Detail };
  note: NoteStructure | null;
  settings: Settings;
  stickers: StickerItem[];
  aiDoodle: DoodleSpec | null;
  source: "ai" | "local" | "sample" | "shared" | null;
};

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const optionalText = (v: unknown): v is string | undefined => v === undefined || text(v);
function doodle(v: unknown): DoodleSpec | null {
  if (v == null) return null;
  const result = normalizeDoodleSpec(v);
  if (!result.ok) throw new Error("Invalid draft illustration");
  return result.value;
}

/** Drafts permit unfinished/empty fields. AI normalization would silently discard these edits. */
export function readDocument(value: unknown): NoteDocument {
  if (!record(value) || !record(value.input) || !text(value.input.text)
    || !isOneOf(TEMPLATES, value.input.template) || !isOneOf(LANGUAGES, value.input.language)
    || !isOneOf(DETAILS, value.input.detail) || !Array.isArray(value.stickers)
    || ![null, "ai", "local", "sample", "shared"].includes(value.source as string | null)) throw new Error("Invalid draft");
  let note: NoteStructure | null = null;
  if (value.note !== null) {
    const n = value.note;
    if (!record(n) || !text(n.title) || !text(n.summary) || !optionalText(n.date) || !optionalText(n.doodlePrompt)
      || !Array.isArray(n.cues) || !Array.isArray(n.sections)) throw new Error("Invalid draft note");
    note = {
      title: n.title, summary: n.summary,
      ...(n.date !== undefined ? { date: n.date } : {}),
      ...(n.doodlePrompt !== undefined ? { doodlePrompt: n.doodlePrompt } : {}),
      ...(isOneOf(DOODLE_THEMES, n.doodleTheme) ? { doodleTheme: n.doodleTheme } : {}),
      ...(n.doodleSpec ? { doodleSpec: doodle(n.doodleSpec)! } : {}),
      cues: n.cues.map((c: unknown) => {
        if (!record(c) || !text(c.keyword) || !text(c.note)) throw new Error("Invalid draft cue");
        return { keyword: c.keyword, note: c.note };
      }),
      sections: n.sections.map((s: unknown) => {
        if (!record(s) || !text(s.content) || !optionalText(s.heading) || !optionalText(s.highlightInput) || !Array.isArray(s.highlights) || !s.highlights.every(text)) throw new Error("Invalid draft section");
        return { content: s.content, highlights: s.highlights, ...(s.heading !== undefined ? { heading: s.heading } : {}),
          ...(s.highlightInput !== undefined ? { highlightInput: s.highlightInput } : {}) };
      }),
    };
  }
  return {
    input: { text: value.input.text, template: value.input.template, language: value.input.language, detail: value.input.detail },
    note, settings: sanitizeSettings(value.settings),
    stickers: value.stickers.map((s: unknown): StickerItem => {
      if (!record(s) || !text(s.id) || !isOneOf(STICKER_TYPES, s.type) || !optionalText(s.variant)
        || ![s.x, s.y, s.rotation, s.scale].every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error("Invalid draft sticker");
      return { id: s.id, type: s.type, x: s.x as number, y: s.y as number, rotation: s.rotation as number, scale: s.scale as number,
        ...(s.variant !== undefined ? { variant: s.variant } : {}), ...(s.doodle ? { doodle: doodle(s.doodle)! } : {}) };
    }),
    aiDoodle: doodle(value.aiDoodle), source: value.source as NoteDocument["source"],
  };
}
