import fs from "node:fs";

// 导出图片在 SVG 中重新排版，部分浏览器（iOS Safari）在那里量出的文字比页面内宽一丝。
// 无头 Chromium 没有这个偏差，mock 构建提供 window.__inkExportTextDrift 来模拟：
//   { px }                       每个字符多出 px，可用 letter-spacing 抵消；
//   { px, ignoreCompensation }   抵消不掉，导出只能按重新排版后的结果校验。

const READY = '.note-page[data-render-status="ready"]';
const paragraph = (seed, length) => `${seed}：` + "导出时的每一行都必须和预览保持一致，不能被裁掉。".repeat(40).slice(0, length);

// 页眉里是恰好容纳文字的盒子（标题、日期、关键词），正文接近折行与页面高度的边界。
const NOTE = {
  title: "导出排版一致性：把预览原样变成图片",
  date: "验收测试 · 导出",
  cues: [
    { keyword: "文字偏差", note: "导出环境里文字可能宽出一丝" },
    { keyword: "抵消", note: "用字距把偏差补回来" },
    { keyword: "校验", note: "补不回来就按实际排版检查溢出" },
  ],
  sections: Array.from({ length: 4 }, (_, i) => ({ heading: `第 ${i + 1} 段`, content: paragraph(`正文${i + 1}`, 330), highlights: ["不能被裁掉"] })),
  summary: paragraph("总结", 120),
};
// A4 上缩到最小字号才刚好放下：重排后多出几行就会溢出。
const FULL_PAGE_NOTE = { ...NOTE, sections: NOTE.sections.map((section, i) => ({ ...section, content: paragraph(`正文${i + 1}`, 400) })) };

async function publish(page, url, auth, appearance, note = NOTE) {
  const response = await page.request.post(`${url}api/v1/notes`, {
    headers: auth,
    data: { schemaVersion: 1, note, appearance: { doodleMode: "none", seed: 11, ...appearance } },
  });
  const publication = await response.json();
  if (response.status() !== 201) throw new Error(`Export drift publication failed: ${JSON.stringify(publication)}`);
  return publication;
}

/** 导出一次：返回 PNG 文件路径；导出被拒绝（提示失败）时返回 null。 */
async function exportImage({ newPage, noteUrl, drift, file }) {
  const { page, context } = await newPage({}, drift ? `window.__inkExportTextDrift = ${JSON.stringify(drift)};` : undefined);
  try {
    await page.goto(noteUrl, { waitUntil: "networkidle" });
    await page.locator(READY).waitFor({ timeout: 30_000 });
    const download = page.waitForEvent("download", { timeout: 60_000 }).catch(() => null);
    const failed = page.locator(".toast").filter({ hasText: "导出失败" }).waitFor({ timeout: 60_000 }).then(() => "failed", () => null);
    await page.getByRole("button", { name: "下载图片", exact: true }).click();
    const outcome = await Promise.race([download, failed]);
    if (!outcome || outcome === "failed") return { file: null, errors: page.errors };
    await outcome.saveAs(file);
    return { file, errors: page.errors };
  } finally {
    await context.close();
  }
}

/** 在浏览器里解码两张 PNG，统计明显不同的像素比例，以及底边留白里的墨迹。 */
async function compare(page, fileA, fileB) {
  const encode = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  return page.evaluate(async ([a, b]) => {
    const load = async (source) => {
      const bitmap = await createImageBitmap(await (await fetch(source)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
    };
    const [first, second] = [await load(a), await load(b)];
    // 页面底部留白 44px（2 倍图为 88 像素）：正文被裁切时，文字会贴到图片底边。
    const bottomInk = (image) => {
      let ink = 0;
      for (let i = (image.height - 24) * image.width * 4; i < image.data.length; i += 4) if (image.data[i] + image.data[i + 1] + image.data[i + 2] < 330) ink++;
      return ink;
    };
    const result = { first: [first.width, first.height], second: [second.width, second.height], bottomInk: [bottomInk(first), bottomInk(second)], different: null };
    if (first.width !== second.width || first.height !== second.height) return result;
    let different = 0;
    for (let i = 0; i < first.data.length; i += 4) if (Math.abs(first.data[i + 1] - second.data[i + 1]) > 96) different++;
    result.different = different / (first.width * first.height);
    return result;
  }, [encode(fileA), encode(fileB)]);
}

export async function verifyExportDrift({ newPage, check, url, outputDir, auth }) {
  const { page, context } = await newPage();
  const ids = [];
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // 1. 可抵消的偏差：导出应与没有偏差时一致（页眉不折行、正文不重排）。
    for (const layout of ["minimal", "hybrid-cornell"]) {
      const publication = await publish(page, url, auth, { layout, pageSize: "a4", overflow: "error" });
      ids.push(publication.id);
      const baseline = await exportImage({ newPage, noteUrl: publication.url, file: `${outputDir}/drift-${layout}-baseline.png` });
      const drifted = await exportImage({ newPage, noteUrl: publication.url, drift: { px: 0.1 }, file: `${outputDir}/drift-${layout}-compensated.png` });
      const result = baseline.file && drifted.file ? await compare(page, baseline.file, drifted.file) : null;
      check(
        `XD-compensate-${layout}`,
        `${layout} 导出环境文字偏宽时，抵消后的图片与预览排版一致`,
        result !== null && result.different !== null && result.different < 0.004 && result.bottomInk[1] === 0 && drifted.errors.length === 0,
        JSON.stringify(result),
      );
    }

    // 2. 抵消不掉的偏差、固定页面：重新排版后放不下，必须拒绝导出而不是静默裁掉正文。
    {
      const publication = await publish(page, url, auth, { layout: "hybrid-cornell", pageSize: "a4", overflow: "error" }, FULL_PAGE_NOTE);
      ids.push(publication.id);
      const baseline = await exportImage({ newPage, noteUrl: publication.url, file: `${outputDir}/drift-fixed-baseline.png` });
      const drifted = await exportImage({ newPage, noteUrl: publication.url, drift: { px: 0.3, ignoreCompensation: true }, file: `${outputDir}/drift-fixed-uncorrectable.png` });
      check("XD-fixed-overflow", "固定页面重排后放不下时拒绝导出，不静默裁切", baseline.file !== null && drifted.file === null);
    }

    // 3. 抵消不掉的偏差、长图：画布高度按重新排版后的页面计算，结尾完整。
    {
      const publication = await publish(page, url, auth, { layout: "hybrid-cornell", pageSize: "long", overflow: "expand" });
      ids.push(publication.id);
      const baseline = await exportImage({ newPage, noteUrl: publication.url, file: `${outputDir}/drift-long-baseline.png` });
      const drifted = await exportImage({ newPage, noteUrl: publication.url, drift: { px: 0.3, ignoreCompensation: true }, file: `${outputDir}/drift-long-uncorrectable.png` });
      const result = baseline.file && drifted.file ? await compare(page, baseline.file, drifted.file) : null;
      check(
        "XD-long-height",
        "长图按重排后的高度出图，结尾不被裁掉",
        result !== null && result.second[1] > result.first[1] && result.bottomInk[1] === 0,
        JSON.stringify(result),
      );
    }
  } finally {
    const statuses = [];
    for (const id of ids) statuses.push((await page.request.delete(`${url}api/v1/notes/${id}`, { headers: auth })).status());
    check("XD-cleanup", "导出偏差测试笔记成功删除", statuses.every((status) => status === 204), statuses.join(", "));
    await context.close();
  }
}
