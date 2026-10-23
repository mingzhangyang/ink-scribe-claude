// 浏览器端验收测试：对照实施计划第 7 节的验收标准逐条断言，输出 PASS / FAIL。
// 由 e2e/run.mjs 启动 mock 构建的预览服务后调用；也可对已运行的服务直接执行：
//   E2E_BASE_URL=http://127.0.0.1:4173/ node e2e/acceptance.mjs
import { chromium } from "playwright";
import { strToU8, zipSync } from "fflate";
import fs from "node:fs";
import { verifyFontRetry } from "./font-retry.mjs";
import { closeInput, fillSource, openInput } from "./input.mjs";

const SP = process.env.E2E_OUTPUT_DIR ?? "e2e-results";
const URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173/";
fs.mkdirSync(SP, { recursive: true });
const ORIGIN = new globalThis.URL(URL).origin;
const results = [];
const check = (id, name, ok, detail = "") => {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${id}] ${name}${detail ? ` — ${detail}` : ""}`);
};
const pngSize = (file) => {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), sig: b.subarray(1, 4).toString() };
};

// 可用 PLAYWRIGHT_CHROMIUM_PATH 指定本机已有的 Chromium
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});

async function newPage(options = {}, init) {
  // 界面语言按浏览器首选语言选择；除专门测试英文界面的用例外，都以中文浏览器运行
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, locale: "zh-CN", ...options });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of (4|5)\d\d/.test(m.text())) page.errors.push(m.text());
  });
  return { context, page };
}

async function waitForNoteReady(page) {
  await page.locator('.note-page[data-render-status="ready"]').waitFor({ timeout: 30_000 });
}

async function openAppMenu(page) {
  const toggle = page.locator(".app-menu-toggle");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await page.locator(".app-menu-panel").waitFor({ state: "visible" });
}

async function setAppPreference(page, preference, value) {
  await openAppMenu(page);
  await page.locator(`input[name="app-menu-${preference}"][value="${value}"]`).check();
  await page.locator(".app-menu-toggle").click();
}

// Measure actual text ranges independently of the renderer's status flag. Rotated handwriting
// may extend into a visible region's padding; only clipped regions and the paper edge matter.
function inspectNoteLayout(el, expected = []) {
  const bounds = el.getBoundingClientRect();
  const tolerance = 2 * bounds.width / el.offsetWidth;
  const text = el.innerText.replace(/\s+/g, "");
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let clipped = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent.trim() || node.parentElement?.closest("svg, .sticker-layer, [data-export-ignore]")) continue;
    range.selectNodeContents(node);
    if ([...range.getClientRects()].some((r) => r.width > 0 && r.height > 0 &&
      (r.top < bounds.top - tolerance || r.bottom > bounds.bottom + tolerance || r.left < bounds.left - tolerance || r.right > bounds.right + tolerance))) clipped++;
  }
  const overflowing = [...el.querySelectorAll("[data-fit]")].filter((region) => {
    const style = getComputedStyle(region);
    return (style.overflowY !== "visible" && region.scrollHeight > region.clientHeight + 2)
      || (style.overflowX !== "visible" && region.scrollWidth > region.clientWidth + 2);
  }).length;
  return {
    status: el.dataset.renderStatus,
    height: el.offsetHeight,
    width: el.offsetWidth,
    expanded: el.dataset.renderExpanded,
    pageSize: el.dataset.pageSize,
    missing: expected.filter((value) => !text.includes(value.replace(/\s+/g, ""))).length,
    clipped,
    overflowing,
  };
}

// ---------- A. 首屏 ----------
{
  const { page, context } = await newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  const title = await page.locator(".note-title").first().innerText();
  check("A1", "首屏渲染示例笔记且无脚本错误", title.includes("深度工作") && page.errors.length === 0, page.errors.join("; "));
  const csp = (await page.request.get(URL)).headers()["content-security-policy"] ?? "";
  check("A2", "静态资源带 CSP 响应头", csp.includes("script-src 'self'"));
  await context.close();
}

// ---------- B. 损坏的本地设置 ----------
{
  const bad = JSON.stringify({ state: { settings: { layout: "bogus", paper: 42, fontSize: "huge", naturalness: null } }, version: 0 });
  const { page, context } = await newPage({}, `try { localStorage.setItem("ink-scribe:v1", ${JSON.stringify(bad)}); } catch {}`);
  await page.goto(URL, { waitUntil: "networkidle" });
  const rendered = await page.locator(".note-page").count();
  check("B1", "本地设置损坏时页面仍可正常渲染", rendered === 1 && page.errors.length === 0, page.errors.slice(0, 1).join("; "));
  await context.close();
}

// ---------- C/D. 生成中英文笔记 ----------
const { page, context } = await newPage();
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
await page.goto(URL, { waitUntil: "networkidle" });

const apiResult = await page.evaluate(async () => {
  const r = await fetch("/api/structure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Spaced repetition beats cramming.\n\nActive recall strengthens memory.", template: "lecture-summary" }),
  });
  return { status: r.status, body: await r.json() };
});
const n = apiResult.body.note;
const contractOk =
  apiResult.status === 200 &&
  typeof n.title === "string" && n.title.length > 0 &&
  Array.isArray(n.cues) && n.cues.every((c) => typeof c.keyword === "string" && typeof c.note === "string") &&
  Array.isArray(n.sections) && n.sections.length > 0 &&
  n.sections.every((s) => typeof s.content === "string" && Array.isArray(s.highlights) && s.highlights.every((h) => s.content.toLowerCase().includes(h.toLowerCase()))) &&
  typeof n.summary === "string";
check("C1", "/api/structure 返回符合 NoteStructure 契约的结果", contractOk, `status ${apiResult.status}`);

await openInput(page);
await page.selectOption(".sample-picker select", "zh-reading");
await page.getByRole("button", { name: /转化为手写笔记/ }).click();
await page.waitForSelector(".badge-ai");
const zhLabels = await page.locator(".region-label").allInnerTexts();
check("C2", "中文文本生成笔记（中文标签）", (await page.locator(".note-title").first().innerText()).length > 0 && zhLabels.some((t) => t.includes("线索")));

// ---------- E. 字体（在中文笔记上切换，验证生产构建按需加载中文字体分片） ----------
await page.getByRole("tab", { name: "样式" }).click();
await page.locator(".field").filter({ hasText: "中文字体" }).locator("select").selectOption("ma-shan-zheng");
await page.locator(".field").filter({ hasText: "英文字体" }).locator("select").selectOption("caveat");
const zhTitle = (await page.locator(".note-title").first().innerText()).replace(/\s+/g, "");
await page.waitForFunction((t) => document.fonts.check('20px "Ma Shan Zheng"', t), zhTitle, { timeout: 20000 }).catch(() => {});
const fontInfo = await page.evaluate((t) => ({
  stack: getComputedStyle(document.querySelector(".note-page")).fontFamily,
  zhLoaded: document.fonts.check('20px "Ma Shan Zheng"', t),
}), zhTitle);
check("E1", "切换中英文字体，中文字体分片在生产构建中按需加载", fontInfo.stack.startsWith('Caveat, "Ma Shan Zheng"') && fontInfo.zhLoaded, JSON.stringify(fontInfo));
await verifyFontRetry({ newPage, check, url: URL, outputDir: SP, mode: "editor" });

await openInput(page);
await page.selectOption(".sample-picker select", "en-lecture");
await page.getByRole("button", { name: /转化为手写笔记/ }).click();
await page.waitForFunction(() => [...document.querySelectorAll(".region-label")].some((e) => e.textContent.includes("Cues")));
check("D1", "英文文本生成笔记（英文标签）", true);

// ---------- F. 纸张、墨水、版式 ----------
await page.getByRole("tab", { name: "样式" }).click();
await page.getByRole("radio", { name: "牛皮纸" }).click();
await page.getByRole("radio", { name: "复古棕" }).click();
await page.getByRole("radio", { name: /经典康奈尔/ }).click();
const look = await page.evaluate(() => {
  const el = document.querySelector(".note-page");
  return { cls: el.className, ink: el.style.getPropertyValue("--ink") };
});
check("F1", "切换纸张/墨水/版式即时生效", look.cls.includes("paper-kraft") && look.cls.includes("layout-classic-cornell") && look.ink === "#451A03", JSON.stringify(look));
for (const label of ["字号", "行距", "字距"]) {
  const input = page.locator(".range-field").filter({ hasText: label }).locator("input");
  await input.fill(label === "字号" ? "17" : label === "行距" ? "1.6" : "0.05");
}
const vars = await page.evaluate(() => {
  const s = document.querySelector(".note-page").style;
  return [s.getPropertyValue("--fs"), s.getPropertyValue("--lh"), s.getPropertyValue("--ls")];
});
check("F2", "字号/行距/字距可调", vars[0] === "17px" && vars[1] === "1.6" && vars[2] === "0.05em", vars.join(" "));

// ---------- G. 贴纸 ----------
await page.getByRole("tab", { name: "贴纸" }).click();
const doodleGrid = await page.locator(".doodle-palette").evaluate((grid) => {
  const panel = grid.getBoundingClientRect();
  const buttons = [...grid.children].map((el) => el.getBoundingClientRect());
  return {
    overflow: grid.scrollWidth - grid.clientWidth,
    lastRight: Math.round(Math.max(...buttons.map((b) => b.right)) - panel.right),
    square: buttons.every((b) => Math.abs(b.width - b.height) < 1),
  };
});
check("G7", "手绘插图库五列完整显示在面板内且按钮为正方形", doodleGrid.overflow <= 0 && doodleGrid.lastRight <= 0 && doodleGrid.square, JSON.stringify(doodleGrid));
await page.getByTitle("和纸胶带 · 薄荷").click();
const stickers = page.locator(".sticker");
const first = stickers.nth(0);
// 贴纸位于正文适配之外：拖动、缩放、旋转都不应让已完成的适配回到 pending
await waitForNoteReady(page);
await page.locator(".note-page").evaluate((el) => {
  window.__fitStatuses = [];
  window.__fitObserver = new MutationObserver(() => window.__fitStatuses.push(el.dataset.renderStatus));
  window.__fitObserver.observe(el, { attributes: true, attributeFilter: ["data-render-status"] });
});
const before = await first.evaluate((el) => ({ left: el.style.left, top: el.style.top }));
const box = await first.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 120, { steps: 6 });
await page.mouse.up();
const after = await first.evaluate((el) => ({ left: el.style.left, top: el.style.top }));
check("G2", "拖拽移动贴纸", before.left !== after.left && before.top !== after.top, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
const sbox = await page.locator(".handle-scale").boundingBox();
await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
await page.mouse.down();
await page.mouse.move(sbox.x + 60, sbox.y + 40, { steps: 5 });
await page.mouse.up();
const rbox = await page.locator(".handle-rotate").boundingBox();
await page.mouse.move(rbox.x + rbox.width / 2, rbox.y + rbox.height / 2);
await page.mouse.down();
await page.mouse.move(rbox.x + 90, rbox.y + 30, { steps: 5 });
await page.mouse.up();
const transform = await first.evaluate((el) => el.style.transform);
const m = transform.match(/rotate\(([-\d.]+)deg\) scale\(([\d.]+)\)/);
check("G3", "旋转与缩放贴纸", !!m && Number(m[2]) > 1 && Math.abs(Number(m[1])) > 20, transform);
const fitDuringDrag = await page.evaluate(() => {
  window.__fitObserver.disconnect();
  return window.__fitStatuses;
});
check("G8", "拖动、缩放和旋转贴纸不会重新适配页面", fitDuringDrag.length === 0, fitDuringDrag.join(","));
await page.getByTitle("便利贴 · 黄").click();
await page.getByRole("button", { name: "添加插图：书本·阅读" }).click();
check("G1", "添加贴纸与插图", (await stickers.count()) === 3);
await stickers.nth(0).focus(); // 选中最底层的胶带
const firstId = await stickers.nth(0).evaluate((el) => el.className);
await page.getByRole("button", { name: "置顶" }).click();
const lastClass = await stickers.nth(2).evaluate((el) => el.className);
check("G4", "调整贴纸层级（置顶）", firstId.includes("sticker-tape") && lastClass.includes("sticker-tape") && lastClass.includes("is-selected"), `${firstId} → last: ${lastClass}`);
await page.keyboard.press("Delete");
check("G5", "键盘删除选中贴纸", (await stickers.count()) === 2);

// ---------- G6. 贴纸重叠时手柄仍可操作 ----------
await page.getByTitle("便利贴 · 绿").click();
await page.evaluate(() => {
  const list = document.querySelectorAll(".sticker");
  const [under, over] = [list[0], list[list.length - 1]];
  over.style.left = under.style.left;
  over.style.top = `${parseFloat(under.style.top) - 30}px`;
});
await stickers.nth(0).focus(); // 通过键盘焦点选中被部分遮挡的下层贴纸
const covered = await page.evaluate(() => {
  const handle = document.querySelector(".handle-rotate");
  const r = handle.getBoundingClientRect();
  return !handle.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
});
const rot0 = await stickers.nth(0).evaluate((el) => el.style.transform);
const hb = await page.locator(".handle-rotate").boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(hb.x + 100, hb.y + 50, { steps: 5 });
await page.mouse.up();
const rot1 = await stickers.nth(0).evaluate((el) => el.style.transform);
check("G6", "贴纸重叠时选中贴纸的旋转手柄不被遮挡且可用", !covered && rot0 !== rot1 && (await stickers.nth(0).getAttribute("class")).includes("is-selected"), `${rot0} → ${rot1}`);
await page.keyboard.press("Delete");

// ---------- R1. 字体就绪后自动适配，避免以裁切后的画布导出 ----------
await page.getByRole("tab", { name: "样式" }).click();
await page.locator(".range-field").filter({ hasText: "字号" }).locator("input").fill("28");
await page.locator(".range-field").filter({ hasText: "行距" }).locator("input").fill("2.4");
await waitForNoteReady(page);
const autoFit = await page.locator(".note-page").evaluate(inspectNoteLayout);
check("R1", "大字号内容在字体就绪后自动适配且没有裁切", autoFit.status === "ready" && autoFit.clipped === 0 && autoFit.overflowing === 0, JSON.stringify(autoFit));

// Observe transitions as well as the final state: an unnecessary fit can finish between pointer events.
// Use a known long document; the generated sample can fit A4 after typography adaptation.
await page.getByRole("tab", { name: "内容" }).click();
const originalFitContent = await page.getByRole("textbox", { name: "段落 1 正文", exact: true }).inputValue();
await page.getByRole("textbox", { name: "段落 1 正文", exact: true }).fill("- Stable text.\n".repeat(60).trim());
await waitForNoteReady(page);
await page.getByRole("tab", { name: "贴纸" }).click();
await page.evaluate(() => {
  const node = document.querySelector(".note-page");
  const snapshot = () => ({
    status: node.dataset.renderStatus,
    expanded: node.dataset.renderExpanded,
    pageSize: node.dataset.pageSize,
    height: node.offsetHeight,
    fontSize: node.style.getPropertyValue("--fs"),
    lineHeight: node.style.getPropertyValue("--lh"),
  });
  const originalLoad = document.fonts.load;
  const probe = { before: snapshot(), fontLoads: 0, transitions: [] };
  document.fonts.load = function (...args) {
    probe.fontLoads++;
    return originalLoad.apply(this, args);
  };
  const collect = (records) => {
    for (const record of records) {
      probe.transitions.push({ attribute: record.attributeName, old: record.oldValue, value: node.getAttribute(record.attributeName) });
    }
  };
  const observer = new MutationObserver(collect);
  observer.observe(node, { attributes: true, attributeOldValue: true, attributeFilter: ["data-render-status", "data-page-size", "data-render-expanded", "style"] });
  window.finishStickerFitProbe = () => {
    collect(observer.takeRecords());
    observer.disconnect();
    document.fonts.load = originalLoad;
    delete window.finishStickerFitProbe;
    return { ...probe, after: snapshot() };
  };
});
await page.getByTitle("和纸胶带 · 薄荷").click();
const movingSticker = page.locator(".sticker-tape");
const geometryBefore = await movingSticker.evaluate((el) => ({ left: el.style.left, top: el.style.top, transform: el.style.transform }));
const dragBox = await movingSticker.boundingBox();
await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
await page.mouse.down();
await page.mouse.move(dragBox.x + dragBox.width / 2 + 70, dragBox.y + dragBox.height / 2 + 40, { steps: 10 });
await page.mouse.up();
const geometryMoved = await movingSticker.evaluate((el) => ({ left: el.style.left, top: el.style.top }));
for (const handle of [".handle-rotate", ".handle-scale"]) {
  const bounds = await page.locator(handle).boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 60, bounds.y + 35, { steps: 10 });
  await page.mouse.up();
}
const geometryAfter = await movingSticker.evaluate((el) => el.style.transform);
await movingSticker.focus();
await page.keyboard.press("Delete");
const stickerFit = await page.evaluate(() => window.finishStickerFitProbe());
const parsedBefore = geometryBefore.transform.match(/rotate\(([-\d.]+)deg\) scale\(([\d.]+)\)/);
const parsedAfter = geometryAfter.match(/rotate\(([-\d.]+)deg\) scale\(([\d.]+)\)/);
check(
  "R2",
  "扩展长图增删、拖动、旋转及缩放贴纸时保持排版就绪且不重新加载字体",
  stickerFit.before.expanded === "true" && stickerFit.before.pageSize === "long" &&
    geometryBefore.left !== geometryMoved.left && geometryBefore.top !== geometryMoved.top &&
    parsedBefore && parsedAfter && parsedBefore[1] !== parsedAfter[1] && parsedBefore[2] !== parsedAfter[2] &&
    stickerFit.fontLoads === 0 && stickerFit.transitions.length === 0 &&
    JSON.stringify(stickerFit.before) === JSON.stringify(stickerFit.after),
  JSON.stringify(stickerFit),
);
await page.getByRole("tab", { name: "内容" }).click();
await page.getByRole("textbox", { name: "段落 1 正文", exact: true }).fill(originalFitContent);
await page.getByRole("tab", { name: "样式" }).click();
await page.locator(".range-field").filter({ hasText: "字号" }).locator("input").fill("17");
await page.locator(".range-field").filter({ hasText: "行距" }).locator("input").fill("1.6");
await waitForNoteReady(page);

// ---------- H. 导出 ----------
await page.getByRole("tab", { name: "导出" }).click();
await stickers.nth(0).focus(); // 选中贴纸，使选框与手柄出现在画布上
const framesBeforeExport = await page.locator(".sticker-frame").count();
for (const scale of [1, 2, 3]) {
  await page.getByRole("radio", { name: "PNG（无损）" }).click();
  await page.getByRole("radio", { name: `${scale}x` }).click();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "下载图片" }).click()]);
  const file = `${SP}/accept-${scale}x.png`;
  await dl.saveAs(file);
  const { w, h, sig } = pngSize(file);
  check(`H${scale}`, `导出 PNG ${scale}x 尺寸正确`, sig === "PNG" && w === 840 * scale && h === 1188 * scale, `${w}×${h}`);
}
await page.getByRole("radio", { name: /JPG/ }).click();
await page.getByRole("radio", { name: "2x" }).click();
const [jpg] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "下载图片" }).click()]);
await jpg.saveAs(`${SP}/accept.jpg`);
const jb = fs.readFileSync(`${SP}/accept.jpg`);
check("H4", "导出 JPG", jb[0] === 0xff && jb[1] === 0xd8 && jpg.suggestedFilename().endsWith(".jpg"), `${jb.length} bytes`);
const b64 = fs.readFileSync(`${SP}/accept-1x.png`).toString("base64");
const exportPixels = await page.evaluate(async (data) => {
  const img = new Image();
  img.src = `data:image/png;base64,${data}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  let count = 0;
  for (let i = 0; i < px.length; i += 4) {
    // 选框与手柄使用 #2563EB，当前墨水为复古棕、纸张为牛皮纸，正常内容不会出现该色
    if (Math.abs(px[i] - 0x25) < 18 && Math.abs(px[i + 1] - 0x63) < 18 && Math.abs(px[i + 2] - 0xeb) < 18) count++;
  }
  // The 1x canvas has 56px side padding. Sample blank margins, away from the content,
  // stickers and kraft's horizontal rules (y % 30 === 0). Allow the paper's noise texture.
  const kraft = [0xd8, 0xbf, 0x98];
  const rows = [12, 192, 642, Math.floor((img.height - 30) / 30) * 30 + 12];
  const sums = [0, 0, 0, 0];
  let samples = 0;
  let paperLike = 0;
  let opaque = 0;
  for (const left of [16, img.width - 26]) {
    for (const top of rows) {
      for (let y = top; y < top + 10; y++) {
        for (let x = left; x < left + 10; x++) {
          const offset = (y * img.width + x) * 4;
          const [r, g, b, a] = px.subarray(offset, offset + 4);
          samples++;
          sums[0] += r;
          sums[1] += g;
          sums[2] += b;
          sums[3] += a;
          if (a >= 250) opaque++;
          if (a >= 250 && r >= g + 10 && g >= b + 20 &&
            Math.abs(r - kraft[0]) <= 45 && Math.abs(g - kraft[1]) <= 45 && Math.abs(b - kraft[2]) <= 45) paperLike++;
        }
      }
    }
  }
  return { handlePixels: count, paper: { samples, paperLike, opaque, meanRgba: sums.map((sum) => Math.round(sum / samples)) } };
}, b64);
check("H5", "导出图片不包含贴纸选框与手柄", framesBeforeExport === 1 && exportPixels.handlePixels === 0, `导出前选框 ${framesBeforeExport} 个，导出图中选框色像素 ${exportPixels.handlePixels}`);
check(
  "H6",
  "导出牛皮纸保留暖棕纸纹，背景不变黑或透明",
  exportPixels.paper.paperLike >= exportPixels.paper.samples * 0.9 && exportPixels.paper.opaque >= exportPixels.paper.samples * 0.99,
  JSON.stringify(exportPixels.paper),
);

// ---------- J. 剪贴板 ----------
await page.getByRole("button", { name: "复制到剪贴板" }).click();
await page.waitForSelector(".export-status .is-ok, .export-status .is-error", { timeout: 60000 });
const clip = await page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const blob = await items[0].getType("image/png");
  const bmp = await createImageBitmap(blob);
  return { types: items[0].types, w: bmp.width, h: bmp.height };
});
check("J1", "支持的浏览器可复制 PNG 到剪贴板", clip.types.includes("image/png") && clip.w > 0, JSON.stringify(clip));

// ---------- I. 长图倍率限制 ----------
await page.getByRole("tab", { name: "样式" }).click();
await page.locator(".field").filter({ hasText: "页面尺寸" }).locator("select").selectOption("long");
await page.getByRole("tab", { name: "内容" }).click();
for (let i = 0; i < 3; i++) {
  const add = page.getByRole("button", { name: "+ 添加段落" });
  if (await add.count()) await add.click();
}
for (let i = 0; i < 6; i++) {
  const ta = page.getByLabel(`段落 ${i + 1} 正文`);
  if (await ta.count()) await ta.fill("很长的段落内容。".repeat(80));
}
await page.getByRole("tab", { name: "导出" }).click();
await page.getByRole("radio", { name: "PNG（无损）" }).click();
await page.getByRole("radio", { name: "3x" }).click();
const hint = await page.locator(".hint").filter({ hasText: "输出尺寸" }).innerText();
const pageH = await page.locator(".note-page").evaluate((el) => el.offsetHeight);
const [longDl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByRole("button", { name: "下载图片" }).click()]);
await longDl.saveAs(`${SP}/accept-long.png`);
const ls = pngSize(`${SP}/accept-long.png`);
check("I1", "长图高倍率导出自动限制画布面积（≤16M 像素）", ls.w * ls.h <= 16_000_000 && pageH > 1188, `页面高 ${pageH}，输出 ${ls.w}×${ls.h}；${hint}`);

// ---------- P. 隐私：本地存储 ----------
const stored = await page.evaluate(() => localStorage.getItem("ink-scribe:v1") ?? "");
check("P1", "本地只保存外观偏好，不保存原文与笔记", !stored.includes("Spaced") && !stored.includes("很长的段落") && stored.includes("settings"), `${stored.length} chars`);
check("Z1", "主流程无未处理的脚本错误", page.errors.length === 0, page.errors.join("; "));
await context.close();

// ---------- K. 不支持剪贴板 ----------
{
  const { page: p2, context: c2 } = await newPage({}, "delete window.ClipboardItem;");
  await p2.goto(URL, { waitUntil: "networkidle" });
  await p2.getByRole("tab", { name: "导出" }).click();
  const disabled = await p2.getByRole("button", { name: "复制到剪贴板" }).isDisabled();
  const reason = await p2.locator(".panel-body .hint").filter({ hasText: "不支持" }).count();
  const [dl] = await Promise.all([p2.waitForEvent("download", { timeout: 60000 }), p2.getByRole("button", { name: "下载图片" }).click()]);
  check("K1", "不支持剪贴板时按钮置灰并提示，仍可下载", disabled && reason > 0 && !!dl, `disabled=${disabled}`);
  await c2.close();
}

// ---------- L/M. 注入防护 ----------
{
  const { page: p3, context: c3 } = await newPage();
  await p3.goto(URL, { waitUntil: "networkidle" });
  await p3.route("**/api/structure", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        note: {
          title: '<img src=x onerror="window.__xss=1">标题',
          cues: [{ keyword: "<svg onload=window.__xss=2>", note: "javascript:alert(1)" }],
          sections: [{ heading: "<script>window.__xss=3</script>", content: '正文 <iframe src="https://evil.example"></iframe> 重点', highlights: ["重点", "<b>x</b>"] }],
          summary: "<style>body{display:none}</style>总结",
          doodleTheme: "lightbulb",
        },
        meta: { requestId: "t", model: "m", latencyMs: 1, attempts: 1, warnings: [] },
      }),
    }),
  );
  await openInput(p3);
  await p3.locator(".source-text").fill("任意文本");
  await p3.getByRole("button", { name: /转化为手写笔记/ }).click();
  await p3.waitForSelector(".badge-ai");
  await p3.waitForTimeout(300);
  const xss = await p3.evaluate(() => ({
    flag: window.__xss,
    dangerous: document.querySelectorAll(".note-page img, .note-page script, .note-page iframe, .note-page style, .note-page foreignObject").length,
    titleText: document.querySelector(".note-title").textContent,
    bodyVisible: getComputedStyle(document.body).display !== "none",
  }));
  check("L1", "笔记中的 HTML/脚本被清理且不会执行", xss.flag === undefined && xss.dangerous === 0 && !xss.titleText.includes("<") && xss.titleText.includes("标题") && xss.bodyVisible, JSON.stringify(xss));

  await p3.unroute("**/api/structure");
  await p3.route("**/api/structure", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ note: { title: "残缺结构" }, meta: { requestId: "t2", model: "m", latencyMs: 1, attempts: 1, warnings: [] } }) }),
  );
  await openInput(p3);
  await p3.getByRole("button", { name: /转化为手写笔记/ }).click();
  await p3.waitForTimeout(800);
  const survived = await p3.evaluate(() => ({ page: document.querySelectorAll(".note-page").length, alert: document.querySelector(".alert-error")?.textContent ?? "" }));
  check("L2", "接口返回残缺结构时前端不崩溃并给出错误提示", survived.page === 1 && survived.alert.length > 0 && p3.errors.length === 0, `${JSON.stringify(survived)} ${p3.errors.slice(0, 1).join("")}`);
  await p3.unroute("**/api/structure");

  await p3.route("**/api/structure", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ note: { title: "t", cues: "abc", sections: [{ content: "c", highlights: "x" }], summary: 5 }, meta: { requestId: "t3", model: "m", latencyMs: 1, attempts: 1, warnings: [] } }) }),
  );
  await openInput(p3);
  await p3.getByRole("button", { name: /转化为手写笔记/ }).click();
  await p3.waitForTimeout(800);
  const typed = await p3.evaluate(() => document.querySelectorAll(".note-page").length);
  check("L3", "接口返回字段类型错误时前端不白屏", typed === 1 && p3.errors.length === 0, p3.errors.slice(0, 1).join(""));
  await p3.unroute("**/api/structure");
  await p3.route("**/api/doodle", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        doodle: {
          concept: "<script>x</script>",
          elements: [
            { type: "foreignObject", html: "<img src=x onerror=window.__xss=4>" },
            { type: "image", href: "https://evil.example/x.png", x: 1, y: 1, w: 50, h: 50 },
            { type: "circle", cx: 50, cy: 50, r: 30, onload: "window.__xss=5", style: "fill:url(https://evil.example)", fill: "url(javascript:alert(1))", href: "javascript:alert(1)" },
            { type: "path", d: "M0 0 L100 100", points: [[10, 10], ["<x>", 3], [90, 90]], closed: true, fill: "yellow" },
            { type: "line", x1: -1e9, y1: 5, x2: 1e9, y2: "NaN" },
          ],
        },
        meta: { requestId: "t", model: "m", latencyMs: 1, attempts: 1, warnings: [] },
      }),
    }),
  );
  await p3.getByRole("tab", { name: "贴纸" }).click();
  await p3.getByLabel("插图主题").fill("测试");
  await p3.getByRole("button", { name: "生成", exact: true }).click();
  await p3.waitForSelector(".ai-doodle-preview svg");
  await p3.getByRole("button", { name: "设为主插图" }).click();
  await p3.waitForTimeout(300);
  const svg = await p3.evaluate(() => {
    const root = document.querySelector(".doodle-slot svg");
    const tags = new Set();
    const badAttrs = [];
    for (const el of [root, ...root.querySelectorAll("*")]) {
      tags.add(el.tagName.toLowerCase());
      for (const a of el.attributes) {
        if (/^on|href/i.test(a.name) || /javascript:|url\(/i.test(a.value)) badAttrs.push(`${el.tagName}.${a.name}=${a.value}`);
      }
    }
    return { tags: [...tags], badAttrs, paths: root.querySelectorAll("path").length, flag: window.__xss };
  });
  check("M1", "AI 插图只渲染受控的 svg/g/path，无事件属性、外链或脚本", svg.tags.every((t) => ["svg", "g", "path"].includes(t)) && svg.badAttrs.length === 0 && svg.flag === undefined && svg.paths > 0, JSON.stringify(svg));
  await c3.close();
}

// ---------- N. 错误提示 ----------
{
  const { page: p4, context: c4 } = await newPage();
  await p4.goto(URL, { waitUntil: "networkidle" });
  await fillSource(p4, "任意文本");
  const cases = [
    ["AI_TIMEOUT", 504, "AI 处理超时，请缩短文本或稍后重试。", "精简"],
    ["RATE_LIMITED", 429, "请求过于频繁，请稍后再试。", "一分钟"],
    ["AI_OUTPUT_INVALID", 502, "无法生成有效的笔记结构，请重试。", "重试"],
  ];
  for (const [code, status, message, hintWord] of cases) {
    await p4.route("**/api/structure", (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message, requestId: "r1" } }) }));
    await openInput(p4);
    await p4.getByRole("button", { name: /转化为手写笔记/ }).click();
    await p4.waitForSelector(".alert-error");
    const text = await p4.locator(".alert-error").innerText();
    check(`N-${code}`, `错误 ${code} 有可理解的提示`, text.includes(message) && text.includes(code) && text.includes(hintWord), text.replace(/\s+/g, " ").slice(0, 80));
    await p4.unroute("**/api/structure");
  }
  await p4.route("**/api/structure", (route) => route.abort("internetdisconnected"));
  await openInput(p4);
  await p4.getByRole("button", { name: /转化为手写笔记/ }).click();
  await p4.waitForSelector(".alert-error");
  check("N-NETWORK", "网络错误有可理解的提示", (await p4.locator(".alert-error").innerText()).includes("网络"));
  await c4.close();
}

// ---------- N-FONT. 字体文件下载失败后，网络恢复即可重试 ----------
{
  const { page: pf, context: cf } = await newPage();
  await pf.goto(URL, { waitUntil: "networkidle" });
  await openInput(pf);
  await pf.selectOption(".sample-picker select", "zh-reading");
  await pf.getByRole("button", { name: /转化为手写笔记/ }).click();
  await pf.waitForSelector(".badge-ai");
  await waitForNoteReady(pf);
  // 只拦截字体文件；按需加载的样式表照常返回，模拟字体分片下载时断网
  const fontFiles = /ma-shan-zheng.*\.woff2?(\?.*)?$/;
  let blocked = 0;
  await pf.route(fontFiles, (route) => {
    blocked += 1;
    return route.abort("internetdisconnected");
  });
  await pf.getByRole("tab", { name: "样式" }).click();
  await pf.locator(".field").filter({ hasText: "中文字体" }).locator("select").selectOption("ma-shan-zheng");
  await pf.locator('.note-page[data-render-status="font-error"]').waitFor({ timeout: 30_000 });
  await pf.getByRole("tab", { name: "导出" }).click();
  const exportBlocked = await pf.getByRole("button", { name: "下载图片", exact: true }).isDisabled();
  await pf.unroute(fontFiles);
  await pf.locator('.note-fit-status[data-fit-status="font-error"]').getByRole("button", { name: "重试" }).click();
  await waitForNoteReady(pf);
  const recovered = await pf.evaluate(() => {
    const title = document.querySelector(".note-title").textContent.replace(/\s+/g, "");
    return document.fonts.check('20px "Ma Shan Zheng"', title);
  });
  check(
    "N-FONT",
    "字体下载失败时阻止导出，恢复网络后重试即可加载字体并解除阻止",
    blocked > 0 && exportBlocked && recovered && await pf.getByRole("button", { name: "下载图片", exact: true }).isEnabled(),
    `blocked ${blocked}, export blocked ${exportBlocked}, recovered ${recovered}`,
  );
  await cf.close();
}

// ---------- U. 上传文件生成笔记（文件在浏览器本地解析） ----------
{
  const { page: p6, context: c6 } = await newPage();
  await p6.goto(URL, { waitUntil: "networkidle" });
  // 用 Chromium 把中文页面打印成 PDF，作为文字型 PDF 样本
  const printer = await c6.newPage();
  await printer.goto(URL, { waitUntil: "networkidle" });
  await printer.evaluate(() => {
    document.body.innerHTML = '<div style="font-family: \'LXGW WenKai Screen\'; font-size: 18px; padding: 40px">' +
      "<h1>光合作用学习笔记</h1><p>光合作用是植物利用光能，把二氧化碳和水转化为葡萄糖并释放氧气的过程。</p>" +
      "<p>它分为光反应和暗反应两个阶段。Light reactions happen in the thylakoid membrane.</p></div>";
  });
  await printer.evaluate(() => document.fonts.ready);
  const pdf = await printer.pdf({ format: "A4" });
  await printer.evaluate(() => { document.body.innerHTML = "<div></div>"; });
  const blankPdf = await printer.pdf({ format: "A4" });
  await printer.close();

  const docx = Buffer.from(zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "word/document.xml": strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      "<w:p><w:r><w:t>周会纪要</w:t></w:r></w:p><w:p><w:r><w:t>决定下周发布新版本 &amp; 修复导出问题。</w:t></w:r></w:p>" +
      '<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>李响负责前端</w:t></w:r></w:p></w:body></w:document>'),
  }));
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb1, 0xca, 0xbc, 0xc7]); // “中文笔记”的 GBK 编码
  const html = Buffer.from('<html><body><nav>导航</nav><article><h1>网页标题</h1><p>正文第一段。</p><script>window.__x=1</script><ul><li>要点</li><li><p>段落项</p></li></ul><pre>if ready:\n    run()</pre><table><tr><th>Item</th><th>Price</th></tr><tr><td>Tea</td> <td>10</td></tr></table></article></body></html>');

  const files = [
    { name: "photosynthesis.pdf", mimeType: "application/pdf", buffer: pdf, expect: ["光合作用", "二氧化碳", "thylakoid"], label: "PDF（中文 + 英文）" },
    { name: "meeting.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx, expect: ["周会纪要", "& 修复", "- 李响负责前端"], label: "Word .docx" },
    { name: "notes-gbk.txt", mimeType: "text/plain", buffer: gbk, expect: ["中文笔记"], label: "GBK 编码 TXT" },
    { name: "page.html", mimeType: "text/html", buffer: html, expect: ["网页标题", "正文第一段", "- 要点", "- 段落项", "if ready:\n    run()", "Item\tPrice", "Tea\t10"], label: "HTML（去除脚本与导航）" },
  ];
  await openInput(p6);
  for (const file of files) {
    await p6.locator('input[type="file"]').setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
    await p6.waitForSelector(".input-panel .hint.is-ok, .input-panel .hint.is-error", { timeout: 30000 });
    const status = await p6.locator(".input-panel [aria-live] .hint").first().innerText();
    const text = await p6.locator(".source-text").inputValue();
    const ok = file.expect.every((t) => text.includes(t)) && status.includes("已导入") && !text.includes("导航") && !text.includes("__x");
    check(`U-${file.name}`, `上传 ${file.label} 并提取文字`, ok, `${status}；${text.replace(/\s+/g, " ").slice(0, 60)}`);
  }
  await p6.getByRole("button", { name: /转化为手写笔记/ }).click();
  await p6.waitForSelector(".badge-ai");
  check("U-generate", "上传文件后生成手写笔记", (await p6.locator(".note-title").first().innerText()).length > 0);

  const errorCases = [
    { name: "scan.pdf", mimeType: "application/pdf", buffer: blankPdf, expect: "扫描件" },
    { name: "old.doc", mimeType: "application/msword", buffer: Buffer.from("x"), expect: "暂不支持" },
    { name: "broken.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("not a zip"), expect: ".docx" },
  ];
  await openInput(p6);
  for (const file of errorCases) {
    await p6.locator('input[type="file"]').setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
    await p6.waitForFunction((n) => document.querySelector(".input-panel .hint.is-error")?.textContent?.length > 0 || false, file.name, { timeout: 30000 }).catch(() => {});
    const err = await p6.locator(".input-panel .hint.is-error").first().innerText().catch(() => "");
    check(`U-${file.name}`, `无法识别的文件 ${file.name} 给出明确提示`, err.includes(file.expect), err);
  }
  check("U-errors", "上传流程无脚本错误", p6.errors.length === 0, p6.errors.join("; "));
  await c6.close();
}

// ---------- V. Agent 发布、查看页与图库 ----------
if (process.env.E2E_API_KEY) {
  const { page: p7, context: c7 } = await newPage();
  const auth = { Authorization: `Bearer ${process.env.E2E_API_KEY}` };
  const contractAuth = { Authorization: `Bearer ${process.env.E2E_CONTRACT_API_KEY ?? process.env.E2E_API_KEY}` };
  const title = `E2E 公开笔记 ${Date.now()}`;
  const publishRequest = {
    schemaVersion: 1,
    note: {
      title,
      date: "2026年10月22日",
      cues: [{ keyword: "发布", note: "agent 提供已整理的结构" }],
      sections: [{ heading: "要点", content: "这是通过 API 发布的笔记。\n- 列表项", highlights: ["API"] }],
      summary: "总结一句话",
      doodleTheme: "book",
    },
    template: "lecture-summary",
    visibility: "public",
    appearance: { paper: "kraft", ink: "brown", layout: "free-journal" },
    stickers: [{ id: "e2e-star", type: "star", x: 700, y: 120, rotation: 0, scale: 1, variant: "gold" }],
  };
  const beforeValidation = await (await p7.request.get(`${URL}api/v1/notes?limit=50`, { headers: contractAuth })).json();
  const validated = await p7.request.post(`${URL}api/v1/notes/validate`, { headers: contractAuth, data: publishRequest });
  const validation = await validated.json();
  const afterValidation = await (await p7.request.get(`${URL}api/v1/notes?limit=50`, { headers: contractAuth })).json();
  check(
    "V0a",
    "agent 可预检结构，明确未验证排版且不创建笔记",
    validated.status() === 200 && validation.valid === true && validation.schemaVersion === 1 &&
      validation.validation?.structure === "passed" && validation.validation?.layout === "not_checked" &&
      !Object.hasOwn(validation, "note") && JSON.stringify(beforeValidation) === JSON.stringify(afterValidation),
    `HTTP ${validated.status()}`,
  );

  for (const field of ["schemaVersion", "note"]) {
    const incomplete = { ...publishRequest };
    delete incomplete[field];
    const response = await p7.request.post(`${URL}api/v1/notes`, { headers: contractAuth, data: incomplete });
    const body = await response.json();
    check(`V0-${field}`, `缺少 ${field} 时返回可修正的字段错误`, response.status() === 422 && body.error?.code === "VALIDATION_FAILED" && body.error.issues?.some((issue) => issue.path === field), `HTTP ${response.status()}`);
  }
  const rejectedSource = `E2E_SOURCE_MUST_NOT_BE_ACCEPTED_${Date.now()}`;
  for (const [name, data] of [["text-only", { text: rejectedSource }], ["text-and-note", { ...publishRequest, text: rejectedSource }]]) {
    const response = await p7.request.post(`${URL}api/v1/notes`, { headers: contractAuth, data });
    const body = await response.json();
    check(`V0-${name}`, `拒绝 ${name} 旧调用且不回显原文`, response.status() === 422 && body.error?.code === "VALIDATION_FAILED" && body.error.issues?.some((issue) => issue.path === "text") && !JSON.stringify(body).includes(rejectedSource), `HTTP ${response.status()}`);
  }
  const oversized = { ...publishRequest, note: { ...publishRequest.note, sections: [{ content: "字".repeat(901), highlights: [] }] } };
  const rejectedOversize = await p7.request.post(`${URL}api/v1/notes/validate`, { headers: contractAuth, data: oversized });
  const oversizeError = await rejectedOversize.json();
  check("V0b", "超长正文被拒绝而不静默截断", rejectedOversize.status() === 422 && oversizeError.error?.issues?.some((issue) => issue.path === "note.sections[0].content"), `HTTP ${rejectedOversize.status()}`);

  const idempotencyKey = `e2e-${Date.now()}`;
  const created = await p7.request.post(`${URL}api/v1/notes`, {
    headers: { ...auth, "Idempotency-Key": idempotencyKey },
    data: publishRequest,
  });
  const note = await created.json();
  check("V1", "agent 无需原文即可发布完整结构并返回链接", created.status() === 201 && note.schemaVersion === 1 && /\/n\/[A-Za-z0-9_-]{22}$/.test(note.url), `${created.status()} ${note.url}`);
  if (created.status() !== 201) throw new Error(`Agent publication failed: ${JSON.stringify(note)}`);
  check("V1b", "发布保留已整理内容并声明结构验证范围", JSON.stringify(note.note) === JSON.stringify(publishRequest.note) && note.meta?.processing === "agent" && note.meta?.validation?.layout === "not_checked" && !Object.hasOwn(note, "text") && !Object.hasOwn(note.meta, "model"));
  const replayed = await p7.request.post(`${URL}api/v1/notes`, { headers: { ...auth, "Idempotency-Key": idempotencyKey }, data: publishRequest });
  const replay = await replayed.json();
  check("V1c", "结构发布重试返回同一笔记与明确元数据", replayed.status() === 200 && replay.id === note.id && replay.meta?.replayed === true && replay.meta?.processing === "agent");
  const publicData = await (await p7.request.get(`${URL}api/notes/${note.id}`)).json();
  check("V1d", "公开 JSON 保留结构并不暴露原文字段", publicData.schemaVersion === 1 && JSON.stringify(publicData.note) === JSON.stringify(publishRequest.note) && !Object.hasOwn(publicData, "text"));
  const keyless = await p7.request.post(`${URL}api/v1/notes`, { data: { ...publishRequest, visibility: "public" } });
  check("V2", "没有密钥时不能发布到公开图库", keyless.status() === 422 && (await keyless.json()).error?.issues?.[0]?.code === "ANONYMOUS_UNLISTED_ONLY");
  const anonymous = await p7.request.post(`${URL}api/v1/notes`, { data: { ...publishRequest, visibility: "unlisted" } });
  const anonymousNote = await anonymous.json();
  const anonymousDelete = await p7.request.delete(`${URL}api/v1/notes/${anonymousNote.id}`, { headers: { "X-Manage-Token": anonymousNote.manageToken ?? "" } });
  check("V2b", "没有密钥时可发布仅链接可见的笔记，并用 manageToken 删除", anonymous.status() === 201 && anonymousNote.visibility === "unlisted" && anonymousDelete.status() === 204, `POST ${anonymous.status()}，DELETE ${anonymousDelete.status()}`);

  const shareResponse = await p7.request.get(note.url);
  const html = await shareResponse.text();
  check("V3", "分享链接的 HTML 带有标题与 Open Graph 信息", html.includes(`<title>${title} · 墨语笔记</title>`) && html.includes(`og:title" content="${title}"`), `HTTP ${shareResponse.status()} ${html.slice(0, 160).replace(/\s+/g, " ")}`);
  check("V3b", "分享链接的 HTML 直接包含笔记正文与 Article 结构化数据", html.includes(`<h1>${title}</h1>`) && html.includes("<li>列表项</li>") && html.includes('"@type":"Article"') && html.includes(`<link rel="canonical" href="${note.url}"`));

  await p7.goto(note.url, { waitUntil: "networkidle" });
  await waitForNoteReady(p7);
  const view = await p7.evaluate(() => ({
    title: document.querySelector(".note-title")?.textContent ?? "",
    cls: document.querySelector(".note-page")?.className ?? "",
    stickers: document.querySelectorAll(".sticker").length,
    handles: document.querySelectorAll(".sticker-selection").length,
  }));
  check("V4", "查看页按发布时的外观只读渲染", view.title.includes("E2E") && view.cls.includes("paper-kraft") && view.cls.includes("layout-free-journal") && view.stickers === 1 && view.handles === 0, JSON.stringify(view));
  await verifyFontRetry({ newPage, check, url: note.url, outputDir: SP, mode: "view" });

  // 回归：浏览器带缓存校验头（If-None-Match）再次打开链接时仍应返回完整页面（曾因转发该头而得到 Not Found）
  const shellEtag = (await p7.request.get(URL)).headers()["etag"] ?? "";
  const revisit = await p7.request.get(note.url, { headers: shellEtag ? { "If-None-Match": shellEtag } : {} });
  const revisitHtml = await revisit.text();
  check("V4b", "带缓存校验头再次打开链接仍返回完整页面", revisit.status() === 200 && revisitHtml.includes(`og:title" content="${title}"`), `ETag ${shellEtag || "无"}，HTTP ${revisit.status()}`);

  await p7.goto(`${URL}gallery`, { waitUntil: "networkidle" });
  const card = p7.locator(".gallery-card").filter({ hasText: title });
  check("V5", "公开笔记出现在图库", (await card.count()) === 1);
  await card.click();
  await p7.waitForURL(note.url);
  await p7.getByRole("button", { name: "在编辑器中打开" }).click();
  await p7.waitForSelector(".input-trigger");
  const editor = await p7.evaluate(() => ({
    badge: document.querySelector(".workspace-status")?.textContent ?? "",
    stickers: document.querySelectorAll(".sticker").length,
    cls: document.querySelector(".note-page")?.className ?? "",
  }));
  check("V6", "从查看页把笔记（含外观与贴纸）载入编辑器", editor.badge.includes("已发布") && editor.stickers === 1 && editor.cls.includes("paper-kraft"), JSON.stringify(editor));

  const unlisted = await (await p7.request.post(`${URL}api/v1/notes`, {
    headers: auth,
    data: { schemaVersion: 1, note: { title: `E2E 隐藏 ${Date.now()}`, cues: [], sections: [{ content: "仅链接可见", highlights: [] }], summary: "" } },
  })).json();
  const gallery = await (await p7.request.get(`${URL}api/gallery?limit=50`)).json();
  const unlistedHtml = await (await p7.request.get(unlisted.url)).text();
  check("V7", "仅链接可见的笔记不进入图库且禁止搜索引擎收录", unlisted.visibility === "unlisted" && !gallery.items.some((i) => i.id === unlisted.id) && unlistedHtml.includes("noindex"));

  const removed = await p7.request.delete(`${URL}api/v1/notes/${note.id}`, { headers: auth });
  const unlistedRemoved = await p7.request.delete(`${URL}api/v1/notes/${unlisted.id}`, { headers: auth });
  const unlistedGone = await p7.request.get(`${URL}api/notes/${unlisted.id}`);
  check("V8", "仅链接可见的笔记也能删除且不能继续读取", unlistedRemoved.status() === 204 && unlistedGone.status() === 404, `DELETE ${unlistedRemoved.status()}，GET ${unlistedGone.status()}`);
  await p7.goto(note.url, { waitUntil: "networkidle" });
  const goneText = await p7.locator(".empty-state").innerText({ timeout: 10000 }).catch(async () => `[未找到提示] ${(await p7.locator("main").innerText()).slice(0, 80)}`);
  check("V9", "删除后链接显示“不存在”", removed.status() === 204 && goneText.includes("不存在"), `DELETE ${removed.status()}；${goneText}`);
  check("V10", "发布与查看流程无脚本错误", p7.errors.length === 0, p7.errors.join("; "));
  await c7.close();
}

// ---------- W. agent 的完整长内容在全部版式中可读、可导出 ----------
if (process.env.E2E_API_KEY) {
  const { page: p12, context: c12 } = await newPage();
  const auth = { Authorization: `Bearer ${process.env.E2E_DENSE_API_KEY ?? process.env.E2E_API_KEY}` };
  const fillText = (length, start, end) => start + "完整排版内容。".repeat(length).slice(0, length - start.length - end.length) + end;
  const denseNote = {
    title: "长内容完整性验收",
    date: "2026年10月22日",
    cues: Array.from({ length: 8 }, (_, i) => ({ keyword: `线索 ${i + 1}`, note: fillText(120, `线索${i + 1}：`, `线索${i + 1}结束`) })),
    sections: Array.from({ length: 6 }, (_, i) => ({
      heading: `段落 ${i + 1}`,
      content: fillText(900, `正文${i + 1}：`, `正文${i + 1}结束`),
      highlights: ["完整排版"],
    })),
    summary: fillText(400, "最后的总结：", "全文保留结束"),
  };
  const expectedText = [...denseNote.cues.map((cue) => cue.note), ...denseNote.sections.map((section) => section.content), denseNote.summary];
  const ids = [];

  for (const layout of ["hybrid-cornell", "classic-cornell", "free-journal", "minimal"]) {
    const response = await p12.request.post(`${URL}api/v1/notes`, {
      headers: auth,
      data: {
        schemaVersion: 1,
        note: denseNote,
        appearance: { layout, pageSize: "a4", overflow: "expand", naturalness: 0, doodleMode: "none", fontSize: 19, lineHeight: 1.75 },
      },
    });
    const publication = await response.json();
    if (response.status() !== 201) throw new Error(`Dense ${layout} publication failed: ${JSON.stringify(publication)}`);
    ids.push(publication.id);
    await p12.goto(publication.url, { waitUntil: "networkidle" });
    await waitForNoteReady(p12);
    const geometry = await p12.locator(".note-page").evaluate(inspectNoteLayout, expectedText);
    check(
      `W-${layout}`,
      `${layout} 最大合法正文、线索与总结全部可见`,
      geometry.expanded === "true" && geometry.pageSize === "long" && geometry.height > 1188 && geometry.missing === 0 && geometry.clipped === 0 && geometry.overflowing === 0,
      JSON.stringify(geometry),
    );
    const [download] = await Promise.all([
      p12.waitForEvent("download", { timeout: 60_000 }),
      p12.getByRole("button", { name: "下载图片", exact: true }).click(),
    ]);
    const file = `${SP}/published-${layout}.png`;
    await download.saveAs(file);
    const dimensions = pngSize(file);
    check(
      `W-export-${layout}`,
      `${layout} PNG 覆盖适配后的完整页面`,
      dimensions.sig === "PNG" && dimensions.h > 1188 && dimensions.w * dimensions.h <= 16_000_000 &&
        // Canvas rounds both scaled dimensions to whole pixels; width rounding is amplified by a long page's aspect ratio.
        Math.abs(dimensions.h - geometry.height * dimensions.w / geometry.width) <= 1 + geometry.height / geometry.width,
      `${dimensions.w}×${dimensions.h}; page ${geometry.width}×${geometry.height}`,
    );
  }

  const strictResponse = await p12.request.post(`${URL}api/v1/notes`, {
    headers: auth,
    data: { schemaVersion: 1, note: denseNote, appearance: { layout: "classic-cornell", pageSize: "a4", overflow: "error", naturalness: 0, doodleMode: "none" } },
  });
  const strict = await strictResponse.json();
  if (strictResponse.status() !== 201) throw new Error(`Strict layout publication failed: ${JSON.stringify(strict)}`);
  ids.push(strict.id);
  await p12.goto(strict.url, { waitUntil: "networkidle" });
  await p12.locator('.note-page[data-render-status="overflow"]').waitFor({ timeout: 30_000 });
  check(
    "W-strict",
    "固定页面溢出明确提示并禁用导出",
    await p12.locator('.note-fit-status[data-fit-status="overflow"]').isVisible() &&
      await p12.getByRole("button", { name: "下载图片", exact: true }).isDisabled() &&
      await p12.locator(".note-page").getAttribute("data-page-size") === "a4",
  );
  check("W-errors", "长内容与严格页面流程无脚本错误", p12.errors.length === 0, p12.errors.join("; "));
  const cleanupStatuses = [];
  for (const id of ids) cleanupStatuses.push((await p12.request.delete(`${URL}api/v1/notes/${id}`, { headers: auth })).status());
  check("W-cleanup", "全部长内容测试笔记成功删除", cleanupStatuses.every((status) => status === 204), cleanupStatuses.join(", "));
  await c12.close();
}

// ---------- S. SEO 与 GEO ----------
{
  const { page: p8, context: c8 } = await newPage();
  const home = await (await p8.request.get(URL)).text();
  check(
    "S1",
    "首页 HTML 带有 canonical、OG 图、JSON-LD 与可读正文",
    home.includes(`<link rel="canonical" href="${URL}"`) && home.includes(`og:image" content="${URL}og-image.jpg"`) && home.includes('"@type":"WebApplication"') && home.includes('"@type":"FAQPage"') && /<div id="root"><main class="ssr">\s*<h1>/.test(home),
  );
  await p8.goto(URL, { waitUntil: "networkidle" });
  const hydrated = await p8.evaluate(() => ({ ssr: document.querySelectorAll(".ssr").length, app: document.querySelectorAll(".input-panel").length }));
  check("S2", "脚本加载后由应用替换服务端正文", hydrated.ssr === 0 && hydrated.app === 1, JSON.stringify(hydrated));

  const gallery = await (await p8.request.get(`${URL}gallery`)).text();
  check("S3", "图库 HTML 带有标题、canonical 与 CollectionPage", gallery.includes("<title>图库 · 墨语笔记 InkScribe</title>") && gallery.includes(`<link rel="canonical" href="${URL}gallery"`) && gallery.includes('"@type":"CollectionPage"'));

  const robots = await p8.request.get(`${URL}robots.txt`);
  const sitemap = await p8.request.get(`${URL}sitemap.xml`);
  const sitemapText = await sitemap.text();
  check(
    "S4",
    "robots.txt 指向站点地图，sitemap.xml 可解析",
    (await robots.text()).includes(`Sitemap: ${URL}sitemap.xml`) && sitemap.headers()["content-type"]?.includes("xml") && sitemapText.includes(`<loc>${URL}gallery</loc>`),
  );

  const assets = {};
  for (const [file, type] of [["favicon.ico", "image/"], ["favicon.svg", "image/svg+xml"], ["logo.svg", "image/svg+xml"], ["apple-touch-icon.png", "image/png"], ["icon-512.png", "image/png"], ["og-image.jpg", "image/jpeg"], ["site.webmanifest", ""]]) {
    const res = await p8.request.get(`${URL}${file}`);
    assets[file] = res.ok() && (res.headers()["content-type"] ?? "").startsWith(type) ? "ok" : `${res.status()} ${res.headers()["content-type"]}`;
  }
  const manifest = await (await p8.request.get(`${URL}site.webmanifest`)).json().catch(() => ({}));
  check("S5", "图标、OG 图与 Web App Manifest 可访问", Object.values(assets).every((v) => v === "ok") && manifest.icons?.length === 3, JSON.stringify(assets));

  const llms = await (await p8.request.get(`${URL}llms.txt`)).text();
  check("S6", "llms.txt 介绍产品、页面与结构发布/预检", llms.includes("## 页面") && llms.includes("/api/v1/notes/validate") && llms.includes("schemaVersion"));
  check("S7", "SEO 页面无脚本错误", p8.errors.length === 0, p8.errors.join("; "));
  await c8.close();
}

// ---------- U. 使用说明、机器可读示例与站点菜单 ----------
{
  const { page: guide, context: guideContext } = await newPage({ colorScheme: "light" });
  const directResponses = [];
  for (const [path, language, htmlLang] of [["guide", "zh-CN", "zh-CN"], ["guide/", "en-US", "en"]]) {
    const response = await guide.request.get(`${URL}${path}`, { headers: { "Accept-Language": language } });
    const html = await response.text();
    directResponses.push({
      path,
      status: response.status(),
      valid: response.status() === 200 && html.includes(`<html lang="${htmlLang}"`) &&
        html.includes(`<link rel="canonical" href="${URL}guide"`) &&
        ["users", "agents", "faq"].every((id) => html.includes(`id="${id}"`) && html.includes(`href="#${id}"`)) &&
        html.includes('data-guide-code="json"') && html.includes("/api/v1/notes/validate") &&
        (response.headers().vary ?? "").toLowerCase().includes("accept-language"),
    });
  }
  check("U1", "说明页和尾斜杠直达均返回完整双语 HTML 与统一 canonical", directResponses.every((response) => response.valid), JSON.stringify(directResponses));

  const { page: noJs, context: noJsContext } = await newPage({ javaScriptEnabled: false, locale: "en-US", viewport: { width: 390, height: 844 } });
  await noJs.goto(`${URL}guide/`, { waitUntil: "networkidle" });
  const staticExample = JSON.parse(await noJs.locator('[data-guide-code="json"]').textContent());
  check(
    "U2",
    "禁用 JavaScript 仍能阅读用户/agent/FAQ 和完整 JSON、机器规范链接",
    await noJs.locator("#users").isVisible() && await noJs.locator("#agents").isVisible() && await noJs.locator("#faq").isVisible() &&
      staticExample.schemaVersion === 1 && staticExample.note.sections.length > 0 && !("text" in staticExample) &&
      await noJs.locator('a[href$="/api/v1/openapi.json"]').count() > 0 && await noJs.locator('a[href$="/llms.txt"]').count() > 0,
  );
  await noJsContext.close();

  await guide.goto(URL, { waitUntil: "networkidle" });
  const source = "菜单导航之后，这段尚在编辑的原文必须保留。";
  const title = "菜单往返保留的标题";
  await fillSource(guide, source);
  await guide.getByRole("tab", { name: "内容", exact: true }).click();
  await guide.locator(".content-editor input").first().fill(title);
  await openAppMenu(guide);
  await guide.locator('.app-nav a[href="/guide"]').click();
  await guide.locator("main.guide-page").waitFor();
  const zhHeading = await guide.locator("main.guide-page h1").innerText();
  check(
    "U3",
    "通过站点菜单进入说明页，当前项正确且菜单自动收起",
    new globalThis.URL(guide.url()).pathname === "/guide" &&
      await guide.locator(".app-menu-toggle").getAttribute("aria-expanded") === "false" &&
      await guide.locator('.app-nav a[href="/guide"]').getAttribute("aria-current") === "page",
  );
  await guide.screenshot({ path: `${SP}/guide-desktop.png` });

  await guide.locator('main.guide-page a[href="#agents"]').click();
  const anchor = await guide.evaluate(() => ({ hash: location.hash, top: document.getElementById("agents").getBoundingClientRect().top }));
  check("U4", "说明页目录会跳到真实的 agent 章节", anchor.hash === "#agents" && anchor.top >= 0 && anchor.top < 160, JSON.stringify(anchor));
  await guideContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  const copied = [];
  for (const kind of ["json", "curl"]) {
    const displayed = await guide.locator(`[data-guide-code="${kind}"]`).innerText();
    await guide.locator(`[data-guide-copy="${kind}"]`).click();
    const clipboard = await guide.evaluate(() => navigator.clipboard.readText());
    copied.push(clipboard === displayed && (await guide.locator(`[data-guide-copy-status="${kind}"]`).textContent()).includes("已复制"));
  }
  check("U5", "JSON 与 curl 复制按钮写入完整示例并反馈成功", copied.every(Boolean));

  // Keep the anchor in the URL while opening preferences at the top. A locale
  // update must not restore the old anchor and move the still-open menu away.
  await guide.evaluate(() => window.scrollTo(0, 0));
  await openAppMenu(guide);
  await guide.locator('input[name="app-menu-locale"][value="en"]').check();
  await guide.waitForFunction(() => document.documentElement.lang === "en");
  const menuAfterLocale = await guide.evaluate(() => {
    const panel = document.querySelector(".app-menu-panel");
    const bounds = panel.getBoundingClientRect();
    return {
      scrollY,
      hash: location.hash,
      expanded: document.querySelector(".app-menu-toggle").getAttribute("aria-expanded"),
      visible: !panel.hidden && bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.height > 0,
    };
  });
  const enHeading = await guide.locator("main.guide-page h1").innerText();
  const englishExample = JSON.parse(await guide.locator('[data-guide-code="json"]').innerText());
  const englishCurl = await guide.locator('[data-guide-code="curl"]').innerText();
  check(
    "U6",
    "切换英文同步更新说明与示例，保留顶部展开菜单而不重跳旧锚点",
    enHeading !== zhHeading && (await guide.locator("html").getAttribute("lang")) === "en" &&
      (await guide.title()).includes("guide") && englishExample.note.title === staticExample.note.title &&
      englishCurl.includes(ORIGIN) && await guide.locator('.app-nav a[href="/guide"]').innerText() === "Guide" &&
      menuAfterLocale.hash === "#agents" && Math.abs(menuAfterLocale.scrollY) <= 1 && menuAfterLocale.expanded === "true" && menuAfterLocale.visible,
    JSON.stringify(menuAfterLocale),
  );
  // Only interact again after measuring, so Playwright cannot auto-scroll and
  // hide a regression in the language switch above.
  await guide.locator(".app-menu-toggle").click();

  await setAppPreference(guide, "theme", "dark");
  const darkGuide = await guide.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    color: getComputedStyle(document.querySelector("main.guide-page")).color,
  }));
  await guide.screenshot({ path: `${SP}/guide-dark.png` });
  await setAppPreference(guide, "theme", "light");
  const lightGuide = await guide.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    color: getComputedStyle(document.querySelector("main.guide-page")).color,
  }));
  check("U7", "说明页支持深色与浅色主题", darkGuide.theme === "dark" && lightGuide.theme === "light" && darkGuide.color !== lightGuide.color, JSON.stringify({ darkGuide, lightGuide }));

  await openAppMenu(guide);
  await guide.keyboard.press("Escape");
  check("U8", "Escape 收起菜单并将焦点归还菜单按钮", await guide.locator(".app-menu-toggle").getAttribute("aria-expanded") === "false" && await guide.locator(".app-menu-toggle").evaluate((element) => element === document.activeElement));
  await openAppMenu(guide);
  await guide.locator("main.guide-page h1").click();
  check("U9", "点击菜单外部可收起菜单", await guide.locator(".app-menu-toggle").getAttribute("aria-expanded") === "false");
  await openAppMenu(guide);
  await guide.locator('.app-nav a[href="/"]').click();
  await guide.locator(".input-trigger").waitFor();
  check(
    "U10",
    "菜单往返说明页后原文和已编辑的笔记保持不变",
    await guide.locator(".source-text").inputValue() === source && await guide.locator(".note-title").first().innerText() === title &&
      await guide.locator(".app-menu-toggle").getAttribute("aria-expanded") === "false",
  );

  await guide.goto(`${URL}guide#agents`, { waitUntil: "networkidle" });
  await guide.locator("main.guide-page").waitFor();
  const deepLink = await guide.evaluate(() => ({ top: document.getElementById("agents").getBoundingClientRect().top, hash: location.hash }));
  check("U11", "直接访问章节链接在 React 挂载后仍定位正确", deepLink.hash === "#agents" && deepLink.top >= 0 && deepLink.top < 160, JSON.stringify(deepLink));

  const mobile = [];
  for (const locale of ["zh", "en"]) {
    await setAppPreference(guide, "locale", locale);
    for (const width of [320, 390]) {
      await guide.setViewportSize({ width, height: 844 });
      const closed = await guide.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        codesContained: [...document.querySelectorAll("[data-guide-code]")].every((element) => element.getBoundingClientRect().right <= innerWidth && element.clientWidth <= innerWidth),
      }));
      await openAppMenu(guide);
      const opened = await guide.evaluate(() => {
        const bounds = document.querySelector(".app-menu-panel").getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, contained: bounds.left >= 0 && bounds.right <= innerWidth };
      });
      mobile.push({ locale, width, valid: closed.overflow <= 0 && closed.codesContained && opened.overflow <= 0 && opened.contained });
      if (locale === "zh" && width === 390) await guide.screenshot({ path: `${SP}/guide-mobile-menu.png` });
      await guide.locator(".app-menu-toggle").click();
    }
  }
  check("U12", "320/390px 中英文说明页和展开菜单均无整体横向溢出", mobile.every((item) => item.valid), JSON.stringify(mobile));
  check("U13", "说明页与菜单流程无脚本错误", guide.errors.length === 0, guide.errors.join("; "));
  await guideContext.close();
}

// ---------- LG. 隐私政策与使用条款 ----------
{
  const { page: legal, context: legalContext } = await newPage({ viewport: { width: 320, height: 844 } });
  const responses = [];
  for (const kind of ["privacy", "terms"]) {
    for (const [suffix, language, htmlLang] of [["", "zh-CN", "zh-CN"], ["/", "en-US", "en"]]) {
      const response = await legal.request.get(`${URL}${kind}${suffix}`, { headers: { "Accept-Language": language } });
      const html = await response.text();
      responses.push({
        path: `${kind}${suffix}`,
        status: response.status(),
        valid: response.status() === 200 && html.includes('<main class="legal-page"') &&
          html.includes(`<html lang="${htmlLang}"`) && html.includes(`<link rel="canonical" href="${URL}${kind}"`) &&
          (response.headers().vary ?? "").toLowerCase().includes("accept-language"),
      });
    }
  }
  check("LG1", "隐私/条款及尾斜杠路径均提供双语 SSR 和统一 canonical", responses.every((response) => response.valid), JSON.stringify(responses));

  const inspectLegal = () => ({
    heading: document.querySelector("main.legal-page h1")?.textContent ?? "",
    title: document.title,
    lang: document.documentElement.lang,
    sections: [...document.querySelectorAll("main.legal-page section.legal-section[id]")].map((section) => {
      const heading = section.querySelector("h2")?.cloneNode(true);
      heading?.querySelectorAll('[aria-hidden="true"]').forEach((element) => element.remove());
      return {
        id: section.id,
        title: heading?.textContent.trim() ?? "",
        readable: [...section.querySelectorAll("p, li")].some((element) => element.textContent.trim().length > 0),
      };
    }),
    anchorsValid: [...document.querySelectorAll('main.legal-page a[href^="#"]')].every((link) => document.getElementById(link.getAttribute("href").slice(1))),
    links: [...document.querySelectorAll("main.legal-page a[href]")].map((link) => link.getAttribute("href")),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  });
  const { page: staticLegal, context: staticLegalContext } = await newPage({ javaScriptEnabled: false, locale: "en-US", viewport: { width: 320, height: 844 } });
  const staticPages = {};
  for (const kind of ["privacy", "terms"]) {
    await staticLegal.goto(`${URL}${kind}/`, { waitUntil: "networkidle" });
    staticPages[kind] = await staticLegal.evaluate(inspectLegal);
  }
  check(
    "LG2",
    "禁用 JavaScript 可完整阅读两份政策，目录和相互链接有效",
    Object.entries(staticPages).every(([kind, state]) => state.lang === "en" && state.heading && state.sections.length > 1 &&
      state.sections.every((section) => section.title && section.readable) && state.anchorsValid &&
      state.links.includes(`/${kind === "privacy" ? "terms" : "privacy"}`) && state.links.includes("/guide") && state.overflow <= 0),
  );
  await staticLegalContext.close();

  await legal.goto(URL, { waitUntil: "networkidle" });
  await openAppMenu(legal);
  await legal.locator('.menu-legal-link[href="/privacy"]').click();
  await legal.locator("main.legal-page").waitFor();
  const privacyZh = await legal.evaluate(inspectLegal);
  check(
    "LG3",
    "手机菜单可进入隐私政策，当前项正确且菜单自动关闭",
    new globalThis.URL(legal.url()).pathname === "/privacy" && privacyZh.lang === "zh-CN" &&
      await legal.locator(".app-menu-toggle").getAttribute("aria-expanded") === "false" &&
      await legal.locator('.menu-legal-link[href="/privacy"]').getAttribute("aria-current") === "page",
  );
  await setAppPreference(legal, "locale", "en");
  const privacyEn = await legal.evaluate(inspectLegal);
  await legal.screenshot({ path: `${SP}/privacy-mobile.png` });
  await legal.evaluate(() => { window.legalSpaVisit = "preserved"; });
  await legal.locator('main.legal-page a[href="/terms"]').last().click();
  await legal.waitForURL(`${URL}terms`);
  const termsEn = await legal.evaluate(inspectLegal);
  check(
    "LG4",
    "政策相关链接通过客户端路由切换，英文各章节与 SSR 一致",
    await legal.evaluate(() => window.legalSpaVisit === "preserved") &&
      JSON.stringify(privacyEn.sections) === JSON.stringify(staticPages.privacy.sections) &&
      JSON.stringify(termsEn.sections) === JSON.stringify(staticPages.terms.sections) &&
      await legal.locator('.menu-legal-link[href="/terms"]').getAttribute("aria-current") === "page",
  );
  await setAppPreference(legal, "locale", "zh");
  const termsZh = await legal.evaluate(inspectLegal);
  await legal.screenshot({ path: `${SP}/terms-mobile.png` });
  check(
    "LG5",
    "两份政策随语言切换更新标题与正文，320px 中英文均无横向溢出",
    privacyZh.heading !== privacyEn.heading && privacyZh.title !== privacyEn.title &&
      termsZh.heading !== termsEn.heading && termsZh.title !== termsEn.title && termsZh.lang === "zh-CN" &&
      [privacyZh, privacyEn, termsZh, termsEn].every((state) => state.overflow <= 0 && state.anchorsValid && state.sections.every((section) => section.readable)),
  );

  const termsAnchor = staticPages.terms.sections[1].id;
  await legal.locator(`main.legal-page a[href="#${termsAnchor}"]`).click();
  const clickedAnchor = await legal.evaluate((id) => ({ hash: location.hash, top: document.getElementById(id).getBoundingClientRect().top }), termsAnchor);
  const privacyAnchor = staticPages.privacy.sections[1].id;
  await legal.goto(`${URL}privacy/#${privacyAnchor}`, { waitUntil: "networkidle" });
  await legal.locator(".app-menu-toggle").waitFor();
  const directAnchor = await legal.evaluate((id) => ({ hash: location.hash, top: document.getElementById(id).getBoundingClientRect().top }), privacyAnchor);
  check(
    "LG6",
    "政策目录和尾斜杠章节深链接在客户端挂载后均定位正确",
    clickedAnchor.hash === `#${termsAnchor}` && clickedAnchor.top >= 0 && clickedAnchor.top < 160 &&
      directAnchor.hash === `#${privacyAnchor}` && directAnchor.top >= 0 && directAnchor.top < 160,
    JSON.stringify({ clickedAnchor, directAnchor }),
  );
  check("LG7", "法律页面与菜单导航无脚本错误", legal.errors.length === 0, legal.errors.join("; "));
  await legalContext.close();
}

// ---------- T. 界面语言与外观主题 ----------
{
  const { page: p9, context: c9 } = await newPage({ locale: "en-US", colorScheme: "light" });
  await p9.goto(URL, { waitUntil: "networkidle" });
  const state = () =>
    p9.evaluate(() => ({
      lang: document.documentElement.lang,
      theme: document.documentElement.dataset.theme,
      brand: document.querySelector(".brand h1")?.textContent ?? "",
      generate: document.querySelector(".input-panel .btn-primary")?.textContent ?? "",
      title: document.querySelector(".note-title")?.textContent ?? "",
      bg: getComputedStyle(document.body).backgroundColor,
    }));
  const en = await state();
  check(
    "T1",
    "英文浏览器默认显示英文界面与英文示例笔记",
    en.lang === "en" && en.brand === "InkScribe" && en.generate.includes("Turn into a handwritten note") && en.title.includes("Spaced Repetition"),
    JSON.stringify(en),
  );
  check("T2", "系统为浅色时默认使用浅色主题", en.theme === "light" && en.bg !== "rgb(24, 24, 27)", `${en.theme} ${en.bg}`);

  await setAppPreference(p9, "locale", "zh");
  const zh = await state();
  check("T3", "切换为中文界面，未修改的示例笔记随之切换", zh.lang === "zh-CN" && zh.brand === "墨语笔记" && zh.title.includes("深度工作"), JSON.stringify(zh));

  await setAppPreference(p9, "theme", "dark");
  const dark = await state();
  check("T4", "可手动切换为深色主题", dark.theme === "dark" && dark.bg === "rgb(24, 24, 27)", `${dark.theme} ${dark.bg}`);

  await p9.reload({ waitUntil: "networkidle" });
  const reloaded = await state();
  check("T5", "语言与主题偏好在刷新后保留", reloaded.lang === "zh-CN" && reloaded.theme === "dark", JSON.stringify(reloaded));
  // 第一次生成仍在进行时（画布上还是示例笔记）切换语言，不能把生成结果当作过期结果丢掉
  await p9.route("**/api/structure", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await openInput(p9);
  await p9.selectOption(".sample-picker select", "en-lecture");
  await p9.click(".input-panel .btn-primary");
  await p9.waitForSelector(".loading-overlay");
  await setAppPreference(p9, "locale", "en");
  await p9.waitForSelector(".loading-overlay", { state: "detached", timeout: 20_000 });
  const midSwitch = await p9.evaluate(() => ({
    title: document.querySelector(".note-title")?.textContent ?? "",
    ai: document.querySelectorAll(".badge-ai").length,
    alert: document.querySelector(".alert-error")?.textContent ?? "",
  }));
  check(
    "T8",
    "生成过程中切换界面语言不会丢弃生成结果",
    midSwitch.ai === 1 && !midSwitch.alert && !midSwitch.title.includes("深度工作") && midSwitch.title !== "How Memory Works: Spaced Repetition",
    JSON.stringify(midSwitch),
  );
  await p9.unroute("**/api/structure");
  const layerLang = await p9.evaluate(() => ({
    layer: document.querySelector(".sticker-layer")?.getAttribute("lang"),
    ui: document.documentElement.lang,
  }));
  check("T9", "画布中的贴纸操作提示按界面语言标注", layerLang.layer === layerLang.ui, JSON.stringify(layerLang));
  check("T6", "切换语言与主题时无脚本错误", p9.errors.length === 0, p9.errors.join("; "));
  await c9.close();

  const { page: p10, context: c10 } = await newPage({ colorScheme: "dark" });
  await p10.goto(URL, { waitUntil: "networkidle" });
  check("T7", "系统为深色时默认使用深色主题", (await p10.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await c10.close();

  // 第一次生成失败后切换语言：错误提示与重试按钮保留，并换成新语言；已显示的导入提示也随语言切换
  const { page: p11, context: c11 } = await newPage();
  await p11.route("**/api/structure", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "AI_UNAVAILABLE", message: "AI 服务繁忙，请稍后重试。", requestId: "t10" } }),
    }),
  );
  await p11.goto(URL, { waitUntil: "networkidle" });
  await openInput(p11);
  await p11.selectOption(".sample-picker select", "zh-meeting");
  await p11.click(".input-panel .btn-primary");
  await p11.waitForSelector(".alert-error");
  await openInput(p11);
  await p11.locator('input[type="file"]').setInputFiles({ name: "old.doc", mimeType: "application/msword", buffer: Buffer.from("x") });
  await p11.waitForSelector(".upload-row + div .hint.is-error");
  await closeInput(p11);
  await setAppPreference(p11, "locale", "en");
  const afterSwitch = await p11.evaluate(() => ({
    alert: document.querySelector(".alert-error strong")?.textContent ?? "",
    retry: document.querySelector(".alert-error .btn")?.textContent ?? "",
    title: document.querySelector(".note-title")?.textContent ?? "",
    importHint: document.querySelector(".upload-row + div .hint.is-error")?.textContent ?? "",
  }));
  check(
    "T10",
    "生成失败后切换界面语言，错误提示与重试按钮保留并换成新语言",
    afterSwitch.alert.includes("AI service") && afterSwitch.retry === "Retry" && afterSwitch.title.includes("深度工作"),
    JSON.stringify(afterSwitch),
  );
  check("T11", "已显示的导入提示随界面语言切换", afterSwitch.importHint.includes("isn't supported"), afterSwitch.importHint);
  check("T12", "失败与切换流程无脚本错误", p11.errors.length === 0, p11.errors.join("; "));
  await c11.close();
}

// ---------- Q. 移动端 ----------
for (const [id, locale] of [["Q1", "zh-CN"], ["Q2", "en-US"]]) {
  const { page: p5, context: c5 } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale });
  await p5.goto(URL, { waitUntil: "networkidle" });
  const overflowX = await p5.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(id, `移动端（390px，${locale}）无横向滚动`, overflowX <= 0, `${overflowX}px`);
  await c5.close();
}

// ---------- I. 原文弹窗与移动端底部抽屉 ----------
{
  const { page, context } = await newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  const sheet = page.locator(".input-sheet");
  const isOpen = () => sheet.evaluate((dialog) => dialog.open);
  const triggerFocused = () => page.locator(".input-trigger").evaluate((element) => element === document.activeElement);
  check("IS1", "原文默认收起，画布占据主区域", !(await isOpen()) && await page.locator(".input-trigger").isVisible());

  await openInput(page);
  check("IS2", "打开原文弹窗后聚焦输入框", await page.locator(".source-text").evaluate((element) => element === document.activeElement));
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });
  check("IS3", "Esc 关闭弹窗并将焦点归还入口按钮", !(await isOpen()) && await triggerFocused());

  await openInput(page);
  await page.locator(".source-text").fill("在输入框里拖选文字，松手落在遮罩上");
  const box = await page.locator(".source-text").boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(20, 500, { steps: 5 });
  await page.mouse.up();
  const keptOpen = await isOpen();
  await page.mouse.click(20, 500);
  await sheet.waitFor({ state: "hidden" });
  check("IS4", "点击遮罩关闭弹窗，从输入框拖选到遮罩时不关闭", keptOpen && !(await isOpen()));

  await page.route("**/api/structure", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // 取消生成后请求已被页面中止，继续请求会失败
    await route.continue().catch(() => {});
  });
  await openInput(page);
  await page.getByRole("button", { name: /转化为手写笔记/ }).click();
  await page.waitForSelector(".loading-overlay");
  await sheet.waitFor({ state: "hidden" });
  await page.locator(".loading-card").getByRole("button", { name: "取消生成" }).click();
  await page.waitForSelector(".loading-overlay", { state: "detached" });
  check("IS5", "生成时关闭弹窗，可在画布上取消生成", await page.locator(".alert-error").count() === 0 && await page.locator(".source-text").inputValue() === "在输入框里拖选文字，松手落在遮罩上");
  await page.unroute("**/api/structure");

  await page.route("**/api/structure", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "AI_UNAVAILABLE", message: "AI 服务繁忙，请稍后重试。", requestId: "i6" } }) }),
  );
  await openInput(page);
  await page.getByRole("button", { name: /转化为手写笔记/ }).click();
  await page.locator(".alert-error").getByRole("button", { name: "修改原文" }).click();
  await sheet.waitFor({ state: "visible" });
  check("IS6", "生成失败后可从错误提示重新打开原文", await isOpen());
  await closeInput(page);
  await page.unroute("**/api/structure");
  check("IS7", "草稿与笔记库状态在弹窗关闭时仍可见", await page.locator(".side-panel [data-draft-status]").isVisible() && await page.locator(".side-panel [data-library-status]").isVisible());
  check("IS8", "原文弹窗流程无脚本错误", page.errors.length === 0, page.errors.join("; "));
  await context.close();
}

{
  const viewport = { width: 390, height: 844 };
  const { page, context } = await newPage({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "networkidle" });
  const trigger = await page.locator(".input-trigger").boundingBox();
  check("IS9", "移动端“撰写”按钮固定在屏幕底部", trigger && viewport.height - (trigger.y + trigger.height) <= 24 && trigger.y > viewport.height / 2, JSON.stringify(trigger));
  await page.locator(".input-trigger").tap();
  await page.locator(".input-sheet").waitFor({ state: "visible" });
  await page.waitForTimeout(400);
  const sheetBox = await page.locator(".input-sheet").boundingBox();
  const mobile = await page.evaluate(() => ({
    fontSize: parseFloat(getComputedStyle(document.querySelector(".source-text")).fontSize),
    textareaFocused: document.activeElement === document.querySelector(".source-text"),
    optionsHidden: getComputedStyle(document.querySelector(".options-fields")).display === "none",
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  check(
    "IS10",
    "移动端原文显示为贴底的抽屉，不自动弹出键盘，输入框字号不触发 iOS 缩放",
    Math.abs(sheetBox.y + sheetBox.height - viewport.height) <= 1 && sheetBox.width === viewport.width && sheetBox.y > 0 &&
      mobile.fontSize >= 16 && !mobile.textareaFocused && mobile.overflowX <= 0,
    JSON.stringify({ sheetBox, ...mobile }),
  );
  await page.locator(".options-toggle").tap();
  check("IS11", "移动端生成选项默认收起，可展开", mobile.optionsHidden && await page.getByRole("radio", { name: "读书摘抄" }).isVisible());
  await page.selectOption(".sample-picker select", "zh-reading");
  await page.getByRole("button", { name: /转化为手写笔记/ }).tap();
  await page.waitForSelector(".badge-ai");
  // mock 接口可能在关闭动画结束前就返回，等动画结束后再检查
  const closed = await page.locator(".input-sheet").waitFor({ state: "hidden", timeout: 2000 }).then(() => true, () => false);
  check("IS12", "移动端生成后收起抽屉并显示新笔记", closed && page.errors.length === 0, page.errors.join("; "));
  await context.close();
}

// 软键盘避让与下滑关闭（移动端），拖入文件与快捷键（桌面端）
{
  const viewport = { width: 390, height: 844 };
  const { page, context } = await newPage({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "networkidle" });
  const sheet = page.locator(".input-sheet");
  await page.locator(".input-trigger").tap();
  await sheet.waitFor({ state: "visible" });
  await page.waitForTimeout(400);
  // 自动化浏览器不会弹出软键盘：把 visualViewport 缩小 300px 来模拟
  const keyboard = 300;
  await page.evaluate((height) => {
    const visual = window.visualViewport;
    const visible = visual.height - height;
    Object.defineProperty(visual, "height", { configurable: true, get: () => visible });
    visual.dispatchEvent(new Event("resize"));
  }, keyboard);
  const withKeyboard = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      sheet: rect(".input-sheet"),
      generate: rect(".input-sheet .btn-primary"),
      textarea: rect(".source-text").height,
      upload: getComputedStyle(document.querySelector(".upload-row")).display,
    };
  });
  check(
    "IS13",
    "软键盘弹出时抽屉抬到键盘上方，输入框与生成按钮可见",
    Math.abs(withKeyboard.sheet.bottom - (viewport.height - keyboard)) <= 1 && withKeyboard.sheet.top >= 0 &&
      withKeyboard.generate.bottom <= viewport.height - keyboard && withKeyboard.textarea >= 90 && withKeyboard.upload === "none",
    JSON.stringify(withKeyboard),
  );
  await page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  const box = await sheet.boundingBox();
  check("IS14", "软键盘收起后抽屉恢复贴底", Math.abs(box.y + box.height - viewport.height) <= 1, JSON.stringify(box));

  // 按住标题栏（拖动把手处）下拉：拖得少、拖得慢时弹回，拖过四分之一高度时关闭
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + 8);
  await page.mouse.down();
  for (let step = 1; step <= 4; step++) {
    await page.mouse.move(x, box.y + 8 + step * 8);
    await page.waitForTimeout(50);
  }
  const dragged = await sheet.evaluate((dialog) => dialog.style.transform);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const snapped = await sheet.evaluate((dialog) => ({ open: dialog.open, transform: dialog.style.transform, top: dialog.getBoundingClientRect().top }));
  check("IS15", "轻拉抽屉后松手弹回原位", dragged === "translateY(32px)" && snapped.open && snapped.transform === "" && Math.abs(snapped.top - box.y) <= 1, JSON.stringify({ dragged, snapped }));

  // IS24：短距离快速滑动后停住再松手，最后一次移动的速度应当过期
  await page.mouse.move(x, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(x, box.y + 40);
  const pausedDrag = await sheet.evaluate((dialog) => dialog.style.transform);
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const pausedRelease = await sheet.evaluate((dialog) => ({
    open: dialog.open,
    transform: dialog.style.transform,
    top: dialog.getBoundingClientRect().top,
  }));
  check(
    "IS24",
    "短距离下拉后停顿再松手不会以过期速度关闭抽屉",
    pausedDrag === "translateY(32px)" && pausedRelease.open && pausedRelease.transform === "" && Math.abs(pausedRelease.top - box.y) <= 1,
    JSON.stringify({ pausedDrag, pausedRelease }),
  );

  await page.mouse.move(x, box.y + 8);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(x, box.y + 8 + step * 50);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  const dismissed = await sheet.waitFor({ state: "hidden", timeout: 2000 }).then(() => true, () => false);
  check("IS16", "下拉超过四分之一高度关闭抽屉", dismissed && await sheet.evaluate((dialog) => dialog.style.transform) === "" && page.errors.length === 0, page.errors.join("; "));

  // IS25：背景遮罩的动画结束事件不应抢在底部抽屉的退场动画之前关闭 dialog
  await page.locator(".input-trigger").tap();
  await sheet.waitFor({ state: "visible" });
  const backdropIgnored = await sheet.evaluate(async (dialog) => {
    const closingStarted = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!dialog.hasAttribute("data-closing")) return;
        observer.disconnect();
        clearTimeout(timeout);
        resolve(true);
      });
      observer.observe(dialog, { attributes: true, attributeFilter: ["data-closing"] });
      const timeout = setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, 500);
    });
    dialog.querySelector(".sheet-close").click();
    if (!(await closingStarted)) return false;
    const event = new AnimationEvent("animationend", { bubbles: true, animationName: "sheet-fade-out", pseudoElement: "::backdrop" });
    dialog.dispatchEvent(event);
    return event.pseudoElement === "::backdrop" && dialog.open && dialog.hasAttribute("data-closing");
  });
  check("IS25", "遮罩动画结束不能提前打断底部抽屉关闭动画", backdropIgnored);
  await sheet.waitFor({ state: "hidden" });
  await context.close();
}

{
  const { page, context } = await newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  const sheet = page.locator(".input-sheet");
  const fileTransfer = (name, text) =>
    page.evaluateHandle(([name, text]) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], name, { type: "text/plain" }));
      return transfer;
    }, [name, text]);

  let dataTransfer = await fileTransfer("dropped.txt", "拖到页面上的文件内容");
  await page.dispatchEvent(".workspace", "dragenter", { dataTransfer });
  await page.locator(".drop-overlay.is-page").waitFor();
  await page.dispatchEvent(".drop-overlay", "dragleave", { dataTransfer });
  const leaveHides = await page.locator(".drop-overlay").count() === 0;
  await page.dispatchEvent(".side-panel", "dragenter", { dataTransfer });
  await page.dispatchEvent(".drop-overlay", "dragover", { dataTransfer });
  await page.dispatchEvent(".drop-overlay", "drop", { dataTransfer });
  await sheet.waitFor({ state: "visible" });
  await page.locator(".input-panel .hint.is-ok").waitFor();
  check(
    "IS17",
    "把文件拖到页面任意位置：打开原文弹窗并导入，移开时提示消失",
    leaveHides && await page.locator(".source-text").inputValue() === "拖到页面上的文件内容" &&
      (await page.locator(".input-panel .hint.is-ok").innerText()).includes("dropped.txt") && await page.locator(".drop-overlay").count() === 0,
  );

  dataTransfer = await fileTransfer("second.txt", "弹窗里拖入的第二个文件");
  await page.dispatchEvent(".sheet-head", "dragenter", { dataTransfer });
  await page.locator(".input-panel .drop-overlay").waitFor();
  const pageOverlay = await page.locator(".drop-overlay.is-page").count();
  await page.dispatchEvent(".input-panel .drop-overlay", "drop", { dataTransfer });
  await page.waitForFunction(() => document.querySelector(".source-text").value === "弹窗里拖入的第二个文件");
  check("IS18", "弹窗打开时，拖到弹窗任意位置的文件由弹窗接收", pageOverlay === 0 && await page.locator(".drop-overlay").count() === 0);

  const source = page.locator(".source-text");
  const isApple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.userAgent));
  const accelerator = isApple ? "Meta+Enter" : "Control+Enter";
  await source.fill("");
  await source.press(accelerator);
  const emptyStays = await sheet.evaluate((dialog) => dialog.open);
  await source.fill("快捷键生成：间隔重复与主动回忆。");
  await source.press(accelerator);
  await page.waitForSelector(".badge-ai");
  const closed = await sheet.waitFor({ state: "hidden", timeout: 2000 }).then(() => true, () => false);
  check(
    "IS19",
    "平台对应快捷键生成并收起弹窗，原文为空时不生成",
    emptyStays && closed && (await page.locator(".shortcut-hint").textContent()) === (isApple ? "⌘" : "Ctrl") + " + Enter 生成",
  );
  check("IS20", "拖入文件与快捷键流程无脚本错误", page.errors.length === 0, page.errors.join("; "));
  await context.close();
}

// 从遮罩按下、在弹窗内松开不关闭；窄屏上长笔记生成时加载提示与取消按钮始终可见
{
  const { page, context } = await newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await openInput(page);
  const box = await page.locator(".input-sheet").boundingBox();
  await page.mouse.move(20, 500);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  check("IS21", "从遮罩按下、拖进弹窗内松开时不关闭弹窗", await page.locator(".input-sheet").evaluate((dialog) => dialog.open && !dialog.hasAttribute("data-closing")));
  await context.close();
}

{
  const viewport = { width: 390, height: 844 };
  const { page, context } = await newPage({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "样式" }).click();
  await page.locator(".field").filter({ hasText: "页面尺寸" }).locator("select").selectOption("long");
  // 放大到 160%，让画布远高于屏幕，再滚到页面底部
  for (let i = 0; i < 14; i++) await page.getByRole("button", { name: "放大" }).click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.route("**/api/structure", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue().catch(() => {});
  });
  await page.locator(".input-trigger").tap();
  await page.selectOption(".sample-picker select", "zh-reading");
  await page.getByRole("button", { name: /转化为手写笔记/ }).tap();
  await page.locator(".input-sheet").waitFor({ state: "hidden" });
  const card = await page.locator(".loading-card").boundingBox();
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const inView = card && card.y >= 0 && card.y + card.height <= viewport.height;
  await page.locator(".loading-card").getByRole("button", { name: "取消生成" }).tap();
  await page.waitForSelector(".loading-overlay", { state: "detached" });
  check("IS22", "窄屏长笔记生成时，加载提示与取消按钮在屏幕内", inView && pageHeight > viewport.height * 3 && page.errors.length === 0, JSON.stringify({ card, pageHeight, errors: page.errors }));
  await page.unroute("**/api/structure");
  await context.close();
}

// 桌面画布放大后，生成状态卡片必须保持在水平可见的画布区域内
{
  const { page, context } = await newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(URL, { waitUntil: "networkidle" });
  for (let i = 0; i < 20; i++) await page.getByRole("button", { name: "放大" }).click();
  // 让生成请求保持挂起，留足时间检查水平滚动两端的真实可见性
  let pendingRequest;
  await page.route("**/api/structure", (route) => { pendingRequest = route; });
  await openInput(page);
  await page.selectOption(".sample-picker select", "zh-reading");
  await page.getByRole("button", { name: /转化为手写笔记/ }).click();
  await page.locator(".input-sheet").waitFor({ state: "hidden" });
  await page.locator(".loading-card").waitFor();

  const positions = [];
  for (const fraction of [0, 0.5, 1]) {
    await page.locator(".viewport").evaluate((viewport, f) => {
      viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) * f;
    }, fraction);
    positions.push(await page.evaluate(() => {
      const viewport = document.querySelector(".viewport");
      const visible = viewport.getBoundingClientRect();
      const card = document.querySelector(".loading-card").getBoundingClientRect();
      const cancel = document.querySelector(".loading-card button").getBoundingClientRect();
      return {
        scrollLeft: viewport.scrollLeft,
        scrollableWidth: viewport.scrollWidth - viewport.clientWidth,
        canvas: { left: visible.left, right: visible.right },
        card: { left: card.left, right: card.right },
        cancel: { left: cancel.left, right: cancel.right },
      };
    }));
  }
  const inside = positions.every(({ canvas, card, cancel }) =>
    card.left >= canvas.left - 1 && card.right <= canvas.right + 1 &&
    cancel.left >= canvas.left - 1 && cancel.right <= canvas.right + 1,
  );
  const actuallyOverflowed = positions[0].scrollableWidth > 400 && positions[2].scrollLeft > 400;
  await page.locator(".loading-card").getByRole("button", { name: "取消生成" }).click();
  await page.locator(".loading-overlay").waitFor({ state: "detached" });
  check(
    "IS26",
    "桌面端 1000px 视口、160% 缩放，横向滚动时加载卡片和取消按钮始终可见且可取消",
    actuallyOverflowed && inside && page.errors.length === 0,
    JSON.stringify({ positions, errors: page.errors }),
  );
  await pendingRequest?.abort().catch(() => {});
  await page.unroute("**/api/structure");
  await context.close();
}

// 弹窗内的按键不能触发背后画布的贴纸快捷键，Esc 仍能关闭弹窗
{
  const { page, context } = await newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "贴纸", exact: true }).click();
  await page.getByTitle("和纸胶带 · 薄荷", { exact: true }).click();
  await page.locator(".sticker-selection").waitFor();
  const before = await page.locator(".sticker").count();
  await openInput(page);
  await page.locator(".input-sheet .sheet-close").focus();
  for (const key of ["Delete", "Backspace", "ArrowLeft"]) await page.keyboard.press(key);
  const after = await page.locator(".sticker").count();
  await page.keyboard.press("Escape");
  const closed = await page.locator(".input-sheet").waitFor({ state: "hidden", timeout: 2000 }).then(() => true, () => false);
  check("IS23", "弹窗打开时按键不删除或移动背后选中的贴纸，Esc 关闭弹窗", before > 0 && after === before && closed, JSON.stringify({ before, after, closed }));
  await context.close();
}

// ---------- D. 本地草稿 ----------
{
  const { page, context } = await newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await fillSource(page, "草稿原文：刷新后必须保留。");
  await page.locator('[data-draft-status="saved"]').waitFor();
  await page.getByRole("tab", { name: "内容", exact: true }).click();
  const titleInput = page.locator(".content-editor input").first();
  await titleInput.fill("恢复测试标题");
  await page.locator('[data-draft-status="saved"]').waitFor();
  await page.reload({ waitUntil: "networkidle" });
  check("DR1", "刷新恢复原文和编辑后的笔记", await page.locator(".source-text").inputValue() === "草稿原文：刷新后必须保留。" && await page.locator(".note-title").first().innerText() === "恢复测试标题");
  check("DR2", "恢复后明确显示本机保存状态", await page.locator('[data-draft-status="restored"]').count() === 1);

  await page.getByRole("tab", { name: "内容", exact: true }).click();
  const highlights = page.locator(".section-editor input").nth(1);
  await highlights.fill("重点一；未完成的重点， ");
  await page.locator('[data-draft-status="saved"]').waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "内容", exact: true }).click();
  check("DR7", "重点词输入未失焦也可刷新恢复", await page.locator(".section-editor input").nth(1).inputValue() === "重点一；未完成的重点， ");

  const other = await context.newPage();
  await other.goto(URL, { waitUntil: "networkidle" });
  await fillSource(page, "第一标签页的新内容");
  await page.locator('[data-draft-status="saved"]').waitFor();
  await fillSource(other, "第二标签页未保存内容");
  await other.locator('[data-draft-status="conflict"]').waitFor();
  check("DR3", "多标签页冲突暂停保存并保留当前编辑", await other.locator(".source-text").inputValue() === "第二标签页未保存内容");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除草稿并停止保存", exact: true }).click();
  await page.locator('[data-draft-status="disabled"]').waitFor();
  await page.reload({ waitUntil: "networkidle" });
  check("DR4", "删除后刷新不恢复旧内容，不留存模式持续生效", await page.locator(".source-text").inputValue() === "" && await page.locator('[data-draft-status="disabled"]').count() === 1);
  await page.getByRole("button", { name: "启用本机自动保存", exact: true }).click();
  await fillSource(page, "重新启用后的内容");
  await page.locator('[data-draft-status="saved"]').waitFor();
  await page.reload({ waitUntil: "networkidle" });
  check("DR5", "可重新启用自动保存", await page.locator(".source-text").inputValue() === "重新启用后的内容");
  check("DR6", "草稿流程无脚本错误", page.errors.length === 0, page.errors.join("; "));
  await context.close();
}

{
  const { page, context } = await newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await fillSource(page, "已有输入的示例笔记");
  await page.locator('[data-draft-status="saved"]').waitFor();
  await setAppPreference(page, "locale", "en");
  await page.locator('[data-draft-status="saved"]').waitFor();
  const title = await page.locator(".note-title").first().innerText();
  await page.reload({ waitUntil: "networkidle" });
  check("DR8", "切换语言后的示例笔记与刷新恢复结果一致", await page.locator(".note-title").first().innerText() === title);
  await context.close();
}

// ---------- L. 本机笔记库 ----------
{
  const { page, context } = await newPage();
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(URL, { waitUntil: "networkidle" });
  const editTitle = async (title) => {
    await page.getByRole("tab", { name: "内容", exact: true }).click();
    await page.locator(".content-editor input").first().fill(title);
  };
  await editTitle("笔记库第一条");
  await page.locator('[data-library-status="unsaved"]').waitFor();
  await page.getByRole("button", { name: "保存到笔记库", exact: true }).click();
  await page.locator('[data-library-status="linked"]').waitFor();
  await editTitle("笔记库第二条");
  await page.locator('[data-library-status="modified"]').waitFor();
  await page.getByRole("button", { name: "另存为新笔记", exact: true }).click();
  await page.locator('[data-library-status="linked"]').waitFor();
  await page.locator('[data-draft-status="saved"]').waitFor();
  await page.reload({ waitUntil: "networkidle" });
  const relinked = await page.locator('[data-library-status="linked"]').waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("LB1", "刷新后仍关联笔记库条目且无未保存修改", relinked);

  await openAppMenu(page);
  await page.getByRole("link", { name: "笔记库", exact: true }).click();
  const cards = page.locator(".library-card");
  await cards.nth(1).waitFor();
  const titles = await cards.locator(".gallery-caption strong").allInnerTexts();
  check("LB2", "笔记库按更新时间列出多条笔记", JSON.stringify(titles) === JSON.stringify(["笔记库第二条", "笔记库第一条"]), JSON.stringify(titles));
  await page.getByRole("button", { name: "打开“笔记库第一条”", exact: true }).click();
  await page.locator(".note-title").first().waitFor();
  check("LB3", "从笔记库打开笔记到编辑器", await page.locator(".note-title").first().innerText() === "笔记库第一条" && await page.locator('[data-library-status="linked"]').count() === 1);

  await openAppMenu(page);
  await page.getByRole("link", { name: "笔记库", exact: true }).click();
  await cards.nth(1).waitFor();
  await page.locator(".library-search").fill("第二");
  const filtered = await page.waitForFunction(() => document.querySelectorAll(".library-card").length === 1, null, { timeout: 5000 }).then(() => true, () => false);
  check("LB4", "按标题搜索笔记", filtered && (await cards.locator(".gallery-caption strong").innerText()) === "笔记库第二条");
  await page.locator(".library-search").fill("");
  await cards.nth(1).waitFor();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出备份", exact: true }).click();
  const backup = `${SP}/library-backup.json`;
  await (await download).saveAs(backup);
  await page.getByRole("button", { name: "删除“笔记库第二条”", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".library-card").length === 1);
  await page.locator('.library-main input[type="file"]').setInputFiles(backup);
  await page.locator(".library-main .hint.is-ok").waitFor();
  // The notice appears before the list reloads, so wait for the restored card rather than counting at once.
  const restored = await page.waitForFunction(() => document.querySelectorAll(".library-card").length === 2, null, { timeout: 5000 }).then(() => true, () => false);
  check("LB5", "导出备份后可导入恢复已删除的笔记", restored);
  // The editor still holds "笔记库第一条"; once another tab deletes it, opening another note must ask first.
  const other = await context.newPage();
  other.on("dialog", (dialog) => dialog.accept());
  await other.goto(`${URL}library`, { waitUntil: "networkidle" });
  await other.getByRole("button", { name: "删除“笔记库第一条”", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".library-card").length === 1);
  const prompts = [];
  page.on("dialog", (dialog) => prompts.push(dialog.message()));
  await page.getByRole("button", { name: "打开“笔记库第二条”", exact: true }).click();
  await page.locator(".note-title").first().waitFor();
  check("LB6", "另一标签页删除当前笔记后，打开其他笔记前先确认", prompts.some((m) => m.includes("尚未保存到笔记库")), JSON.stringify(prompts));
  await other.close();
  check("LB7", "笔记库流程无脚本错误", page.errors.length === 0, page.errors.join("; "));
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(`${SP}/acceptance-results.json`, JSON.stringify(results, null, 2));
if (failed.length > 0) process.exit(1);
