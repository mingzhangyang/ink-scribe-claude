import { loadConfig } from "./config.ts";
import type { Env } from "./env.ts";

const DAY = 86_400_000;
export const REPORT_CRON = "17 13-23 * * 1";

/** Last complete UTC calendar week; only Monday's bounded delivery window may send. */
export function reportWindow(now: number) {
  const date = new Date(now);
  if (date.getUTCDay() !== 1 || date.getUTCHours() < 13 || date.getUTCHours() > 23) return null;
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { start: end - 7 * DAY, end };
}

type Funnel = { creations: number; attempted: number; generated: number; ready: number; useful: number; first_creations: number };
type Failure = { name: string; code: string; events: number };
type Latency = { attempts: number; median_ms: number | null; p95_ms: number | null };

export async function buildWeeklyReport(db: D1Database, start: number, end: number) {
  const funnel = await db.prepare(`WITH cohort AS (
    SELECT creation_id, MAX(is_first) AS is_first FROM creation_events
    WHERE source = 'own' AND name = 'creation_started' AND received_at >= ? AND received_at < ?
    GROUP BY creation_id
  ), stages AS (
    SELECT c.creation_id, c.is_first,
      MAX(e.name = 'generation_started') AS attempted,
      MAX(e.name = 'generation_completed') AS generated,
      MAX(e.name = 'note_ready') AS ready,
      MAX(e.name IN ('library_save_completed', 'export_completed', 'share_completed')) AS useful
    FROM cohort c JOIN creation_events e USING (creation_id)
    WHERE e.received_at >= ? AND e.received_at < ? GROUP BY c.creation_id, c.is_first
  ) SELECT COUNT(*) AS creations, COALESCE(SUM(is_first), 0) AS first_creations,
    COALESCE(SUM(attempted), 0) AS attempted, COALESCE(SUM(generated), 0) AS generated,
    COALESCE(SUM(ready), 0) AS ready, COALESCE(SUM(useful), 0) AS useful FROM stages`
  ).bind(start, end, start, end).first<Funnel>();
  const failures = await db.prepare(`SELECT name, json_extract(payload, '$.code') AS code, COUNT(*) AS events
    FROM creation_events WHERE source = 'own' AND name LIKE '%failed' AND received_at >= ? AND received_at < ?
    GROUP BY name, code ORDER BY events DESC, name, code`).bind(start, end).all<Failure>();
  const latency = await db.prepare(`WITH durations AS (
    SELECT json_extract(payload, '$.durationMs') AS ms,
      ROW_NUMBER() OVER (ORDER BY json_extract(payload, '$.durationMs')) AS rank, COUNT(*) OVER () AS total
    FROM creation_events WHERE source = 'own' AND name = 'generation_completed'
      AND json_extract(payload, '$.mode') = 'ai' AND received_at >= ? AND received_at < ?
  ) SELECT COUNT(*) AS attempts,
    AVG(CASE WHEN rank IN ((total + 1) / 2, (total + 2) / 2) THEN ms END) AS median_ms,
    MAX(CASE WHEN rank = (total * 95 + 99) / 100 THEN ms END) AS p95_ms FROM durations`
  ).bind(start, end).first<Latency>();
  if (!funnel || !latency) throw new Error("Weekly report query returned no summary");
  const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const period = `${date(start)} — ${date(end - DAY)}`;
  const pct = (n: number) => funnel.creations ? `${(100 * n / funnel.creations).toFixed(1)}%` : "—";
  return {
    subject: `InkScribe 每周创作报告 · ${period}`,
    text: [
      `InkScribe 每周创作报告`, `统计周期：${period}（UTC，周一至周日）`, "",
      `开始创作：${funnel.creations} 次（浏览器首次标记：${funnel.first_creations} 次）`,
      `尝试生成：${funnel.attempted} 次`, `生成成功：${funnel.generated} 次`,
      `排版就绪：${funnel.ready} 次`, `保存／导出／分享成功：${funnel.useful} 次`,
      `生成成功创作占比：${pct(funnel.generated)}`, `有效成果占比：${pct(funnel.useful)}`, "",
      `AI 成功尝试：${latency.attempts} 次`, `耗时中位数：${latency.median_ms === null ? "无样本" : `${latency.median_ms} ms`}`,
      `耗时 P95：${latency.p95_ms === null ? "无样本" : `${latency.p95_ms} ms`}`, "", "失败分类（事件次数）：",
      ...failures.results.map((f) => `- ${f.name} / ${f.code}：${f.events}`),
      ...(failures.results.length ? [] : ["无已记录失败"]), "",
      ...(funnel.creations ? [] : ["本周未记录到自有内容创作。零数据也可能来自采集未启用、离线或被拦截。", ""]),
      "口径：统计页面会话中的创作，不是独立用户；排除内置示例。漏斗按本周开始的创作去重，成果仅计本周内发生的事件。",
      "失败与 AI 耗时按本周事件统计，可能包含更早开始的创作；仅成功 AI 尝试参与耗时计算。",
      "首次标记依赖浏览器存储，未知也可能计为非首次。采集可能漏报；下载完成表示已交给浏览器，不代表已保存到磁盘。",
      "报告仅含聚合数据，不含原文、笔记标题或用户身份。",
    ].join("\n"),
  };
}

type Delivery = { payload: string; accepted_at: number | null };

/** Frozen payload + provider idempotency protects concurrent calls and ambiguous timeouts. */
export async function sendWeeklyReport(env: Env, now = Date.now()): Promise<void> {
  if (env.WEEKLY_REPORT_ENABLED !== "true" || loadConfig(env).mock) return;
  const window = reportWindow(now);
  if (!window) return;
  if (!env.DB || !env.RESEND_API_KEY || !env.WEEKLY_REPORT_FROM || !env.WEEKLY_REPORT_TO) {
    throw new Error("Weekly report configuration incomplete");
  }
  const db = env.DB;
  let delivery = await db.prepare("SELECT payload, accepted_at FROM weekly_report_deliveries WHERE period_end = ?").bind(window.end).first<Delivery>();
  if (!delivery) {
    const report = await buildWeeklyReport(db, window.start, window.end);
    const payload = JSON.stringify({ from: env.WEEKLY_REPORT_FROM, to: [env.WEEKLY_REPORT_TO], ...report });
    await db.prepare("INSERT OR IGNORE INTO weekly_report_deliveries (period_end, payload) VALUES (?, ?)").bind(window.end, payload).run();
    delivery = await db.prepare("SELECT payload, accepted_at FROM weekly_report_deliveries WHERE period_end = ?").bind(window.end).first<Delivery>();
  }
  if (!delivery) throw new Error("Weekly report snapshot missing");
  if (delivery.accepted_at !== null) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `ink-scribe-weekly/${window.end}` },
    body: delivery.payload, signal: AbortSignal.timeout(15_000),
  });
  // Never log response bodies: provider errors can contain recipient or credential details.
  if (!response.ok) throw new Error(`Weekly report provider HTTP ${response.status}`);
  const result = await response.json() as { id?: unknown };
  if (typeof result.id !== "string" || !result.id) throw new Error("Weekly report provider response missing ID");
  await db.prepare("UPDATE weekly_report_deliveries SET accepted_at = ?, provider_id = ? WHERE period_end = ? AND accepted_at IS NULL")
    .bind(now, result.id, window.end).run();
  console.log(JSON.stringify({ event: "weekly_report.accepted", periodEnd: window.end }));
}
