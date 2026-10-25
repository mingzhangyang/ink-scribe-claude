import { afterEach, expect, it, vi } from "vitest";
import { buildWeeklyReport, reportWindow, sendWeeklyReport } from "../worker/weekly-report.ts";
import type { Env } from "../worker/env.ts";
import { createTestD1 } from "./helpers/d1.ts";

const monday = Date.parse("2026-10-26T13:17:00Z");
const { start, end } = reportWindow(monday)!;
function setup() {
  const DB = createTestD1();
  const env = { DB, WEEKLY_REPORT_ENABLED: "true", WEEKLY_REPORT_FROM: "reports@example.com", WEEKLY_REPORT_TO: "owner@example.com", RESEND_API_KEY: "test-only" } as Env;
  const send = vi.fn(async () => Response.json({ id: "email-1" }));
  vi.stubGlobal("fetch", send);
  return { DB, env, send };
}
afterEach(() => vi.unstubAllGlobals());

it("uses the previous full UTC week only in Monday's 11-hour delivery window", () => {
  expect(reportWindow(monday)).toEqual({ start: Date.parse("2026-10-19T00:00:00Z"), end: Date.parse("2026-10-26T00:00:00Z") });
  for (const at of ["2026-10-26T12:59:59Z", "2026-10-27T00:00:00Z", "2026-10-25T14:00:00Z"]) expect(reportWindow(Date.parse(at))).toBeNull();
  expect(reportWindow(Date.parse("2026-10-26T23:59:59Z"))).not.toBeNull();
});

it("reports zero activity without inventing percentages or latency", async () => {
  const { DB } = setup();
  const report = await buildWeeklyReport(DB, start, end);
  expect(report.subject).toContain("2026-10-19 — 2026-10-25");
  expect(report.text).toContain("开始创作：0 次");
  expect(report.text).toContain("有效成果占比：—");
  expect(report.text).toContain("耗时中位数：无样本");
});

it("deduplicates the cohort and excludes samples and out-of-period outcomes", async () => {
  const { DB } = setup();
  const insert = (name: string, creation = "own-1", at = start, source = "own", ms = 100, mode = "ai") => DB.prepare(
    "INSERT INTO creation_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), at, creation, crypto.randomUUID(), name, source, 1, JSON.stringify({ durationMs: ms, mode, code: "AI_TIMEOUT" })).run();
  await insert("creation_started"); await insert("creation_started");
  await insert("generation_started"); await insert("generation_completed");
  await insert("generation_completed", "own-1", end - 1, "own", 300);
  await insert("note_ready"); await insert("export_completed"); await insert("export_completed");
  await insert("creation_started", "own-2"); await insert("export_completed", "own-2", end);
  await insert("creation_started", "old", start - 1); await insert("export_completed", "old");
  await insert("creation_started", "sample", start, "sample");
  await insert("generation_completed", "sample", start, "sample", 9000);
  await insert("generation_completed", "old", end, "own", 9000);
  await insert("generation_completed", "own-2", start, "own", 9000, "local");
  await insert("generation_failed");
  const { text } = await buildWeeklyReport(DB, start, end);
  expect(text).toContain("开始创作：2 次");
  expect(text).toContain("保存／导出／分享成功：1 次");
  expect(text).toContain("有效成果占比：50.0%");
  expect(text).toContain("AI 成功尝试：2 次");
  expect(text).toContain("耗时中位数：200 ms");
  expect(text).toContain("耗时 P95：300 ms");
  expect(text).toContain("generation_failed / AI_TIMEOUT：1");
});

it("does not send while disabled, in mock, outside the window, or with incomplete configuration", async () => {
  const { env, send } = setup();
  await sendWeeklyReport({ ...env, WEEKLY_REPORT_ENABLED: "false" }, monday);
  await sendWeeklyReport({ ...env, AI_MOCK: "1" }, monday);
  await sendWeeklyReport(env, end);
  await expect(sendWeeklyReport({ ...env, RESEND_API_KEY: undefined }, monday)).rejects.toThrow("configuration incomplete");
  expect(send).not.toHaveBeenCalled();
});

it("sends once per week and records provider acceptance, not inbox delivery", async () => {
  const { env, send, DB } = setup();
  await sendWeeklyReport(env, monday);
  await sendWeeklyReport(env, monday + 3_600_000);
  expect(send).toHaveBeenCalledTimes(1);
  const row = await DB.prepare("SELECT accepted_at, provider_id FROM weekly_report_deliveries").first();
  expect(row).toEqual({ accepted_at: monday, provider_id: "email-1" });
});

it("retries an ambiguous timeout with the same frozen payload and idempotency key", async () => {
  const { env, send } = setup();
  send.mockRejectedValueOnce(new Error("timeout"));
  await expect(sendWeeklyReport(env, monday)).rejects.toThrow("timeout");
  await sendWeeklyReport({ ...env, WEEKLY_REPORT_TO: "changed@example.com" }, monday + 3_600_000);
  expect(send).toHaveBeenCalledTimes(2);
  const calls = (send.mock.calls as unknown as [string, RequestInit][]);
  expect(calls[0][1].body).toBe(calls[1][1].body);
  expect(calls[0][1].headers).toEqual(calls[1][1].headers);
  expect(JSON.parse(calls[1][1].body as string).to).toEqual(["owner@example.com"]);
});

it("does not mark failed or malformed provider responses accepted", async () => {
  const { env, send, DB } = setup();
  send.mockResolvedValueOnce(new Response("sensitive details", { status: 429 }));
  await expect(sendWeeklyReport(env, monday)).rejects.toThrow("HTTP 429");
  send.mockResolvedValueOnce(Response.json({}));
  await expect(sendWeeklyReport(env, monday)).rejects.toThrow("missing ID");
  expect(await DB.prepare("SELECT accepted_at FROM weekly_report_deliveries").first()).toEqual({ accepted_at: null });
});

it("concurrent invocations send the identical idempotent request", async () => {
  const { env, send } = setup();
  await Promise.all([sendWeeklyReport(env, monday), sendWeeklyReport(env, monday)]);
  const calls = (send.mock.calls as unknown as [string, RequestInit][]);
  expect(calls.length).toBeGreaterThan(0);
  expect(new Set(calls.map((c) => c[1].body)).size).toBe(1);
  expect(new Set(calls.map((c) => JSON.stringify(c[1].headers))).size).toBe(1);
});
