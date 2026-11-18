import assert from "node:assert/strict";
import test from "node:test";
import { parseArrowShaftPath } from "./diagram-small-angle.mjs";

test("reads the full SVG shaft without including its arrowhead", () => {
  assert.deepEqual(parseArrowShaftPath("M10 20 L30 40 M25 35 L30 40 L25 45"), [10, 20, 30, 40]);
  assert.deepEqual(parseArrowShaftPath("M10 20 L15 25 L30 40 M25 35 L30 40 L25 45"), [10, 20, 30, 40]);
});

test("handles signed decimals and rejects malformed path data", () => {
  assert.deepEqual(parseArrowShaftPath("M-.5 2.25 L-3 4"), [-0.5, 2.25, -3, 4]);
  assert.equal(parseArrowShaftPath("M10 20 Lbad 40"), null);
  assert.equal(parseArrowShaftPath("M10 20"), null);
  assert.equal(parseArrowShaftPath(null), null);
});
