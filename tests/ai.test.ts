import { describe, expect, it } from "vitest";
import { buildModelInputs, extractModelOutput, parseJsonLoose, runJsonTask, upstreamErrorCode, type Usage } from "../worker/ai.ts";
import { loadConfig } from "../worker/config.ts";
import type { Env } from "../worker/env.ts";

const env = (vars: Partial<Env>) => ({ AI: {} as Ai, ...vars }) as Env;
const messages = [
  { role: "system" as const, content: "sys" },
  { role: "user" as const, content: "hello" },
];
const schema = { type: "object" };

describe("model configuration", () => {
  it("uses the default model and profile", () => {
    const config = loadConfig(env({}));
    expect(config.structure.model).toBe("@cf/qwen/qwen3-30b-a3b-fp8");
    expect(config.structure.profile).toMatchObject({ apiStyle: "messages", responseFormat: "json_schema", promptSuffix: "/no_think" });
    expect(config.doodle.model).toBe(config.structure.model);
    expect(config.doodleEnabled).toBe(false);
  });

  it("switches models and call conventions purely through env vars", () => {
    const config = loadConfig(
      env({
        AI_MODEL: "@cf/openai/gpt-oss-120b",
        AI_DOODLE_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        AI_MAX_OUTPUT_TOKENS: "999999",
        AI_TEMPERATURE: "abc",
      }),
    );
    expect(config.structure.profile.apiStyle).toBe("responses");
    expect(config.doodle.profile.apiStyle).toBe("messages");
    expect(config.structure.maxOutputTokens).toBe(8192);
    expect(config.structure.temperature).toBe(0.3);

    const overridden = loadConfig(env({ AI_MODEL: "@cf/unknown/new-model", AI_RESPONSE_FORMAT: "none", AI_EXTRA_PARAMS: '{"top_p":0.9}' }));
    expect(overridden.structure.profile).toMatchObject({ apiStyle: "messages", responseFormat: "none", extraParams: { top_p: 0.9 } });
  });
});

describe("buildModelInputs", () => {
  it("builds Workers AI native JSON mode inputs", () => {
    const task = loadConfig(env({ AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" })).structure;
    const inputs = buildModelInputs(task, messages, "note", schema);
    expect(inputs).toMatchObject({ messages, max_tokens: 2048, response_format: { type: "json_schema", json_schema: schema } });
  });

  it("appends the model's prompt suffix to the last user message", () => {
    const task = loadConfig(env({})).structure;
    const inputs = buildModelInputs(task, messages, "note", schema) as { messages: Array<{ content: string }> };
    expect(inputs.messages[1].content).toBe("hello\n/no_think");
    expect(inputs.messages[0].content).toBe("sys");
  });

  it("builds OpenAI-compatible and Responses-style inputs", () => {
    const glm = loadConfig(env({ AI_MODEL: "@cf/zai-org/glm-5.3-flash" })).structure;
    expect(buildModelInputs(glm, messages, "note", schema)).toMatchObject({
      response_format: { type: "json_schema", json_schema: { name: "note", schema, strict: false } },
      reasoning_effort: "low",
    });
    const oss = loadConfig(env({ AI_MODEL: "@cf/openai/gpt-oss-120b" })).structure;
    expect(buildModelInputs(oss, messages, "note", schema)).toMatchObject({
      instructions: "sys",
      input: [{ role: "user", content: "hello" }],
      max_output_tokens: 2048,
      text: { format: { type: "json_schema", name: "note", schema } },
      reasoning: { effort: "low" },
    });
  });
});

describe("extractModelOutput", () => {
  it("reads every supported output shape", () => {
    expect(extractModelOutput("raw").text).toBe("raw");
    expect(extractModelOutput({ response: "{}" }).text).toBe("{}");
    expect(extractModelOutput({ response: { a: 1 } }).object).toEqual({ a: 1 });
    expect(extractModelOutput({ choices: [{ message: { content: "c" } }], usage: { prompt_tokens: 3, completion_tokens: 4 } })).toEqual({
      text: "c",
      usage: { promptTokens: 3, completionTokens: 4 },
    });
    expect(
      extractModelOutput({
        output: [
          { type: "reasoning", content: [{ type: "reasoning_text", text: "thinking" }] },
          { type: "message", content: [{ type: "output_text", text: "answer" }] },
        ],
        usage: { input_tokens: 5, output_tokens: 6 },
      }),
    ).toEqual({ text: "answer", usage: { promptTokens: 5, completionTokens: 6 } });
  });
});

describe("parseJsonLoose", () => {
  it("handles fences, think blocks and surrounding prose", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('<think>\n</think>\n{"a":2}')).toEqual({ a: 2 });
    expect(parseJsonLoose('Sure! Here it is: {"a":3} Hope this helps.')).toEqual({ a: 3 });
    expect(() => parseJsonLoose("no json")).toThrow();
  });
});

describe("upstreamErrorCode", () => {
  it("extracts Workers AI error numbers but never digits echoed from user text", () => {
    expect(upstreamErrorCode(new Error("InferenceUpstreamError: 3040: Capacity temporarily exceeded"))).toBe("3040");
    expect(upstreamErrorCode(new Error("5007: No such model"))).toBe("5007");
    expect(upstreamErrorCode(new Error("Invalid input near '预算 9876 万元'"))).toBeUndefined();
    expect(upstreamErrorCode(new Error("input: 2024: 年度计划"))).toBeUndefined();
  });
});

describe("runJsonTask", () => {
  it("reports accumulated usage even when every attempt is invalid", async () => {
    const task = { ...loadConfig(env({})).structure, maxRetries: 1, timeoutMs: 60_000 };
    const ai = { run: async () => ({ response: "not json", usage: { prompt_tokens: 100, completion_tokens: 20 } }) };
    const reports: Array<[number, Usage]> = [];
    await expect(
      runJsonTask(ai, task, {
        system: "s",
        user: "u",
        schemaName: "x",
        schema: {},
        normalize: () => ({ ok: false, errors: ["bad"] }),
        invalidMessage: "invalid",
        onUsage: (attempts, usage) => reports.push([attempts, usage]),
      }),
    ).rejects.toMatchObject({ code: "AI_OUTPUT_INVALID" });
    expect(reports.at(-1)).toEqual([2, { promptTokens: 200, completionTokens: 40 }]);
  });

  it("asks the model to fix failed checks, then keeps a valid result instead of failing", async () => {
    const task = { ...loadConfig(env({})).structure, maxRetries: 1, timeoutMs: 60_000 };
    const outputs = ["中文", "仍是中文", "English"];
    const calls: Array<Record<string, any>> = [];
    const ai = { run: async (_model: string, inputs: Record<string, unknown>) => { calls.push(inputs); return { response: JSON.stringify(outputs[calls.length - 1]) }; } };
    const job = {
      system: "s",
      user: "u",
      schemaName: "x",
      schema: {},
      normalize: (raw: unknown) => ({ ok: true as const, value: String(raw), warnings: [] }),
      check: (value: string) => (/^[A-Za-z]+$/.test(value) ? [] : ["wrong language"]),
      invalidMessage: "invalid",
    };
    const kept = await runJsonTask(ai, task, job);
    expect(kept).toMatchObject({ value: "中文", attempts: 2, warnings: ["wrong language"] });
    expect(calls[1].messages.at(-1).content).toContain("wrong language");

    outputs.splice(0, 2, "中文");
    calls.length = 0;
    expect(await runJsonTask(ai, task, job)).toMatchObject({ value: "English", attempts: 2, warnings: ["模型输出经过一次修复"] });

    // A failed repair call (timeout, quota) must not throw away the valid first result.
    for (const failure of [new Error("Request timed out"), new Error("4006: daily free allocation exceeded")]) {
      let n = 0;
      const failing = { run: async () => { if (n++ === 0) return { response: JSON.stringify("中文") }; throw failure; } };
      expect(await runJsonTask(failing, task, job)).toMatchObject({ value: "中文", attempts: 2, warnings: ["wrong language"] });
    }
  });
});
