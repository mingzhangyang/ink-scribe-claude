import { describe, expect, it } from "vitest";
import { extractKeywords, structureLocally } from "../shared/heuristic.ts";
import { normalizeNoteStructure } from "../shared/note.ts";

const zh = `深度工作

在无干扰的状态下专注进行职业活动，使个人的认知能力达到极限。这种努力能够创造新价值，提升技能，而且难以复制。

浮浅工作
对认知要求不高的事务性任务，往往在受到干扰的情况下开展。此类工作通常不会为世界创造太多新价值，且容易复制。

2024年3月1日 读书会上大家认为，深度工作的能力越来越稀少，也越来越有价值。培养深度工作的能力需要刻意练习。`;

const en = `Spaced repetition is a learning technique where reviews are scheduled at increasing intervals.

The forgetting curve shows that memory decays quickly after learning. Spaced repetition counters the forgetting curve by reviewing right before you forget.

Active recall makes spaced repetition even more effective, because retrieving information strengthens memory.`;

describe("structureLocally", () => {
  it("produces a contract-valid Chinese note", () => {
    const note = structureLocally(zh, { template: "reading-notes" });
    expect(normalizeNoteStructure(note).ok).toBe(true);
    expect(note.title).toBe("深度工作");
    expect(note.date).toBe("2024年3月1日");
    expect(note.sections.length).toBeGreaterThan(1);
    expect(note.sections.some((s) => s.heading === "浮浅工作")).toBe(true);
    for (const section of note.sections) {
      for (const highlight of section.highlights) expect(section.content).toContain(highlight);
    }
  });

  it("produces a contract-valid English note with keyword cues", () => {
    const note = structureLocally(en, { template: "lecture-summary", detail: "concise" });
    expect(normalizeNoteStructure(note).ok).toBe(true);
    expect(note.sections.length).toBeLessThanOrEqual(3);
    expect(note.cues.map((c) => c.keyword)).toContain("spaced");
    expect(note.doodleTheme).toBeDefined();
  });

  it("never fails on degenerate input", () => {
    const note = structureLocally("！！！", { template: "general" });
    expect(normalizeNoteStructure(note).ok).toBe(true);
  });
});

describe("extractKeywords", () => {
  it("prefers repeated multi-character Chinese terms", () => {
    expect(extractKeywords(zh, 3)).toContain("深度工作");
  });
});
