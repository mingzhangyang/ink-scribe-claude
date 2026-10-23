import { afterEach, describe, expect, it, vi } from "vitest";
import { preparePaperTexture } from "../src/export/paperTexture.ts";

afterEach(() => vi.unstubAllGlobals());

describe("export paper textures", () => {
  function snapshot(background: string): HTMLElement {
    vi.stubGlobal("getComputedStyle", () => ({ backgroundImage: background }));
    return { style: { backgroundImage: "" } } as unknown as HTMLElement;
  }

  it("keeps gradients untouched when no embedded SVG texture is present", async () => {
    const node = snapshot("linear-gradient(#eee 1px, transparent 1px)");
    const image = vi.fn();
    vi.stubGlobal("Image", image);
    await preparePaperTexture(node);
    expect(image).not.toHaveBeenCalled();
    expect(node.style.backgroundImage).toBe("");
  });

  it("replaces only embedded texture tiles and preserves their dimensions and other layers", async () => {
    const source = "data:image/svg+xml,%3Csvg%20id='paper-a'/%3E";
    const node = snapshot(`url("${source}"), linear-gradient(#eee 1px, transparent 1px)`);
    const loaded: string[] = [];
    vi.stubGlobal("Image", class {
      naturalWidth = 240;
      naturalHeight = 200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) { loaded.push(value); queueMicrotask(() => this.onload?.()); }
    });
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: () => "data:image/png;base64,tile" };
    vi.stubGlobal("document", { createElement: () => canvas });
    await preparePaperTexture(node);
    expect(loaded).toEqual([source]);
    expect(canvas).toMatchObject({ width: 240, height: 200 });
    expect(drawImage).toHaveBeenCalledOnce();
    expect(node.style.backgroundImage).toBe('url("data:image/png;base64,tile"), linear-gradient(#eee 1px, transparent 1px)');
  });

  it("rejects a broken texture without replacing it or poisoning the retry cache", async () => {
    const source = "data:image/svg+xml,%3Csvg%20id='paper-retry'/%3E";
    const node = snapshot(`url("${source}")`);
    let fail = true;
    let attempts = 0;
    vi.stubGlobal("Image", class {
      naturalWidth = 240;
      naturalHeight = 240;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        attempts++;
        queueMicrotask(() => fail ? this.onerror?.() : this.onload?.());
      }
    });
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => "data:image/png;base64,retry" }) });
    await expect(preparePaperTexture(node)).rejects.toThrow("Paper texture could not be loaded");
    expect(node.style.backgroundImage).toBe("");
    fail = false;
    await expect(preparePaperTexture(node)).resolves.toBeUndefined();
    expect(attempts).toBe(2);
    expect(node.style.backgroundImage).toBe('url("data:image/png;base64,retry")');
  });
});
