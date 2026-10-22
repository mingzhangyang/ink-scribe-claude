// 生成品牌资源到 public/：标志、favicon（SVG/ICO）、PWA 图标、apple-touch-icon 与 OG 分享图（JPEG，体积更小）。
// 图形由 marks.mjs 中的 SVG 描述，OG 图在 Chromium 的 canvas 中绘制（使用项目自带的手写字体），
// 结果是确定的静态文件，提交到仓库即可。修改设计后执行：npm run brand
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { COLORS, logoSvg } from "./marks.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "public");
const SITE_HOST = "ink-scribe.orangely.xyz";

const svgUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const fontCss = [
  "node_modules/lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css",
  "node_modules/@fontsource/kalam/400.css",
  "node_modules/@fontsource/kalam/700.css",
].map((file) => pathToFileURL(path.join(ROOT, file)).href);

/** 把多张 PNG 打包成 ICO（ICO 允许直接内嵌 PNG 数据）。 */
function buildIco(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((png) => png.data)]);
}

/** 在页面中运行：把 SVG 栅格化为指定尺寸的 PNG（data URL）。 */
async function rasterize([src, size]) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}

/** 在页面中运行：用 canvas 绘制 1200×630 的 OG 分享图。 */
async function drawOgImage({ logo, colors, host }) {
  const W = 1200;
  const H = 630;
  const zh = '"LXGW WenKai Screen"';
  const en = '"Kalam"';
  const texts = "墨语笔记粘贴文字，AI 整理成一页手写笔记学习康奈尔结构线索关键词要点总结高亮字体纸张一键导出高清图片方法核心手写→";
  await Promise.all([document.fonts.load(`40px ${zh}`, texts), document.fonts.load(`40px ${en}`, "InkScribe 0123456789-."), document.fonts.load(`bold 40px ${en}`, "InkScribe")]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 背景：墨蓝渐变 + 淡淡的点阵
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#22388a");
  bg.addColorStop(1, colors.inkDeep);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let y = 18; y < H; y += 28) for (let x = 18; x < W; x += 28) ctx.fillRect(x, y, 2, 2);

  // 手写波浪线
  function scribble(x, y, w, amp = 3) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    const step = 22;
    for (let i = 0; x + step * (i + 1) <= x + w; i++) {
      ctx.quadraticCurveTo(x + step * i + step / 2, y + (i % 2 ? amp : -amp), x + step * (i + 1), y);
    }
    ctx.stroke();
  }

  // 右侧：一页倾斜的康奈尔笔记
  ctx.save();
  ctx.translate(880, 322);
  ctx.rotate((4 * Math.PI) / 180);
  const pw = 430;
  const ph = 520;
  const left = -pw / 2;
  const top = -ph / 2;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = colors.paper;
  ctx.beginPath();
  ctx.roundRect(left, top, pw, ph, 10);
  ctx.fill();
  ctx.shadowColor = "transparent";
  // 方格
  ctx.strokeStyle = "rgba(30,58,138,0.07)";
  ctx.lineWidth = 1;
  for (let x = left + 22; x < left + pw; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, top + 8);
    ctx.lineTo(x, top + ph - 8);
    ctx.stroke();
  }
  for (let y = top + 22; y < top + ph; y += 22) {
    ctx.beginPath();
    ctx.moveTo(left + 8, y);
    ctx.lineTo(left + pw - 8, y);
    ctx.stroke();
  }
  // 和纸胶带
  ctx.save();
  ctx.translate(0, top + 4);
  ctx.rotate((-3 * Math.PI) / 180);
  ctx.fillStyle = "rgba(232,196,104,0.78)";
  ctx.fillRect(-70, -16, 140, 32);
  ctx.strokeStyle = "rgba(184,137,44,0.35)";
  ctx.setLineDash([4, 5]);
  ctx.strokeRect(-70, -16, 140, 32);
  ctx.setLineDash([]);
  ctx.restore();
  // 标题与日期
  ctx.fillStyle = colors.ink;
  ctx.font = `44px ${zh}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("学习笔记", left + 34, top + 84);
  ctx.font = `22px ${en}`;
  ctx.fillStyle = "rgba(30,58,138,0.6)";
  ctx.fillText("2026-10-22", left + pw - 150, top + 80);
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  scribble(left + 34, top + 102, 176, 3);
  // 线索栏
  const cueX = left + 120;
  ctx.strokeStyle = colors.cue;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cueX, top + 128);
  ctx.lineTo(cueX, top + 400);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(left + 20, top + 400);
  ctx.lineTo(left + pw - 20, top + 400);
  ctx.stroke();
  const rows = [
    { cue: "核心", text: "文字 → 手写笔记", mark: true },
    { cue: "方法", text: "康奈尔结构整理" },
    { cue: "要点", text: "字体、纸张、贴纸" },
    { cue: "", text: "一键导出高清图片" },
  ];
  rows.forEach((row, i) => {
    const y = top + 176 + i * 58;
    if (row.cue) {
      ctx.font = `26px ${zh}`;
      ctx.fillStyle = colors.ink;
      ctx.fillText(row.cue, left + 34, y);
    }
    ctx.font = `28px ${zh}`;
    if (row.mark) {
      const w = ctx.measureText(row.text).width;
      ctx.fillStyle = "rgba(247,213,92,0.85)";
      ctx.beginPath();
      ctx.roundRect(cueX + 18, y - 26, w + 16, 34, 8);
      ctx.fill();
    }
    ctx.fillStyle = colors.ink;
    ctx.fillText(row.text, cueX + 26, y);
  });
  // 总结
  ctx.font = `26px ${zh}`;
  ctx.fillStyle = colors.ink;
  ctx.fillText("总结：一页纸，记住重点。", left + 34, top + 446);
  ctx.strokeStyle = "rgba(30,58,138,0.55)";
  ctx.lineWidth = 2;
  scribble(left + 34, top + 470, 240, 2.5);
  // 星星涂鸦
  ctx.save();
  ctx.translate(left + pw - 62, top + 452);
  ctx.rotate(0.2);
  ctx.strokeStyle = "#c2410c";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 11 : 26;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // 左侧：标志与文字
  const img = new Image();
  img.src = logo;
  await img.decode();
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.drawImage(img, 84, 110, 120, 120);
  ctx.restore();
  ctx.fillStyle = colors.paper;
  ctx.font = `108px ${zh}`;
  ctx.fillText("墨语笔记", 80, 360);
  ctx.fillStyle = colors.gold;
  ctx.font = `bold 52px ${en}`;
  ctx.fillText("InkScribe", 86, 430);
  ctx.fillStyle = "rgba(253,251,247,0.86)";
  ctx.font = `32px ${zh}`;
  ctx.fillText("粘贴文字，AI 整理成一页手写笔记", 84, 500);
  ctx.fillStyle = "rgba(253,251,247,0.55)";
  ctx.font = `26px ${en}`;
  ctx.fillText(host, 86, 566);
  return canvas.toDataURL("image/jpeg", 0.9);
}

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ink-brand-"));
try {
  const htmlFile = path.join(tmpDir, "brand.html");
  fs.writeFileSync(htmlFile, `<!doctype html><meta charset="utf-8">${fontCss.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}`);
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlFile).href);

  const full = logoSvg();
  const small = logoSvg({ detail: "small" });
  const raster = async (svg, size) => {
    const data = await page.evaluate(rasterize, [svgUri(svg), size]);
    return Buffer.from(data.split(",")[1], "base64");
  };

  const files = {
    "logo.svg": full,
    "favicon.svg": small,
    "favicon.ico": buildIco([
      { size: 16, data: await raster(small, 16) },
      { size: 32, data: await raster(small, 32) },
      { size: 48, data: await raster(full, 48) },
    ]),
    "apple-touch-icon.png": await raster(logoSvg({ shape: "square" }), 180),
    "icon-192.png": await raster(full, 192),
    "icon-512.png": await raster(full, 512),
    "icon-maskable-512.png": await raster(logoSvg({ shape: "maskable" }), 512),
  };
  const og = await page.evaluate(drawOgImage, { logo: svgUri(full), colors: COLORS, host: SITE_HOST });
  files["og-image.jpg"] = Buffer.from(og.split(",")[1], "base64");

  for (const [name, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT, name), data);
    console.log(`public/${name}  ${(Buffer.byteLength(data) / 1024).toFixed(1)} KB`);
  }
} finally {
  await browser.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
