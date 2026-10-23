// 浏览器端验收测试：对照实施计划第 7 节的验收标准逐条断言，输出 PASS / FAIL。
// 由 e2e/run.mjs 启动 mock 构建的预览服务后调用；也可对已运行的服务直接执行：
//   E2E_BASE_URL=http://127.0.0.1:4173/ node e2e/acceptance.mjs
import { chromium } from "playwright";
import { strToU8, zipSync } from "fflate";
import fs from "node:fs";

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
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, ...options });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of (4|5)\d\d/.test(m.text())) page.errors.push(m.text());
  });
  return { context, page };
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
await page.getByTitle("和纸胶带 · 薄荷").click();
const stickers = page.locator(".sticker");
const first = stickers.nth(0);
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

// ---------- R1. 溢出时“精简后重新生成” ----------
await page.getByRole("tab", { name: "样式" }).click();
await page.locator(".range-field").filter({ hasText: "字号" }).locator("input").fill("28");
await page.locator(".range-field").filter({ hasText: "行距" }).locator("input").fill("2.4");
await page.waitForTimeout(300);
const condenseBtn = page.getByRole("button", { name: "精简后重新生成" });
const hasCondense = (await condenseBtn.count()) === 1;
if (hasCondense) {
  const [res] = await Promise.all([page.waitForResponse("**/api/structure"), condenseBtn.click()]);
  const body = JSON.parse(res.request().postData());
  await page.waitForTimeout(500);
  check("R1", "内容溢出时提供“精简后重新生成”，并以精简档位重新请求", body.detail === "concise", `detail=${body.detail}`);
} else {
  check("R1", "内容溢出时提供“精简后重新生成”，并以精简档位重新请求", false, "按钮不存在");
}
await page.locator(".range-field").filter({ hasText: "字号" }).locator("input").fill("17");
await page.locator(".range-field").filter({ hasText: "行距" }).locator("input").fill("1.6");

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
const handlePixels = await page.evaluate(async (data) => {
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
  return count;
}, b64);
check("H5", "导出图片不包含贴纸选框与手柄", framesBeforeExport === 1 && handlePixels === 0, `导出前选框 ${framesBeforeExport} 个，导出图中选框色像素 ${handlePixels}`);

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
  await p3.getByRole("button", { name: /转化为手写笔记/ }).click();
  await p3.waitForTimeout(800);
  const survived = await p3.evaluate(() => ({ page: document.querySelectorAll(".note-page").length, alert: document.querySelector(".alert-error")?.textContent ?? "" }));
  check("L2", "接口返回残缺结构时前端不崩溃并给出错误提示", survived.page === 1 && survived.alert.length > 0 && p3.errors.length === 0, `${JSON.stringify(survived)} ${p3.errors.slice(0, 1).join("")}`);
  await p3.unroute("**/api/structure");

  await p3.route("**/api/structure", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ note: { title: "t", cues: "abc", sections: [{ content: "c", highlights: "x" }], summary: 5 }, meta: { requestId: "t3", model: "m", latencyMs: 1, attempts: 1, warnings: [] } }) }),
  );
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
  await p4.locator(".source-text").fill("任意文本");
  const cases = [
    ["AI_TIMEOUT", 504, "AI 处理超时，请缩短文本或稍后重试。", "精简"],
    ["RATE_LIMITED", 429, "请求过于频繁，请稍后再试。", "一分钟"],
    ["AI_OUTPUT_INVALID", 502, "无法生成有效的笔记结构，请重试。", "重试"],
  ];
  for (const [code, status, message, hintWord] of cases) {
    await p4.route("**/api/structure", (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message, requestId: "r1" } }) }));
    await p4.getByRole("button", { name: /转化为手写笔记/ }).click();
    await p4.waitForSelector(".alert-error");
    const text = await p4.locator(".alert-error").innerText();
    check(`N-${code}`, `错误 ${code} 有可理解的提示`, text.includes(message) && text.includes(code) && text.includes(hintWord), text.replace(/\s+/g, " ").slice(0, 80));
    await p4.unroute("**/api/structure");
  }
  await p4.route("**/api/structure", (route) => route.abort("internetdisconnected"));
  await p4.getByRole("button", { name: /转化为手写笔记/ }).click();
  await p4.waitForSelector(".alert-error");
  check("N-NETWORK", "网络错误有可理解的提示", (await p4.locator(".alert-error").innerText()).includes("网络"));
  await c4.close();
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
  const title = `E2E 公开笔记 ${Date.now()}`;
  const created = await p7.request.post(`${URL}api/v1/notes`, {
    headers: { ...auth, "Idempotency-Key": `e2e-${Date.now()}` },
    data: {
      note: { title, sections: [{ heading: "要点", content: "这是通过 API 发布的笔记。\n- 列表项", highlights: ["API"] }], summary: "总结一句话" },
      template: "lecture-summary",
      visibility: "public",
      appearance: { paper: "kraft", ink: "brown", layout: "free-journal" },
      stickers: [{ type: "star", x: 700, y: 120, variant: "gold" }],
    },
  });
  const note = await created.json();
  check("V1", "API 密钥发布笔记并返回链接", created.status() === 201 && /\/n\/[A-Za-z0-9_-]{22}$/.test(note.url), `${created.status()} ${note.url}`);
  const unauth = await p7.request.post(`${URL}api/v1/notes`, { data: { note: { title: "x", sections: [{ content: "y" }] } } });
  check("V2", "没有密钥时拒绝发布", unauth.status() === 401);

  const shareResponse = await p7.request.get(note.url);
  const html = await shareResponse.text();
  check("V3", "分享链接的 HTML 带有标题与 Open Graph 信息", html.includes(`<title>${title} · 墨语笔记</title>`) && html.includes(`og:title" content="${title}"`), `HTTP ${shareResponse.status()} ${html.slice(0, 160).replace(/\s+/g, " ")}`);
  check("V3b", "分享链接的 HTML 直接包含笔记正文与 Article 结构化数据", html.includes(`<h1>${title}</h1>`) && html.includes("<li>列表项</li>") && html.includes('"@type":"Article"') && html.includes(`<link rel="canonical" href="${note.url}"`));

  await p7.goto(note.url, { waitUntil: "networkidle" });
  await p7.waitForSelector(".note-page");
  const view = await p7.evaluate(() => ({
    title: document.querySelector(".note-title")?.textContent ?? "",
    cls: document.querySelector(".note-page")?.className ?? "",
    stickers: document.querySelectorAll(".sticker").length,
    handles: document.querySelectorAll(".sticker-selection").length,
  }));
  check("V4", "查看页按发布时的外观只读渲染", view.title.includes("E2E") && view.cls.includes("paper-kraft") && view.cls.includes("layout-free-journal") && view.stickers === 1 && view.handles === 0, JSON.stringify(view));

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
  await p7.waitForSelector(".input-panel");
  const editor = await p7.evaluate(() => ({
    badge: document.querySelector(".workspace-status")?.textContent ?? "",
    stickers: document.querySelectorAll(".sticker").length,
    cls: document.querySelector(".note-page")?.className ?? "",
  }));
  check("V6", "从查看页把笔记（含外观与贴纸）载入编辑器", editor.badge.includes("已发布") && editor.stickers === 1 && editor.cls.includes("paper-kraft"), JSON.stringify(editor));

  const unlisted = await (await p7.request.post(`${URL}api/v1/notes`, { headers: auth, data: { note: { title: `E2E 隐藏 ${Date.now()}`, sections: [{ content: "仅链接可见" }] } } })).json();
  const gallery = await (await p7.request.get(`${URL}api/gallery?limit=50`)).json();
  const unlistedHtml = await (await p7.request.get(unlisted.url)).text();
  check("V7", "仅链接可见的笔记不进入图库且禁止搜索引擎收录", unlisted.visibility === "unlisted" && !gallery.items.some((i) => i.id === unlisted.id) && unlistedHtml.includes("noindex"));

  const removed = await p7.request.delete(`${URL}api/v1/notes/${note.id}`, { headers: auth });
  await p7.request.delete(`${URL}api/v1/notes/${unlisted.id}`, { headers: auth });
  await p7.goto(note.url, { waitUntil: "networkidle" });
  const goneText = await p7.locator(".empty-state").innerText({ timeout: 10000 }).catch(async () => `[未找到提示] ${(await p7.locator("main").innerText()).slice(0, 80)}`);
  check("V9", "删除后链接显示“不存在”", removed.status() === 204 && goneText.includes("不存在"), `DELETE ${removed.status()}；${goneText}`);
  check("V10", "发布与查看流程无脚本错误", p7.errors.length === 0, p7.errors.join("; "));
  await c7.close();
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
  check("S6", "llms.txt 介绍产品、页面与 API", llms.includes("## 页面") && llms.includes("/api/v1/notes"));
  check("S7", "SEO 页面无脚本错误", p8.errors.length === 0, p8.errors.join("; "));
  await c8.close();
}

// ---------- Q. 移动端 ----------
{
  const { page: p5, context: c5 } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p5.goto(URL, { waitUntil: "networkidle" });
  const overflowX = await p5.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("Q1", "移动端（390px）无横向滚动", overflowX <= 0, `${overflowX}px`);
  await c5.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(`${SP}/acceptance-results.json`, JSON.stringify(results, null, 2));
if (failed.length > 0) process.exit(1);
