import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createTestD1 } from "./helpers/d1.ts";

// Run the shipped SQL, not a duplicate of its median formula.
const latencyQuery = readFileSync("scripts/creation-report.sql", "utf8").split(";").find((query) => query.includes("WITH durations AS"))!;

it.each([
  { values: [], median: null, p95: null },
  { values: [100], median: 100, p95: 100 },
  { values: [300, 100], median: 200, p95: 300 },
  { values: [300, 100, 200], median: 200, p95: 300 },
  { values: [101, 100], median: 100.5, p95: 101 },
  { values: [800, 100, 100, 300], median: 200, p95: 800 },
])("reports median and nearest-rank P95 for $values", async ({ values, median, p95 }) => {
  const db = createTestD1();
  const insert = (ms: number, source = "own", mode = "ai", name = "generation_completed", age = 0) => db.prepare(
    "INSERT INTO creation_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), Date.now() - age, crypto.randomUUID(), crypto.randomUUID(), name, source, 1, JSON.stringify({ durationMs: ms, mode })).run();
  for (const ms of values) await insert(ms);
  // These must not change the population used by the real report.
  await insert(9999, "sample");
  await insert(9999, "own", "local");
  await insert(9999, "own", "ai", "generation_failed");
  await insert(9999, "own", "ai", "generation_completed", 8 * 86_400_000);
  expect(await db.prepare(latencyQuery).first()).toEqual({ completed_ai_attempts: values.length, median_ms: median, p95_ms: p95 });
});
