import { readFileSync } from "node:fs";
import worker from "../worker/index.ts";
import { afterEach, expect, it, vi } from "vitest";
import { buildWeeklyReport, reportWindow, sendWeeklyReport, REPORT_CRON } from "../worker/weekly-report.ts";
import type { Env } from "../worker/env.ts";
import { createTestD1 } from "./helpers/d1.ts";

const monday = Date.parse("2026-10-26T13:17:00Z");
const { start, end } = reportWindow(monday)!;
function setup() {
  const DB = createTestD1();
  const send = vi.fn(async (_message: EmailMessageBuilder): Promise<EmailSendResult> => ({ messageId: "email-1" }));
  const env = { DB, WEEKLY_REPORT_ENABLED: "true", WEEKLY_REPORT_FROM: "reports@example.com", WEEKLY_REPORT_TO: "owner@example.com", WEEKLY_REPORT_EMAIL: { send } } as unknown as Env;

  return { DB, env, send };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

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
  await expect(sendWeeklyReport({ ...env, WEEKLY_REPORT_EMAIL: undefined }, monday)).rejects.toThrow("configuration incomplete");
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

it("retries explicit quota rejection with the frozen payload", async () => {
  const { env, send } = setup();
  send.mockRejectedValueOnce(Object.assign(new Error("private provider details"), { code: "E_RATE_LIMIT_EXCEEDED" }));
  await expect(sendWeeklyReport(env, monday)).rejects.toThrow("E_RATE_LIMIT_EXCEEDED");
  await sendWeeklyReport({ ...env, WEEKLY_REPORT_TO: "changed@example.com" }, monday + 3_600_000);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
  expect(send.mock.calls[1][0].to).toEqual(["owner@example.com"]);
});

it("keeps ambiguous timeout claimed and never blindly resends", async () => {
  const { env, send, DB } = setup();
  send.mockRejectedValueOnce(new Error("timeout with private details"));
  await expect(sendWeeklyReport(env, monday)).rejects.toThrow("outcome unconfirmed");
  await expect(sendWeeklyReport(env, monday + 3_600_000)).rejects.toThrow("already claimed");
  expect(send).toHaveBeenCalledTimes(1);
  expect(await DB.prepare("SELECT accepted_at, attempted_at FROM weekly_report_deliveries").first()).toEqual({ accepted_at: null, attempted_at: monday });
});

it("does not mark malformed responses accepted or retry them", async () => {
  const { env, send, DB } = setup();
  send.mockResolvedValueOnce({} as EmailSendResult);
  await expect(sendWeeklyReport(env, monday)).rejects.toThrow("missing messageId");
  await expect(sendWeeklyReport(env, monday + 3_600_000)).rejects.toThrow("already claimed");
  expect(send).toHaveBeenCalledTimes(1);
  expect(await DB.prepare("SELECT accepted_at FROM weekly_report_deliveries").first()).toEqual({ accepted_at: null });
});

it("concurrent invocations call the Cloudflare binding only once", async () => {
  const { env, send } = setup();
  await Promise.all([sendWeeklyReport(env, monday), sendWeeklyReport(env, monday)]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toMatchObject({ from: "reports@example.com", to: ["owner@example.com"] });
});

it("does not resend if acceptance persistence fails after Cloudflare accepted", async () => {
  const { env, send, DB } = setup();
  const prepare = DB.prepare.bind(DB);
  vi.spyOn(DB, "prepare").mockImplementation((sql) => {
    if (sql.startsWith("UPDATE weekly_report_deliveries SET accepted_at")) throw new Error("D1 unavailable");
    return prepare(sql);
  });
  await expect(sendWeeklyReport(env, monday)).rejects.toThrow("D1 unavailable");
  await expect(sendWeeklyReport(env, monday + 3_600_000)).rejects.toThrow("already claimed");
  expect(send).toHaveBeenCalledTimes(1);
});


it("routes the deployed Monday cron into email delivery, separately from daily cleanup", async () => {
  const config = readFileSync("wrangler.jsonc", "utf8");
  const cronArray = config.match(/"crons"\s*:\s*(\[[^\]]*\])/);
  expect(cronArray).not.toBeNull();
  const crons = JSON.parse(cronArray![1]) as string[];
  // Named weekdays avoid Cloudflare's 1=Sunday versus Unix's 1=Monday mismatch.
  expect(crons).toEqual(["17 3 * * *", "17 13-23 * * MON"]);
  expect(crons[1]).toBe(REPORT_CRON);
  const { env, send } = setup();
  vi.useFakeTimers();
  vi.setSystemTime(monday);
  await worker.scheduled({ cron: crons[0], scheduledTime: monday } as ScheduledController, env);
  expect(send).not.toHaveBeenCalled();
  await worker.scheduled({ cron: crons[1], scheduledTime: monday } as ScheduledController, env);
  expect(send).toHaveBeenCalledTimes(1);
});
