import { describe, expect, it } from "vitest";
import { normalizeNoteStructure } from "../shared/note.ts";
import { validatePublishRequest } from "../shared/publishing.ts";

const valid = {
  title: "  深度工作  ",
  date: "2024年3月1日",
  cues: [{ keyword: "专注", note: "减少切换" }, "心流：全神贯注的状态", { keyword: "" }],
  sections: [
    {
      heading: "核心观点",
      content: "深度工作是在无干扰状态下的专注活动，能把认知能力推向极限。",
      highlights: ["无干扰状态", "不存在的短语", "认知能力"],
    },
  ],
  summary: "专注是一种稀缺能力。",
  doodlePrompt: "一盏台灯照着书桌",
  doodleTheme: "lightbulb",
};

describe("normalizeNoteStructure", () => {
  it("accepts a valid structure and cleans fields", () => {
    const result = normalizeNoteStructure(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("深度工作");
    expect(result.value.cues).toEqual([
      { keyword: "专注", note: "减少切换" },
      { keyword: "心流", note: "全神贯注的状态" },
    ]);
    expect(result.value.sections[0].highlights).toEqual(["无干扰状态", "认知能力"]);
    expect(result.value.doodleTheme).toBe("lightbulb");
    expect(result.warnings.some((w) => w.includes("重点词"))).toBe(true);
  });

  it("only keeps contract fields", () => {
    const result = normalizeNoteStructure({ ...valid, extra: "<script>alert(1)</script>", sections: [{ ...valid.sections[0], onclick: "x" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(["cues", "date", "doodlePrompt", "doodleTheme", "sections", "summary", "title"]);
    expect(Object.keys(result.value.sections[0]).sort()).toEqual(["content", "heading", "highlights"]);
  });

  it("strips html tags, markdown emphasis and control characters", () => {
    const result = normalizeNoteStructure({
      title: "<b>Title</b>\u0007",
      sections: [{ content: "**Bold** text <img src=x onerror=alert(1)>", highlights: ["Bold"] }],
      summary: "ok",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Title");
    expect(result.value.sections[0].content).toBe("Bold text");
    expect(result.value.sections[0].highlights).toEqual(["Bold"]);
  });

  it("keeps code-like angle brackets and identifiers intact", () => {
    const result = normalizeNoteStructure({
      title: "Promise<string> vs Promise<number>",
      sections: [{ content: "Vec<u8>、Map<K, V> 与 __init__ 都应保留。", highlights: [] }],
      summary: "ok",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Promise<string> vs Promise<number>");
    expect(result.value.sections[0].content).toBe("Vec<u8>、Map<K, V> 与 __init__ 都应保留。");
  });

  it("matches highlights case-insensitively using the content's casing", () => {
    const result = normalizeNoteStructure({
      title: "t",
      sections: [{ content: "Spaced Repetition beats cramming.", highlights: ["spaced repetition"] }],
      summary: "",
    });
    expect(result.ok && result.value.sections[0].highlights).toEqual(["Spaced Repetition"]);
  });

  it("keeps only highlights the renderer can show, so the structure passes publication", () => {
    const result = normalizeNoteStructure({
      title: "机器学习",
      sections: [
        { content: "机器学习很重要。\n- 第一点\n1. 第二点", highlights: ["机器学习", "学习", "- 第一点", "第二点"] },
        { content: "机器学习要靠持续学习。", highlights: ["机器学习", "学习"] },
      ],
      summary: "",
    });
    if (!result.ok) throw new Error(result.errors.join("; "));
    // “学习” only occurs inside the earlier highlight, and list markers are not rendered text.
    expect(result.value.sections.map((section) => section.highlights)).toEqual([["机器学习", "第二点"], ["机器学习", "学习"]]);
    expect(result.warnings).toContain("丢弃了 2 个无法在正文中标出的重点词");
    expect(validatePublishRequest({ schemaVersion: 1, note: result.value })).toEqual({ ok: true, value: { schemaVersion: 1, note: result.value } });
  });

  it("rejects missing title or sections", () => {
    expect(normalizeNoteStructure({ sections: [{ content: "a" }], summary: "" }).ok).toBe(false);
    expect(normalizeNoteStructure({ title: "t", sections: [], summary: "" }).ok).toBe(false);
    expect(normalizeNoteStructure({ title: "t", summary: "" }).ok).toBe(false);
    expect(normalizeNoteStructure("not an object").ok).toBe(false);
    expect(normalizeNoteStructure([valid]).ok).toBe(false);
  });

  it("caps array sizes and string lengths", () => {
    const result = normalizeNoteStructure({
      title: "长".repeat(200),
      cues: Array.from({ length: 20 }, (_, i) => ({ keyword: `k${i}`, note: "n" })),
      sections: Array.from({ length: 10 }, () => ({ content: "c".repeat(2000), highlights: [] })),
      summary: "s",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.value.title).length).toBeLessThanOrEqual(60);
    expect(result.value.cues).toHaveLength(8);
    expect(result.value.sections).toHaveLength(6);
    expect(result.value.sections[0].content.length).toBeLessThanOrEqual(900);
  });

  it("infers a doodle theme when the model returns an unknown one", () => {
    const result = normalizeNoteStructure({ ...valid, doodleTheme: "dragon", doodlePrompt: "一本打开的书" });
    expect(result.ok && result.value.doodleTheme).toBe("book");
  });

  it("drops an invalid doodleSpec instead of failing", () => {
    const result = normalizeNoteStructure({ ...valid, doodleSpec: { elements: [{ type: "script" }] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doodleSpec).toBeUndefined();
    expect(result.warnings).toContain("doodleSpec 不合法，已忽略");
  });
});
