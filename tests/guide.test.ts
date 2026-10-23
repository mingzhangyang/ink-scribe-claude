import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getGuideExamples, type GuideLocale } from "../shared/guide.ts";
import { validatePublishRequest } from "../shared/publishing.ts";

const ORIGIN = "https://ink.example";

/** Run the copyable shell example with a fake curl: no requests or real keys are used. */
function runExample(locale: GuideLocale, preflightExit = 0) {
  const directory = mkdtempSync(join(tmpdir(), "ink-guide-"));
  try {
    const example = getGuideExamples(ORIGIN, locale);
    const result = spawnSync("/bin/sh", ["-c", `
guide_call_count=0
curl() {
  guide_call_count=$((guide_call_count + 1))
  printf '%s\\0' "$@" > "$GUIDE_TEST_DIR/$guide_call_count"
  if [ "$guide_call_count" -eq 1 ]; then
    return "$GUIDE_TEST_PREFLIGHT_EXIT"
  fi
  return 0
}
${example.curl}
`], {
      encoding: "utf8",
      timeout: 5000,
      env: {
        PATH: process.env.PATH,
        GUIDE_TEST_DIR: directory,
        GUIDE_TEST_PREFLIGHT_EXIT: String(preflightExit),
        INKSCRIBE_API_KEY: "test-key-never-sent",
        INKSCRIBE_IDEMPOTENCY_KEY: "guide-contract-test",
      },
    });
    const calls: string[][] = [];
    for (let number = 1; existsSync(join(directory, String(number))); number++) {
      calls.push(readFileSync(join(directory, String(number)), "utf8").split("\0").slice(0, -1));
    }
    return { example, result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("copyable guide examples", () => {
  it.each(["zh", "en"] as const)("validates and publishes the same valid %s request without source text", (locale) => {
    const { example, result, calls } = runExample(locale);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(calls).toHaveLength(2);
    const payload = JSON.parse(example.json);
    expect(validatePublishRequest(payload)).toEqual({ ok: true, value: payload });
    expect(payload.schemaVersion).toBe(1);
    expect(payload).not.toHaveProperty("text");
    expect(payload.visibility).toBe("unlisted");

    for (const [index, args] of calls.entries()) {
      expect(args).toContain(`${ORIGIN}/api/v1/notes${index === 0 ? "/validate" : ""}`);
      expect(args).toContain("Authorization: Bearer test-key-never-sent");
      expect(args).toContain("Content-Type: application/json");
      expect(args[args.indexOf("--data-binary") + 1]).toBe(example.json);
    }
    expect(calls[0]).not.toContain("Idempotency-Key: guide-contract-test");
    expect(calls[1]).toContain("Idempotency-Key: guide-contract-test");
  });

  it("stops before publishing when the preflight request fails", () => {
    const { result, calls } = runExample("en", 22);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(22);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`${ORIGIN}/api/v1/notes/validate`);
  });
});
