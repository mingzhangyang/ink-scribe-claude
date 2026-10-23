import fs from "node:fs";
import path from "node:path";
import { fillSource } from "./input.mjs";

const READY = '.note-page[data-render-status="ready"]';
const FONT_ERROR = '.note-fit-status[data-fit-status="font-error"]';
const TIMEOUT = 30_000;

// Read authored state separately from fitted dimensions: the real font can legitimately
// change text size or expand a page after its download succeeds.
function documentState() {
  const note = document.querySelector(".note-page");
  const content = note.cloneNode(true);
  content.querySelectorAll("[data-export-ignore]").forEach((node) => node.remove());
  return {
    href: location.href,
    title: note.querySelector(".note-title")?.textContent ?? "",
    text: content.textContent,
    source: document.querySelector(".source-text")?.value ?? null,
    settings: JSON.parse(localStorage.getItem("ink-scribe:v1") ?? "null")?.state?.settings ?? null,
    appearance: {
      classes: [...note.classList].filter((value) => /^(paper|layout)-/.test(value)),
      variables: ["--hand-font", "--paper", "--paper-line", "--ink", "--accent", "--jit", "--ls"]
        .map((name) => [name, note.style.getPropertyValue(name)]),
    },
    stickers: [...note.querySelectorAll(".sticker")].map((sticker) => ({
      style: sticker.getAttribute("style"),
      art: sticker.querySelector("svg")?.outerHTML ?? "",
    })),
  };
}

/** Exercise HTTP font failures in a fresh browser context, without replacing FontFace APIs. */
export async function verifyFontRetry({ newPage, check, url, outputDir, mode }) {
  if (mode !== "editor" && mode !== "view") throw new Error(`Unknown font retry mode: ${mode}`);
  const editor = mode === "editor";
  const prefix = editor ? "FR-E" : "FR-V";
  const label = editor ? "编辑器" : "公开查看页";
  const targetFamily = editor ? "Ma Shan Zheng" : "Kalam";
  const healthyFamily = editor ? "Kalam" : "LXGW WenKai Screen";
  // Fontsource declares a woff fallback too. Block both or a failed woff2 download
  // silently succeeds through that fallback and never exercises the error state.
  const targetUrl = editor ? /\/ma-shan-zheng[^/?]*\.woff2?(?:\?.*)?$/ : /\/kalam[^/?]*\.woff2?(?:\?.*)?$/;
  const healthyUrl = editor ? /\/kalam[^/?]*\.woff2?(?:\?.*)?$/ : /\/lxgwwenkaigbscreen[^/?]*\.woff2?(?:\?.*)?$/;
  const { context, page } = await newPage();
  let blocked = true;
  const intercepted = [];
  const fontRequests = [];
  const healthyResources = new Set();
  const successfulTargetResponses = [];
  const marker = `font-retry-${mode}-${Date.now()}`;
  let stage = "initial font failure";

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    page.on("request", (request) => {
      if (request.resourceType() === "font") fontRequests.push(request.url());
    });
    page.on("response", (response) => {
      if (response.request().resourceType() !== "font" || !response.ok()) return;
      if (healthyUrl.test(response.url())) healthyResources.add(new URL(response.url()).pathname);
      if (targetUrl.test(response.url())) successfulTargetResponses.push(response.url());
    });
    await page.route(targetUrl, async (route) => {
      intercepted.push({ url: route.request().url(), blocked });
      if (blocked) {
        await route.fulfill({ status: 503, contentType: "text/plain", headers: { "Cache-Control": "no-store" }, body: "" });
      } else {
        await route.continue();
      }
    });

    await page.goto(url, { waitUntil: "networkidle" });
    if (editor) {
      await page.locator(READY).waitFor({ timeout: TIMEOUT });
      await fillSource(page, `字体重试后应保留的输入：${marker}`);
      await page.getByRole("tab", { name: "贴纸", exact: true }).click();
      await page.getByTitle("和纸胶带 · 薄荷", { exact: true }).click();
      await page.getByRole("tab", { name: "样式", exact: true }).click();
      await page.locator(".field").filter({ hasText: "中文字体" }).locator("select").selectOption("ma-shan-zheng");
    }
    await page.locator(FONT_ERROR).waitFor({ timeout: TIMEOUT });
    // Promise.all may reject while the other family's downloads are still completing.
    // Wait for those real requests to settle before observing retry-only traffic.
    await page.evaluate(() => document.fonts.ready);
    if (editor) {
      await page.getByRole("tab", { name: "导出", exact: true }).click();
      await page.getByRole("radio", { name: "PNG（无损）", exact: true }).click();
      await page.getByRole("radio", { name: "1x", exact: true }).click();
    }
    const download = page.getByRole("button", { name: "下载图片", exact: true });
    const failedWoff2 = intercepted.filter((request) => request.blocked && /\.woff2(?:\?|$)/.test(request.url)).length;
    check(`${prefix}1`, `${label}真实字体文件 503 后提示失败并禁止下载`,
      failedWoff2 > 0 && await download.isDisabled()
        && await page.locator(".note-page").getAttribute("data-render-status") === "font-error",
      `${targetFamily}: ${failedWoff2} woff2 failures, ${intercepted.length} total font requests`);

    const before = await page.evaluate(documentState);
    const healthySnapshot = await page.evaluate(({ marker, healthyFamily }) => {
      const normalize = (family) => family.replace(/^["']|["']$/g, "");
      const face = [...document.fonts].find((item) => normalize(item.family) === healthyFamily && item.status === "loaded");
      window.__fontRetryProbe = { marker, note: document.querySelector(".note-page"), healthyFace: face };
      return { loaded: !!face };
    }, { marker, healthyFamily });
    const healthyBefore = new Set(healthyResources);
    const requestsBeforeRetries = fontRequests.length;

    if (editor) {
      stage = "retry while HTTP 503 persists";
      const beforeBlockedRetry = intercepted.length;
      // Await a new request as well as the returning error state, so the previous
      // error banner alone cannot make this assertion pass.
      await Promise.all([
        page.waitForEvent("request", { predicate: (request) => targetUrl.test(request.url()), timeout: TIMEOUT }),
        page.locator(`${FONT_ERROR} button`).click(),
      ]);
      await page.locator(FONT_ERROR).waitFor({ timeout: TIMEOUT });
      await page.evaluate(() => document.fonts.ready);
      const repeatedFailures = intercepted.slice(beforeBlockedRetry).filter((request) => request.blocked);
      check(`${prefix}2`, "网络仍失败时再次重试会重新请求字体并保留重试入口", repeatedFailures.length > 0
        && repeatedFailures.some((request) => /\.woff2(?:\?|$)/.test(request.url))
        && await download.isDisabled() && await page.locator(`${FONT_ERROR} button`).isEnabled(),
      `${repeatedFailures.length} new failed requests`);
    }

    stage = "retry after network recovery";
    const beforeRecovery = intercepted.length;
    const successfulBeforeRecovery = successfulTargetResponses.length;
    blocked = false;
    await page.locator(`${FONT_ERROR} button`).click();
    await page.locator(READY).waitFor({ timeout: TIMEOUT });
    await page.evaluate(() => document.fonts.ready);
    const recovery = await page.evaluate(({ targetFamily, healthyFamily, marker }) => {
      const normalize = (family) => family.replace(/^["']|["']$/g, "");
      const note = document.querySelector(".note-page");
      const text = `${note.textContent ?? ""}0123456789.?✦`;
      const probe = window.__fontRetryProbe;
      const healthyText = healthyFamily === "Kalam" ? "0123456789" : text.match(/\p{Script=Han}/u)?.[0] ?? "?";
      return {
        targetLoaded: document.fonts.check(`20px "${targetFamily}"`, text)
          && [...document.fonts].some((face) => normalize(face.family) === targetFamily && face.status === "loaded"),
        healthyLoaded: document.fonts.check(`20px "${healthyFamily}"`, healthyText)
          && [...document.fonts].some((face) => normalize(face.family) === healthyFamily && face.status === "loaded"),
        sameDocument: probe?.marker === marker && probe.note === note,
        // CSSOM updates may reconstruct other faces in the same stylesheet. Their
        // identity is diagnostic; loaded state and no repeat network request are the contract.
        sameHealthyFace: !!probe?.healthyFace && document.fonts.has(probe.healthyFace),
      };
    }, { targetFamily, healthyFamily, marker });
    const recoveredRequests = intercepted.slice(beforeRecovery).filter((request) => !request.blocked);
    const recoveredResponses = successfulTargetResponses.slice(successfulBeforeRecovery);
    check(`${prefix}3`, `${label}网络恢复后在原页面重新下载字体并完成排版`,
      recoveredRequests.length > 0 && recoveredResponses.some((request) => /\.woff2(?:\?|$)/.test(request))
        && recovery.targetLoaded && recovery.sameDocument && await download.isEnabled(),
      `${recoveredRequests.length} new requests, ${recoveredResponses.length} successful font responses; ${JSON.stringify(recovery)}`);

    const after = await page.evaluate(documentState);
    check(`${prefix}4`, `${label}字体重试保留笔记、贴纸和外观设置${editor ? "及未提交的输入" : ""}`,
      !!before.title && before.stickers.length > 0 && JSON.stringify(before) === JSON.stringify(after)
        && (!editor || after.source.includes(marker) && after.settings?.zhFont === "ma-shan-zheng"),
      `same state: ${JSON.stringify(before) === JSON.stringify(after)}; ${after.stickers.length} stickers`);
    const repeatedHealthyRequests = fontRequests.slice(requestsBeforeRetries)
      .filter((request) => healthyBefore.has(new URL(request).pathname));
    check(`${prefix}5`, `${label}已成功的 ${healthyFamily} 字体保持可用且无需再次下载`,
      healthySnapshot.loaded && healthyBefore.size > 0 && recovery.healthyLoaded && repeatedHealthyRequests.length === 0,
      `${healthyBefore.size} original resources; ${repeatedHealthyRequests.length} repeat requests; same face identity: ${recovery.sameHealthyFace}`);

    stage = "PNG download after recovery";
    const size = await page.locator(".note-page").evaluate((note) => ({ width: note.offsetWidth, height: note.offsetHeight }));
    const [saved] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      download.click(),
    ]);
    const file = path.join(outputDir, `font-retry-${mode}.png`);
    await saved.saveAs(file);
    const png = fs.readFileSync(file);
    const signature = png.length >= 24 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const width = signature ? png.readUInt32BE(16) : 0;
    const height = signature ? png.readUInt32BE(20) : 0;
    const scale = editor ? 1 : 2;
    check(`${prefix}6`, `${label}字体恢复后可实际导出完整 PNG`,
      signature && width === size.width * scale && height === size.height * scale,
      `${width}×${height}; expected ${size.width * scale}×${size.height * scale}; ${png.length} bytes`);
    check(`${prefix}7`, `${label}字体失败及恢复全过程没有未处理错误`, page.errors.length === 0, page.errors.join("; "));
  } catch (error) {
    check(`${prefix}-flow`, `${label}真实字体重试流程完成`, false, `${stage}: ${error.message}`);
  } finally {
    await context.close();
  }
}
