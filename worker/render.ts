import type { Env, RenderJob } from "./env.ts";
import { logEvent } from "./log.ts";
import { getNoteRow, setImageResult } from "./store.ts";

/**
 * 预览图生成（Queue 消费者）：用 Browser Rendering 打开 /n/:id?render=1，
 * 等前端渲染与字体加载完成后对笔记页面截图，存入 R2 并更新 D1 中的状态。
 * 与网页导出使用同一套前端渲染，因此预览图与用户看到的页面一致。
 */

export const MAX_RENDER_ATTEMPTS = 3;
const DEVICE_SCALE = 2;

/** 渲染所需的最小浏览器接口，便于在测试中替换。 */
export interface RenderBrowser {
  newPage(): Promise<RenderPage>;
  close(): Promise<void>;
}
export interface RenderPage {
  setViewport(viewport: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  goto(url: string, options: { waitUntil: "networkidle0"; timeout: number }): Promise<unknown>;
  waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>;
  $(selector: string): Promise<RenderElement | null>;
  close(): Promise<void>;
}
export interface RenderElement {
  boundingBox(): Promise<{ width: number; height: number } | null>;
  screenshot(options: { type: "png" }): Promise<Uint8Array>;
}

export type LaunchBrowser = (binding: Fetcher) => Promise<RenderBrowser>;

// 按需加载 puppeteer，避免增大普通请求路径的 Worker 启动体积
const defaultLaunch: LaunchBrowser = async (binding) => {
  const { default: puppeteer } = await import("@cloudflare/puppeteer");
  return (await puppeteer.launch(binding)) as unknown as RenderBrowser;
};

export async function screenshotNote(browser: RenderBrowser, url: string): Promise<{ png: Uint8Array; width: number; height: number }> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 1300, deviceScaleFactor: DEVICE_SCALE });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
    // 前端在笔记渲染完成、字体加载完毕后设置该标记
    await page.waitForSelector('html[data-render-ready="true"]', { timeout: 20_000 });
    const element = await page.$(".note-page");
    if (!element) throw new Error("note page not found");
    const box = await element.boundingBox();
    const png = await element.screenshot({ type: "png" });
    return { png, width: Math.round((box?.width ?? 840) * DEVICE_SCALE), height: Math.round((box?.height ?? 1188) * DEVICE_SCALE) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function handleRenderBatch(batch: MessageBatch<RenderJob>, env: Env, launch: LaunchBrowser = defaultLaunch): Promise<void> {
  const { DB, IMAGES, BROWSER } = env;
  if (!DB || !IMAGES || !BROWSER) {
    batch.ackAll();
    return;
  }
  let browser: RenderBrowser;
  try {
    browser = await launch(BROWSER);
  } catch (error) {
    logEvent("render.launch_failed", { errorName: error instanceof Error ? error.name : "Error" });
    batch.retryAll({ delaySeconds: 30 });
    return;
  }
  try {
    for (const message of batch.messages) {
      const { id, origin } = message.body;
      try {
        const row = await getNoteRow(DB, id);
        if (!row) {
          message.ack(); // 笔记已删除
          continue;
        }
        const started = Date.now();
        const { png, width, height } = await screenshotNote(browser, `${origin}/n/${id}?render=1`);
        const key = `notes/${id}.png`;
        await IMAGES.put(key, png, { httpMetadata: { contentType: "image/png" } });
        await setImageResult(DB, id, { status: "ready", key, width, height });
        logEvent("render.done", { noteId: id, latencyMs: Date.now() - started, bytes: png.byteLength });
        message.ack();
      } catch (error) {
        const finalAttempt = message.attempts >= MAX_RENDER_ATTEMPTS;
        logEvent("render.failed", { noteId: id, attempt: message.attempts, final: finalAttempt, errorName: error instanceof Error ? error.name : "Error" });
        if (finalAttempt) {
          await setImageResult(DB, id, { status: "failed" }).catch(() => undefined);
          message.ack();
        } else {
          message.retry({ delaySeconds: 15 * message.attempts });
        }
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}
