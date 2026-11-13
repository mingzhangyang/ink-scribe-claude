import { describe, expect, it, vi } from "vitest";

vi.mock("modern-screenshot", () => ({ domToCanvas: vi.fn() }));

import { DRIFT_TOLERANCE, driftFor, markerLeft, probeLength, significantDrift } from "../src/export/textDrift.ts";

/** One scanline with a solid marker starting at a fractional device pixel. */
function scanline(width: number, start: number, markerPixels: number): number[] {
  return Array.from({ length: width }, (_, x) => Math.max(0, Math.min(x + 1, start + markerPixels) - Math.max(x, start)));
}

describe("export text drift probe", () => {
  it("locates the marker from its ink centroid, including antialiased edges", () => {
    expect(markerLeft(scanline(400, 120, 8), 1, 8)).toBeCloseTo(120, 6);
    expect(markerLeft(scanline(400, 120.25, 8), 1, 8)).toBeCloseTo(120.25, 6);
    expect(markerLeft(scanline(1600, 481, 32), 4, 8)).toBeCloseTo(120.25, 6);
  });

  it("rejects a scanline whose ink is not the marker", () => {
    expect(markerLeft(scanline(400, 120, 0), 1, 8)).toBeNull();
    expect(markerLeft(scanline(400, 120, 30), 1, 8)).toBeNull();
  });

  it("uses the nearest probed font size for sizes that were not probed", () => {
    const drift = new Map([[13, 0.01], [28, 0.04]]);
    expect(driftFor(drift, 13)).toBe(0.01);
    expect(driftFor(drift, 15)).toBe(0.01);
    expect(driftFor(drift, 24)).toBe(0.04);
    expect(driftFor(new Map(), 13)).toBe(0);
  });

  it("ignores offsets within the marker's pixel-snapping error and reports larger ones", () => {
    const count = probeLength(13, 0.28);
    expect(count).toBeGreaterThan(150);
    expect(significantDrift(null, 0.28)).toBe(false);
    expect(significantDrift(new Map([[13, (DRIFT_TOLERANCE * 0.9) / count]]), 0.28)).toBe(false);
    expect(significantDrift(new Map([[13, (DRIFT_TOLERANCE * 1.1) / count]]), 0.28)).toBe(true);
    expect(significantDrift(new Map([[13, -(DRIFT_TOLERANCE * 1.1) / count]]), 0.28)).toBe(true);
  });

  it("keeps a probe row within its width even for one-em-wide characters", () => {
    for (const size of [8, 13, 30.8, 62]) expect(probeLength(size, 0.4) * (size + 0.4)).toBeLessThan(3000 - 8);
  });
});
