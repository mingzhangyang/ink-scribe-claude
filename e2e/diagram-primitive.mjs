import fs from "node:fs";

const diagrams = [
  { afterSection: 1, template: "inclined-plane", params: { thetaDeg: 30, friction: false }, caption: "斜面受力" },
  { afterSection: 4, template: "coordinate-plane", params: { grid: true, quadrants: "all" }, caption: "平面坐标" },
];

const longNote = (withDiagrams = true) => ({
  title: "图文长笔记：力学与坐标系统",
  date: "2026-11-17",
  cues: Array.from({ length: 8 }, (_, i) => ({ keyword: "关键点" + (i + 1), note: "记住概念与推导的对应关系" })),
  sections: Array.from({ length: 6 }, (_, i) => ({
    heading: "第 " + (i + 1) + " 节",
    content: ("先理解基本概念，再结合图示推导定律与含义。").repeat(29),
    highlights: [],
  })),
  summary: "图示与正文应一同参与排版和导出，不能裁切。",
  ...(withDiagrams ? { diagrams } : {}),
});

async function publish(page, url, note, layout, auth) {
  const res = await page.request.post(url + "api/v1/notes", {
    headers: auth,
    data: { schemaVersion: 1, note, appearance: {
      layout, pageSize: "a4", overflow: "expand", doodleMode: "none", seed: 93,
    } },
  });
  const result = await res.json();
  if (res.status() !== 201) throw Error("D3 publication: " + res.status() + " " + JSON.stringify(result));
  return result.url;
}

async function download({ newPage, noteUrl, destination }) {
  const { page, context } = await newPage({ locale: "zh-CN" });
  try {
    await page.goto(noteUrl, { waitUntil: "networkidle" });
    await page.locator('.note-page[data-render-status="ready"]').waitFor({ timeout: 30000 });
    const started = performance.now();
    const pending = page.waitForEvent("download", { timeout: 90000 });
    await page.getByRole("button", { name: "下载图片", exact: true }).click();
    const file = await pending;
    await file.saveAs(destination);
    return { elapsedMs: Math.round(performance.now() - started), bytes: fs.statSync(destination).size,
      errors: page.errors.slice() };
  } finally {
    await context.close();
  }
}

export async function verifyDiagramD3({ newPage, check, url, outputDir }) {
  // Interactive editing: template remains parameterized until the first actual geometry command.
  for (const [width, locale] of [[390, "zh-CN"], [1280, "en-US"]]) {
    const zh = locale === "zh-CN";
    const { page, context } = await newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, locale });
    try {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.locator('.note-page[data-render-status="ready"]').waitFor({ timeout: 30000 });
      await page.getByRole("tab", { name: zh ? "内容" : "Content", exact: true }).click();
      const first = page.locator(".section-editor").first();
      const quick = page.locator("#diagram-quick-insert");
      await quick.locator(".diagram-quick-trigger").click();
      await quick.getByRole("button", { name: zh ? "插入直角三角形" : "Insert Right triangle" }).click();
      await quick.getByRole("button", { name: zh ? "编辑参数" : "Edit parameters" }).click();
      await first.locator(".diagram-shape-mode").click();
      // A template cannot turn into freehand primitives without an explicit warning.
      const confirm = first.getByRole("button", { name: zh ? "继续精细编辑" : "Continue to fine edit" });
      check("D3-" + width + "-detach-warning", "Template conversion is confirmed explicitly",
        await confirm.isVisible());
      await confirm.click();
      const stage = first.locator(".diagram-primitive-stage");
      await stage.waitFor();
      const target = first.locator(".diagram-shape-target").first();
      const before = await page.locator(".note-page .diagram-art").first().innerHTML();
      await target.focus();
      await target.press("ArrowRight");
      const changed = await page.locator(".note-page .diagram-art").first().innerHTML();
      check("D3-" + width + "-nudge", "Keyboard move edits the actual note after first materialization", before !== changed);
      await first.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true }).click();
      const reverted = await page.locator(".note-page .diagram-art").first().innerHTML();
      check("D3-" + width + "-undo", "Undo restores the original template geometry", reverted === before);
      await first.getByRole("button", { name: zh ? "重做" : "Redo", exact: true }).click();
      check("D3-" + width + "-redo", "Redo reapplies the geometric change",
        (await page.locator(".note-page .diagram-art").first().innerHTML()) === changed);

      const hot = await target.boundingBox();
      if (!hot) throw Error("D3 shape target has no bounding box");
      await page.mouse.move(hot.x + hot.width / 2, hot.y + hot.height / 2);
      await page.mouse.down();
      await page.mouse.move(hot.x + hot.width / 2 + 32, hot.y + hot.height / 2, { steps: 6 });
      await page.mouse.up();
      check("D3-" + width + "-drag", "Pointer drag commits a bounded primitive modification",
        (await page.locator(".note-page .diagram-art").first().innerHTML()) !== changed);

      await first.locator(".diagram-shape-palette").getByRole("button", { name: zh ? "文字" : "Text" }).click();
      check("D3-" + width + "-insert", "Custom label is added without changing the diagram count",
        await page.locator(".note-page .diagram-block").count() === 1
        && await first.locator(".diagram-shape-target").count() > 5);
      const label = first.locator(".diagram-shape-label input");
      await label.fill(zh ? "自定义标注" : "New annotation");
      check("D3-" + width + "-label-live", "Annotation changes are visible before blur",
        (await stage.locator(".diagram-art").textContent() ?? "")
          .includes(zh ? "自定义标注" : "New annotation"));
      await label.blur();
      check("D3-" + width + "-label", "The edited label is present in the public renderer DOM",
        (await page.locator(".note-page .diagram-art").first().textContent() ?? "")
          .includes(zh ? "自定义标注" : "New annotation"));
      // Pointer selection prevents native blur: the pending text must commit
      // before the old input unmounts, without swallowing the gesture.
      const pendingText = zh ? "切换形状后保留" : "Kept after pointer selection";
      await label.fill(pendingText);
      await stage.locator(".diagram-shape-target").first().click({ force: true });
      const publicArt = page.locator(".note-page .diagram-art").first();
      check("D3-" + width + "-label-pointer", "Pointer-selecting another shape saves the pending label",
        (await publicArt.textContent() ?? "").includes(pendingText));
      await first.getByRole("button", { name: zh ? "撤销" : "Undo", exact: true }).click();
      check("D3-" + width + "-label-pointer-undo", "Pointer-triggered label save is one undo step",
        !(await publicArt.textContent() ?? "").includes(pendingText));
      await first.getByRole("button", { name: zh ? "重做" : "Redo", exact: true }).click();
      check("D3-" + width + "-label-pointer-redo", "Redo restores the pointer-triggered label save",
        (await publicArt.textContent() ?? "").includes(pendingText));
      await first.locator(".diagram-shape-palette").getByRole("button", { name: zh ? "箭头" : "Arrow" }).click();
      check("D3-" + width + "-arrow", "Add arrow geometry", await first.locator(".diagram-shape-target").count() > 6);
      await first.locator(".diagram-shape-palette").getByRole("button", { name: zh ? "角弧" : "Angle arc" }).click();
      // The omitted 285-degree remainder of the default arc must not intercept a tap.
      const arcHit = stage.locator("[data-arc-hit-target]").last();
      const arcTarget = first.locator(".diagram-shape-target").last();
      const targetBeforeTap = await arcTarget.getAttribute("aria-label");
      const hitGeometry = await arcHit.evaluate((node) => {
        const svg = node.ownerSVGElement;
        const rect = svg.getBoundingClientRect();
        const box = svg.viewBox.baseVal;
        const at = (angle) => {
          const radians = angle * Math.PI / 180;
          return [
            rect.left + (500 + 160 * Math.cos(radians) - box.x) * rect.width / box.width,
            rect.top + (375 + 160 * Math.sin(radians) - box.y) * rect.height / box.height,
          ];
        };
        const hit = (point) => document.elementsFromPoint(...point).includes(node);
        return { visible: hit(at(-45)), omitted: hit(at(90)), omittedPoint: at(90) };
      });
      check("D3-" + width + "-arc-hit", "Only visible arc strokes are touch-selectable",
        hitGeometry.visible && !hitGeometry.omitted, JSON.stringify(hitGeometry));
      // A real tap on the invisible region must not select the arc.
      await first.locator(".diagram-shape-target").first().focus();
      await page.mouse.click(...hitGeometry.omittedPoint);
      check("D3-" + width + "-arc-omitted-tap", "A tap on the omitted arc does not select it",
        !(await arcTarget.getAttribute("class") ?? "").includes("is-selected"),
        targetBeforeTap);
      // Live text framing must expand before blur, not after the committed
      // diagram changes. Nudge a newly added label toward the right boundary.
      await first.locator(".diagram-shape-palette").getByRole("button", { name: zh ? "文字" : "Text" }).click();
      const edgeTarget = stage.locator(".diagram-shape-target").last();
      await edgeTarget.focus();
      for (let n = 0; n < 16; n++) await edgeTarget.press("ArrowRight");
      const frameBefore = await stage.locator(".diagram-art").getAttribute("viewBox");
      const edgeInput = first.locator(".diagram-shape-label input");
      const longText = "W".repeat(40);
      await edgeInput.fill(longText);
      const frameDuring = await stage.locator(".diagram-art").getAttribute("viewBox");
      const overlayDuring = await stage.locator(".diagram-interaction-overlay").getAttribute("viewBox");
      const labelFrame = await stage.locator(".diagram-ink .diagram-label").last().evaluate((node) => {
        const view = node.ownerSVGElement.viewBox.baseVal;
        const bounds = node.getBBox();
        return {
          inside: bounds.x >= view.x - 2 && bounds.x + bounds.width <= view.x + view.width + 2
            && bounds.y >= view.y - 2 && bounds.y + bounds.height <= view.y + view.height + 2,
          bounds: [bounds.x, bounds.y, bounds.width, bounds.height],
        };
      });
      // A viewport already large enough to contain the new text need not change.
      // Require actual glyph visibility and exact overlay alignment regardless.
      check("D3-" + width + "-label-live-frame", "Long edge label and hit overlay stay aligned before blur",
        frameDuring === overlayDuring && labelFrame.inside
          && (await stage.locator(".diagram-art").textContent() ?? "").includes(longText),
        JSON.stringify({ frameBefore, frameDuring, overlayDuring, labelFrame }));
      await edgeInput.press("Escape");
      check("D3-" + width + "-label-frame-cancel", "Escape restores the original frame and annotation",
        (await stage.locator(".diagram-art").getAttribute("viewBox")) === frameBefore
          && !(await publicArt.textContent() ?? "").includes(longText));
      await page.screenshot({ path: outputDir + "/diagram-d3-" + width + ".png", fullPage: true });
      check("D3-" + width + "-errors", "Diagram editing produces no console/page errors",
        page.errors.length === 0, page.errors.slice(0, 2).join("; "));
    } finally {
      await context.close();
    }
  }

  // Worst-case read-only layouts. These fixtures exercise both dense cues and long body content.
  const auth = { Authorization: "Bearer " + (process.env.E2E_CONTRACT_API_KEY ?? process.env.E2E_API_KEY) };
  const { page, context } = await newPage({ locale: "zh-CN" });
  const exported = [];
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    for (const layout of ["minimal", "classic-cornell", "free-journal"]) {
      const noteUrl = await publish(page, url, longNote(), layout, auth);
      await page.goto(noteUrl, { waitUntil: "networkidle" });
      await page.locator('.note-page[data-render-status="ready"]').waitFor({ timeout: 30000 });
      const geometry = await page.locator(".note-page").evaluate((node) => {
        const pageRect = node.getBoundingClientRect();
        const blocks = Array.from(node.querySelectorAll(".diagram-block"));
        const text = node.querySelector(".hand-line");
        const bodyFont = text ? parseFloat(getComputedStyle(text).fontSize) : 0;
        const fonts = Array.from(node.querySelectorAll(".diagram-label")).map((label) => {
          const svg = label.closest("svg");
          const scale = svg ? svg.getBoundingClientRect().width / svg.viewBox.baseVal.width : 0;
          return parseFloat(getComputedStyle(label).fontSize) * scale;
        });
        return {
          render: node.getAttribute("data-render-status"),
          blocks: blocks.length,
          insidePaper: blocks.every((block) => {
            const rect = block.getBoundingClientRect();
            return rect.left >= pageRect.left - 2 && rect.right <= pageRect.right + 2
              && rect.top >= pageRect.top - 2 && rect.bottom <= pageRect.bottom + 2;
          }),
          captions: blocks.map((block) => block.querySelector("figcaption")?.textContent),
          minFontRatio: fonts.length && bodyFont ? Math.min(...fonts) / bodyFont : 0,
        };
      });
      check("D3-long-" + layout, "6 long sections + 8 cues + 2 diagrams fit " + layout,
        geometry.render === "ready" && geometry.blocks === 2 && geometry.insidePaper
        && geometry.captions.every(Boolean), JSON.stringify(geometry));
      check("D3-font-" + layout, "Diagram labels remain >=0.9x body font", geometry.minFontRatio >= 0.9,
        String(geometry.minFontRatio));
      if (layout === "free-journal") {
        const journal = await page.locator(".note-page.layout-free-journal").evaluate((node) => {
          const container = node.querySelector(".journal-cards");
          const width = container?.getBoundingClientRect().width ?? 0;
          const cards = Array.from(node.querySelectorAll(".journal-card:has(.diagram-block)"));
          return {
            isLong: node.classList.contains("is-long"),
            grid: container ? getComputedStyle(container).display : null,
            cards: cards.map((card) => ({
              span: getComputedStyle(card).gridColumn,
              width: card.getBoundingClientRect().width,
            })),
            width,
          };
        });
        check("D3-long-journal-fullwidth", "Long Free Journal spans both grid columns for every diagram",
          journal.isLong && journal.grid === "grid" && journal.cards.length === 2
            && journal.cards.every((card) => card.span === "1 / -1" && card.width > journal.width * 0.8),
          JSON.stringify(journal));
      }
      const result = await download({ newPage, noteUrl, destination: outputDir + "/diagram-d3-long-" + layout + ".png" });
      exported.push({ layout, ...result });
      check("D3-png-" + layout, "Long-note PNG export succeeds", result.bytes > 10000 && result.errors.length === 0, JSON.stringify(result));
    }

    // Compare same-page PNG export with 0 and 2 diagrams; cache fonts across the browser context.
    const short = longNote(false);
    short.sections = short.sections.slice(0, 2);
    const withTwo = { ...short, diagrams: [
      { ...diagrams[0], afterSection: 0 }, { ...diagrams[1], afterSection: 1 },
    ] };
    const blankUrl = await publish(page, url, short, "minimal", auth);
    const fullUrl = await publish(page, url, withTwo, "minimal", auth);
    const blank = await download({ newPage, noteUrl: blankUrl, destination: outputDir + "/diagram-d3-perf-0.png" });
    const full = await download({ newPage, noteUrl: fullUrl, destination: outputDir + "/diagram-d3-perf-2.png" });
    const ratio = blank.elapsedMs ? full.elapsedMs / blank.elapsedMs : Infinity;
    exported.push({ performance: { blank, full, ratio } });
    check("D3-png-performance", "Two-diagram PNG export is <=1.5x zero-diagram baseline",
      ratio <= 1.5 && full.errors.length === 0, "ratio=" + ratio.toFixed(3));
  } finally {
    fs.writeFileSync(outputDir + "/diagram-d3-export-metrics.json", JSON.stringify(exported, null, 2));
    await context.close();
  }
}
