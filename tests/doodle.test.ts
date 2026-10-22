import { describe, expect, it } from "vitest";
import { normalizeDoodleSpec } from "../shared/doodle.ts";

describe("normalizeDoodleSpec", () => {
  it("keeps valid primitives and clamps coordinates", () => {
    const result = normalizeDoodleSpec({
      concept: "灯泡",
      elements: [
        { type: "circle", cx: 50, cy: 40, r: 80, fill: "yellow" },
        { type: "line", x1: -20, y1: 10, x2: 150, y2: "30" },
        { type: "rect", x: 90, y: 90, w: 40, h: 40, rx: 99 },
        { type: "path", points: [[0, 0], { x: 10, y: 20 }, ["a", 1]], closed: true },
        { type: "arrow", x1: 10, y1: 10, x2: 60, y2: 60, stroke: "accent", width: 99 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [circle, line, rect, path, arrow] = result.value.elements;
    expect(circle).toMatchObject({ type: "circle", r: 50, fill: "yellow", stroke: "ink" });
    expect(line).toMatchObject({ x1: 0, x2: 100, y2: 30 });
    expect(rect).toMatchObject({ x: 90, w: 10, h: 10, rx: 20 });
    expect(path).toMatchObject({ points: [[0, 0], [10, 20]], closed: true });
    expect(arrow).toMatchObject({ stroke: "accent", width: 4 });
  });

  it("drops unknown element types and attributes", () => {
    const result = normalizeDoodleSpec({
      concept: "x",
      elements: [
        { type: "foreignObject", html: "<script>alert(1)</script>" },
        { type: "circle", cx: 10, cy: 10, r: 5, onload: "alert(1)", href: "javascript:alert(1)", style: "x", fill: "url(#evil)" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.elements).toHaveLength(1);
    expect(Object.keys(result.value.elements[0]).sort()).toEqual(["cx", "cy", "fill", "r", "stroke", "type", "width"]);
    expect(result.value.elements[0]).toMatchObject({ fill: "none" });
    expect(result.warnings).toContain("丢弃了 1 个不合法的图元");
  });

  it("rejects specs without any valid primitive", () => {
    expect(normalizeDoodleSpec({ elements: [] }).ok).toBe(false);
    expect(normalizeDoodleSpec({ elements: [{ type: "line", x1: 1, y1: 1, x2: 1, y2: 1 }] }).ok).toBe(false);
    expect(normalizeDoodleSpec({ elements: "<svg/>" }).ok).toBe(false);
    expect(normalizeDoodleSpec(null).ok).toBe(false);
  });

  it("limits the number of elements and points", () => {
    const result = normalizeDoodleSpec({
      elements: [
        { type: "path", points: Array.from({ length: 100 }, (_, i) => [i, i]) },
        ...Array.from({ length: 50 }, () => ({ type: "circle", cx: 1, cy: 1, r: 1 })),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.elements).toHaveLength(24);
    const path = result.value.elements[0];
    expect(path.type === "path" && path.points.length).toBe(24);
  });
});
