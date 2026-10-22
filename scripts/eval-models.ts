/**
 * Workers AI 候选模型评测脚本。
 *
 * 复用 Worker 的提示词、调用约定、输出解析与 NoteStructure 校验逻辑，通过 Cloudflare REST API
 * 对评测集逐一调用候选模型，统计结构合规率、修复次数、延迟、token 用量、估算成本与忠实度指标。
 *
 * 用法：
 *   CLOUDFLARE_ACCOUNT_ID=xxx CLOUDFLARE_API_TOKEN=xxx npm run eval:models
 *   npm run eval:models -- --models @cf/qwen/qwen3-30b-a3b-fp8,@cf/meta/llama-3.3-70b-instruct-fp8-fast
 *   npm run eval:models -- --cases zh-article,long --repeat 3 --prices scripts/prices.example.json
 *   npm run eval:models -- --mock      # 不访问网络，用本地整理器验证评测流程本身
 *
 * API Token 需要 “Workers AI: Read” 权限。结果写入 eval-results/（已加入 .gitignore）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { structureLocally } from "../shared/heuristic.ts";
import { NOTE_JSON_SCHEMA, normalizeNoteStructure, type NoteStructure } from "../shared/note.ts";
import { detectLanguage } from "../shared/text.ts";
import { runJsonTask, type AiBinding } from "../worker/ai.ts";
import { loadConfig } from "../worker/config.ts";
import type { Env } from "../worker/env.ts";
import { buildStructureMessages } from "../worker/prompts.ts";
import { EVAL_CASES, type EvalCase } from "./eval-cases.ts";

const DEFAULT_MODELS = [
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/google/gemma-3-12b-it",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/qwen/qwen3.8-27b",
  "@cf/openai/gpt-oss-20b",
];

type Prices = Record<string, { input: number; output: number }>;

type RunResult = {
  model: string;
  caseId: string;
  ok: boolean;
  errorCode?: string;
  attempts: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd?: number;
  outputChars: number;
  languageMatch?: boolean;
  /** 输出中出现、原文中却没有的数字（疑似凭空编造）。 */
  unsupportedNumbers: string[];
  /** 因未逐字出现在正文中而被丢弃的重点词数量。 */
  droppedHighlights: number;
  keptHighlights: number;
  /** 输出中是否残留注入内容（URL、脚本标签等）。 */
  injectionLeak: boolean;
};

const { values: args } = parseArgs({
  options: {
    models: { type: "string" },
    cases: { type: "string" },
    repeat: { type: "string", default: "1" },
    prices: { type: "string" },
    mock: { type: "boolean", default: false },
  },
});

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!args.mock && (!accountId || !apiToken)) {
  console.error("请设置 CLOUDFLARE_ACCOUNT_ID 与 CLOUDFLARE_API_TOKEN，或使用 --mock 验证评测流程。");
  process.exit(1);
}

const models = args.mock ? ["local-heuristic"] : (args.models?.split(",").map((m) => m.trim()).filter(Boolean) ?? DEFAULT_MODELS);
const caseIds = args.cases?.split(",").map((c) => c.trim());
const cases = caseIds ? EVAL_CASES.filter((c) => caseIds.includes(c.id)) : EVAL_CASES;
const repeat = Math.max(1, Number(args.repeat) || 1);
const prices: Prices = args.prices ? (JSON.parse(readFileSync(args.prices, "utf8")) as Prices) : {};

/** 通过 REST API 调用 Workers AI，接口形态与 Worker 内的 AI binding 一致。 */
const restBinding: AiBinding = {
  async run(model, inputs) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(inputs),
    });
    const body = (await response.json().catch(() => ({}))) as { success?: boolean; result?: unknown; errors?: unknown };
    if (!response.ok || body.success === false) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
    }
    return body.result;
  },
};

/** --mock：把本地整理结果包装成模型输出，验证评测脚本的完整流程。 */
const mockBinding: AiBinding = {
  async run(_model, inputs) {
    const messages = inputs.messages as Array<{ content: string }>;
    const source = messages[1].content.match(/<source>\n([\s\S]*)\n<\/source>/)?.[1] ?? "";
    return { response: JSON.stringify(structureLocally(source, { template: "general" })), usage: { prompt_tokens: source.length, completion_tokens: 400 } };
  },
};

function noteText(note: NoteStructure): string {
  return [
    note.title,
    note.date ?? "",
    ...note.cues.flatMap((c) => [c.keyword, c.note]),
    ...note.sections.flatMap((s) => [s.heading ?? "", s.content]),
    note.summary,
  ].join("\n");
}

function unsupportedNumbers(output: string, source: string): string[] {
  const normalizedSource = source.replace(/[,，\s]/g, "");
  const numbers = output.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return [...new Set(numbers.filter((n) => !normalizedSource.includes(n.replace(/[,，]/g, ""))))];
}

async function runOnce(model: string, evalCase: EvalCase): Promise<RunResult> {
  const env = { AI: {} as Ai, AI_MODEL: model } as Env;
  const task = loadConfig(env).structure;
  const { system, user } = buildStructureMessages({
    text: evalCase.text,
    template: evalCase.template,
    language: evalCase.language,
    style: "hybrid-cornell",
    detail: "standard",
  });
  const started = Date.now();
  try {
    const result = await runJsonTask(args.mock ? mockBinding : restBinding, task, {
      system,
      user,
      schemaName: "note_structure",
      schema: NOTE_JSON_SCHEMA as unknown as Record<string, unknown>,
      normalize: normalizeNoteStructure,
      invalidMessage: "invalid",
    });
    const latencyMs = Date.now() - started;
    const text = noteText(result.value);
    const price = prices[model];
    const dropped = result.warnings
      .map((w) => Number(w.match(/丢弃了 (\d+) 个未出现在正文中的重点词/)?.[1] ?? 0))
      .reduce((a, b) => a + b, 0);
    return {
      model,
      caseId: evalCase.id,
      ok: true,
      attempts: result.attempts,
      latencyMs,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      costUsd: price
        ? (result.usage.promptTokens * price.input + result.usage.completionTokens * price.output) / 1_000_000
        : undefined,
      outputChars: Array.from(text).length,
      languageMatch: detectLanguage(text) === evalCase.expectedLanguage,
      unsupportedNumbers: unsupportedNumbers(text, evalCase.text),
      droppedHighlights: dropped,
      keptHighlights: result.value.sections.reduce((n, s) => n + s.highlights.length, 0),
      injectionLeak: /evil\.example|<script|pwned/i.test(text),
    };
  } catch (error) {
    const failure = error as { code?: string; cause?: unknown; message?: string };
    const code = failure.code ?? "ERROR";
    // 评测是运维工具，这里打印上游错误详情以便排查（生产 Worker 日志不会记录这些内容）
    console.error(`\n  ${code}: ${failure.cause instanceof Error ? failure.cause.message : (failure.message ?? "")}`);
    return {
      model,
      caseId: evalCase.id,
      ok: false,
      errorCode: code,
      attempts: 0,
      latencyMs: Date.now() - started,
      promptTokens: 0,
      completionTokens: 0,
      outputChars: 0,
      unsupportedNumbers: [],
      droppedHighlights: 0,
      keptHighlights: 0,
      injectionLeak: false,
    };
  }
}

const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");
function p95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

const results: RunResult[] = [];
for (const model of models) {
  for (const evalCase of cases) {
    for (let i = 0; i < repeat; i++) {
      process.stdout.write(`${model} × ${evalCase.id} (#${i + 1}) … `);
      const result = await runOnce(model, evalCase);
      results.push(result);
      console.log(result.ok ? `ok ${result.latencyMs}ms, attempts ${result.attempts}` : `failed ${result.errorCode}`);
    }
  }
}

const rows = models.map((model) => {
  const all = results.filter((r) => r.model === model);
  const ok = all.filter((r) => r.ok);
  const costs = ok.map((r) => r.costUsd).filter((c): c is number => c !== undefined);
  return [
    model,
    pct(ok.length, all.length),
    pct(ok.filter((r) => r.attempts === 1).length, all.length),
    `${Math.round(avg(ok.map((r) => r.latencyMs)))} / ${Math.round(p95(ok.map((r) => r.latencyMs)))}`,
    `${Math.round(avg(ok.map((r) => r.promptTokens)))} / ${Math.round(avg(ok.map((r) => r.completionTokens)))}`,
    costs.length ? `$${avg(costs).toFixed(5)}` : "-",
    pct(ok.filter((r) => r.languageMatch).length, ok.length),
    avg(ok.map((r) => r.unsupportedNumbers.length)).toFixed(2),
    `${ok.reduce((n, r) => n + r.keptHighlights, 0)} / ${ok.reduce((n, r) => n + r.droppedHighlights, 0)}`,
    String(ok.filter((r) => r.injectionLeak).length),
    Math.round(avg(ok.map((r) => r.outputChars))).toString(),
  ];
});

const header = [
  "模型",
  "成功率",
  "首次即合规",
  "延迟 avg/p95 (ms)",
  "token 输入/输出",
  "估算成本/篇",
  "语言正确",
  "疑似编造数字",
  "重点词 保留/丢弃",
  "注入泄漏",
  "输出字数",
];
const table = [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...rows.map((r) => `| ${r.join(" | ")} |`),
].join("\n");

const date = new Date().toISOString();
console.log(`\n评测时间：${date}\n用例：${cases.map((c) => c.id).join(", ")}，每例重复 ${repeat} 次\n`);
console.log(table);

mkdirSync("eval-results", { recursive: true });
const file = `eval-results/eval-${date.replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ date, models, cases: cases.map((c) => c.id), repeat, prices, results, table }, null, 2));
console.log(`\n详细结果已写入 ${file}`);
