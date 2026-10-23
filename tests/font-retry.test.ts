import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFontEmbedCss, ensureFontsLoaded } from "../src/export/fontEmbed.ts";

class FontRule {
  readonly properties: Record<string, string>;
  readonly style: { getPropertyValue: (name: string) => string; setProperty: (name: string, value: string) => void };

  constructor(family: string, src: string, descriptors: Record<string, string> = {}) {
    this.properties = { "font-family": family, src, ...descriptors };
    this.style = {
      getPropertyValue: (name) => this.properties[name] ?? "",
      setProperty: (name, value) => { this.properties[name] = value; },
    };
  }

  face(status: FontFaceLoadStatus) {
    return {
      family: this.properties["font-family"],
      style: this.properties["font-style"] || "normal",
      weight: this.properties["font-weight"] || "normal",
      stretch: this.properties["font-stretch"] || "normal",
      unicodeRange: this.properties["unicode-range"] || "U+0-10FFFF",
      status,
    };
  }
}

function fontDocument(rules: FontRule[], faces: ReturnType<FontRule["face"]>[]) {
  const fonts = Object.assign(new Set(faces), { load: vi.fn().mockResolvedValue([]), ready: Promise.resolve() });
  const document = { fonts, baseURI: "https://example.test/editor", styleSheets: [{ href: "https://example.test/assets/fonts.css", cssRules: rules }] };
  vi.stubGlobal("CSSFontFaceRule", FontRule);
  vi.stubGlobal("CSSImportRule", class {});
  vi.stubGlobal("document", document);
  return document;
}

afterEach(() => vi.unstubAllGlobals());

describe("retrying downloaded font faces", () => {
  it("resets only failed faces for the current family and note characters", async () => {
    const failed = new FontRule("Handwriting", 'url("latin.woff2")', { "unicode-range": "U+0-FF" });
    const loaded = new FontRule("Handwriting", 'url("cjk.woff2")', { "unicode-range": "U+4E00-9FFF" });
    const unused = new FontRule("Handwriting", 'url("greek.woff2")', { "unicode-range": "U+370-3FF" });
    const other = new FontRule("Other font", 'url("other.woff2")');
    const rules = [failed, loaded, unused, other];
    const originalSources = rules.map((rule) => rule.properties.src);
    fontDocument(rules, [failed.face("error"), loaded.face("loaded"), unused.face("error"), other.face("error")]);

    await ensureFontsLoaded(["Handwriting"], "A文");
    expect(rules.map((rule) => rule.properties.src)).toEqual(originalSources);
    await ensureFontsLoaded(["Handwriting"], "A文", { retryFailed: true });

    expect(failed.properties.src).toContain("latin.woff2?ink-font-retry=1");
    expect(rules.slice(1).map((rule) => rule.properties.src)).toEqual(originalSources.slice(1));
  });

  it("retries repeated failures from the original sources and retains all fallbacks", async () => {
    const rule = new FontRule("Kalam", 'local("My Handwriting"), url("./latin.woff2?version=2#font") format("woff2"), url("./latin.woff") format("woff")');
    const face = rule.face("error");
    const { fonts } = fontDocument([rule], [face]);
    fonts.load.mockRejectedValueOnce(new Error("Still offline"));
    await expect(ensureFontsLoaded(["Kalam"], "A", { retryFailed: true })).rejects.toThrow("Still offline");
    await ensureFontsLoaded(["Kalam"], "A", { retryFailed: true });

    expect(rule.properties.src).toBe('local("My Handwriting"), url("https://example.test/assets/latin.woff2?version=2&ink-font-retry=2#font") format("woff2"), url("https://example.test/assets/latin.woff?ink-font-retry=2") format("woff")');
    face.status = "loaded";
    const recoveredSource = rule.properties.src;
    await ensureFontsLoaded(["Kalam"], "A", { retryFailed: true });
    expect(rule.properties.src).toBe(recoveredSource);
  });

  it("finds later-loaded CSS and embeds the recovered source on export", async () => {
    const doc = fontDocument([], []);
    const lazy = new FontRule("Long Cang", 'url("./lazy.woff2") format("woff2")', { "font-weight": "400" });
    doc.styleSheets.push({ href: "https://example.test/lazy/fonts.css", cssRules: [lazy] });
    doc.fonts.add(lazy.face("error"));
    const fetch = vi.fn().mockResolvedValue(new Response(new Blob(["font"], { type: "font/woff2" })));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("FileReader", class {
      result = "data:font/woff2;base64,Zm9udA==";
      onload = () => {};
      readAsDataURL() { this.onload(); }
    });

    await ensureFontsLoaded(["Long Cang"], "文", { retryFailed: true });
    const css = await buildFontEmbedCss(["Long Cang"], "文");
    expect(fetch).toHaveBeenCalledWith("https://example.test/lazy/lazy.woff2?ink-font-retry=1", { cache: "force-cache" });
    expect(css).toContain('font-family:"Long Cang";');
    expect(css).toContain('font-weight:400;');
    expect(css).toContain('src:url(data:font/woff2;base64,Zm9udA==) format("woff2");');
  });
});
