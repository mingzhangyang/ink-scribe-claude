import type { StructureRequest, StructureResponse } from "../../shared/api.ts";
import { structureLocally } from "../../shared/heuristic.ts";
import { NOTE_JSON_SCHEMA, normalizeNoteStructure, type NoteStructure } from "../../shared/note.ts";
import { DETAILS, isOneOf, LANGUAGES, STYLES, TEMPLATES } from "../../shared/options.ts";
import { charLength, cleanText } from "../../shared/text.ts";
import { runJsonTask, type AiBinding } from "../ai.ts";
import { AppError, jsonResponse, readJsonBody } from "../http.ts";
import { buildStructureMessages } from "../prompts.ts";
import type { RouteContext } from "../router.ts";

function enumField<T extends string>(body: Record<string, unknown>, field: string, values: readonly T[], fallback: T): T {
  const value = body[field];
  if (value === undefined || value === null || value === "") return fallback;
  if (!isOneOf(values, value)) {
    throw new AppError(400, "INVALID_REQUEST", `${field} 取值无效，可选值：${values.join(", ")}。`);
  }
  return value;
}

export function validateStructureRequest(body: unknown, maxInputChars: number): StructureRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "INVALID_REQUEST", "请求体必须是 JSON 对象。");
  }
  const record = body as Record<string, unknown>;
  if (typeof record.text !== "string" || record.text.trim() === "") {
    throw new AppError(400, "INVALID_REQUEST", "请粘贴需要整理的文本。");
  }
  const length = charLength(record.text);
  if (length > maxInputChars) {
    throw new AppError(413, "TEXT_TOO_LONG", `文本过长（${length} 字），请控制在 ${maxInputChars} 字以内。`);
  }
  const text = cleanText(record.text, maxInputChars, { multiline: true });
  if (charLength(text) < 2) {
    throw new AppError(400, "INVALID_REQUEST", "文本内容过短，无法整理。");
  }
  return {
    text,
    template: enumField(record, "template", TEMPLATES, "general"),
    language: enumField(record, "language", LANGUAGES, "auto"),
    style: enumField(record, "style", STYLES, "hybrid-cornell"),
    detail: enumField(record, "detail", DETAILS, "standard"),
  };
}

export async function handleStructure(ctx: RouteContext): Promise<Response> {
  const { request, env, config, log } = ctx;
  const body = await readJsonBody(request, config.maxBodyBytes);
  const input = validateStructureRequest(body, config.maxInputChars);
  log.inputChars = charLength(input.text);
  log.template = input.template;
  log.style = input.style;

  let note: NoteStructure;
  let warnings: string[] = [];
  let attempts = 0;
  let model: string;

  if (config.mock) {
    note = structureLocally(input.text, { template: input.template, detail: input.detail });
    model = "local-heuristic";
    log.mock = true;
  } else {
    model = config.structure.model;
    log.model = model;
    const { system, user } = buildStructureMessages({ ...input, detail: input.detail ?? "standard" });
    const result = await runJsonTask(env.AI as unknown as AiBinding, config.structure, {
      system,
      user,
      schemaName: "note_structure",
      schema: NOTE_JSON_SCHEMA as unknown as Record<string, unknown>,
      normalize: normalizeNoteStructure,
      invalidMessage: "无法生成有效的笔记结构，请重试。",
    });
    note = result.value;
    warnings = result.warnings;
    attempts = result.attempts;
    log.attempts = attempts;
    log.promptTokens = result.usage.promptTokens;
    log.completionTokens = result.usage.completionTokens;
  }
  log.warnings = warnings.length;

  const response: StructureResponse = {
    note,
    meta: {
      requestId: ctx.requestId,
      model,
      latencyMs: Date.now() - ctx.startedAt,
      attempts,
      warnings,
      ...(config.mock ? { mock: true } : {}),
    },
  };
  return jsonResponse(response);
}
