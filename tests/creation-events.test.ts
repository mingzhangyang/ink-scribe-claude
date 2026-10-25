import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCreationEvents, type CreationEvent } from "../shared/creation-events.ts";
import { handleApi } from "../worker/router.ts";
import { pruneCreationEvents } from "../worker/routes/creation-events.ts";
import { resetMemoryRateLimit } from "../worker/rate-limit.ts";
import type { Env } from "../worker/env.ts";
import { createTestD1 } from "./helpers/d1.ts";

const event = (): CreationEvent => ({ version: 1, eventId: crypto.randomUUID(), creationId: crypto.randomUUID(), attemptId: crypto.randomUUID(), name: "creation_started", source: "own", inputMethod: "text", first: true, locale: "en", language: "auto", template: "general", length: "short", mode: "none", device: "wide", durationMs: 0, code: "NONE", requestId: "" });
const request = (body: unknown, origin = "https://ink.test") => new Request("https://ink.test/api/creation-events", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
const env = (DB = createTestD1()): Env => ({ AI: {} as Ai, DB });
beforeEach(() => resetMemoryRateLimit());

describe("creation event ingestion", () => {
  it("strictly rejects content, unbounded fields and oversized batches", () => {
    expect(parseCreationEvents([event()])).not.toBeNull();
    for (const patch of [{ title: "SECRET" }, { requestId: "user text" }, { code: "SECRET" }, { durationMs: -1 }, { eventId: "bad" }, { version: 2 }]) {
      expect(parseCreationEvents([{ ...event(), ...patch }])).toBeNull();
    }
    expect(parseCreationEvents(Array.from({ length: 21 }, event))).toBeNull();
  });
  it("deduplicates repeated delivery, retains only approved fields, and prunes after 30 days", async () => {
    const e = event(), bindings = env();
    for (let i = 0; i < 2; i++) expect((await handleApi(request([e]), bindings, () => {})).status).toBe(204);
    const rows = await bindings.DB!.prepare("SELECT * FROM creation_events").all();
    expect(rows.results).toHaveLength(1);
    expect(JSON.parse(rows.results[0].payload as string)).toEqual(e);
    await bindings.DB!.prepare("UPDATE creation_events SET received_at = ?").bind(Date.now() - 31 * 86_400_000).run();
    await pruneCreationEvents(bindings);
    expect((await bindings.DB!.prepare("SELECT * FROM creation_events").all()).results).toHaveLength(0);
  });
  it("rejects foreign origins and limits ingestion separately from AI", async () => {
    const bindings = env();
    expect((await handleApi(request([event()], "https://evil.test"), bindings, () => {})).status).toBe(403);
    for (let i = 0; i < 12; i++) expect((await handleApi(request([event()]), bindings, () => {})).status).toBe(204);
    expect((await handleApi(request([event()]), bindings, () => {})).status).toBe(429);
  });
  it("excludes mock traffic and rejects excessive request bytes", async () => {
    const bindings = { ...env(), AI_MOCK: "true" };
    expect((await handleApi(request([event()]), bindings, () => {})).status).toBe(204);
    expect((await bindings.DB!.prepare("SELECT * FROM creation_events").all()).results).toHaveLength(0);
    expect((await handleApi(request([ { ...event(), title: "x".repeat(17_000) } ]), bindings, () => {})).status).toBe(413);
  });
  it("reports storage failure without returning accepted", async () => {
    const bindings = env();
    vi.spyOn(bindings.DB!, "batch").mockRejectedValue(new Error("unavailable"));
    expect((await handleApi(request([event()]), bindings, () => {})).status).toBe(500);
  });
});
