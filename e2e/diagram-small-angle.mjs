/** Local-only browser regression for the small-angle force display. */
/** Parse the full SVG shaft (even with hand-drawn jitter), excluding arrowhead subpaths. */
export function parseArrowShaftPath(d) {
  if (typeof d !== "string") return null;
  const shaft = d.split(" M")[0];
  const matches = [...shaft.matchAll(/([ML])(-?(?:\d+(?:\.\d+)?|\.\d+)) (-?(?:\d+(?:\.\d+)?|\.\d+))/g)];
  if (matches.length < 2 || matches[0][1] !== "M" ||
    matches.slice(1).some((match) => match[1] !== "L") ||
    matches.map((match) => match[0]).join(" ") !== shaft) return null;
  return [Number(matches[0][2]), Number(matches[0][3]),
    Number(matches.at(-1)[2]), Number(matches.at(-1)[3])];
}

export async function verifyDiagramSmallAngles({ newPage, check, url, outputDir }) {
  for (const [width, locale] of [[390, "zh-CN"], [1280, "en-US"]]) {
    const zh = locale === "zh-CN";
    const { page, context } = await newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, locale });
    try {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.locator('.note-page[data-render-status="ready"]').waitFor({ timeout: 30000 });
      await page.getByRole("tab", { name: zh ? "内容" : "Content", exact: true }).click();
      const quick = page.locator("#diagram-quick-insert");
      await quick.locator(".diagram-quick-trigger").click();
      await quick.getByRole("button", { name: zh ? "插入斜面受力" : "Insert Inclined plane" }).click();
      await quick.getByRole("button", { name: zh ? "编辑参数" : "Edit parameters" }).click();
      const inspector = page.locator(".section-editor").first();
      const range = inspector.locator('.diagram-range input[type="range"]').first();
      const frictionInput = inspector.locator('.diagram-parameters .diagram-check input[type="checkbox"]');
      const figure = page.locator('.note-page .diagram-block[data-diagram-after-section="0"]');
      for (const theta of [5, 15, 30, 60]) {
        for (const friction of [false, true]) {
          await range.fill(String(theta));
          await frictionInput.setChecked(friction);
          const rendered = await figure.evaluate((root) => {
            const svg = root.querySelector("svg.diagram-art");
            const arrowPaths = [...svg.querySelectorAll('.diagram-ink > g[data-diagram-primitive="arrow"] > path')];
            const block = svg.querySelector('.diagram-ink > path[data-diagram-primitive="rect"]');
            const labels = [...svg.querySelectorAll(".diagram-label")];
            const rects = labels.map((node) => node.getBoundingClientRect());
            const view = svg.getBoundingClientRect();
            const arrowRect = arrowPaths[1]?.getBoundingClientRect();
            const blockRect = block?.getBoundingClientRect();
            const note = root.querySelector(".diagram-scale-note");
            const noteRect = note?.getBoundingClientRect();
            const paper = root.closest(".note-page")?.getBoundingClientRect();
            return {
              arrowPaths: arrowPaths.map((path) => path.getAttribute("d")),
              arrowCount: arrowPaths.length, label: labels.some((v) => v.textContent === "mg sinθ"),
              separate: !!blockRect && !!arrowRect && arrowRect.right + 2 < blockRect.left,
              clipped: rects.some((r) => r.left < view.left - 2 || r.right > view.right + 2 ||
                r.top < view.top - 2 || r.bottom > view.bottom + 2),
              overlap: rects.some((a, i) => rects.slice(i + 1).some((b) =>
                a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)),
              note: note?.textContent ?? "", noteVisible: !!noteRect && !!paper &&
                noteRect.width > 0 && noteRect.left >= paper.left - 2 && noteRect.right <= paper.right + 2,
            };
          });
          // Read the actual painted shaft endpoints, not just the first jitter segment.
          const arrows = rendered?.arrowPaths.map(parseArrowShaftPath) ?? [];
          const validArrows = arrows.length === (friction ? 5 : 4) && arrows.every((coords) => coords !== null);
          const vector = ([x1, y1, x2, y2]) => [x2 - x1, y2 - y1];
          const p = validArrows ? vector(arrows[1]) : null;
          const q = validArrows ? vector(arrows[2]) : null;
          const n = validArrows ? vector(arrows[3]) : null;
          const parallelLength = p ? Math.hypot(...p) : 0;
          const balanced = validArrows ? Math.hypot(n[0] + q[0], n[1] + q[1]) : Infinity;
          const short = theta < 24;
          const expected = 160 * Math.sin(theta * Math.PI / 180);
          const ok = !!rendered && validArrows && rendered.label && !rendered.clipped && !rendered.overlap &&
            rendered.arrowCount === (friction ? 5 : 4) && balanced < 0.002 &&
            p[0] < 0 && p[1] > 0 &&
            (short ? parallelLength >= 64 && rendered.separate && rendered.noteVisible &&
              rendered.note === (zh ? "短分力箭头长度为示意，不按比例。" : "Short force arrow not to scale.")
              : Math.abs(parallelLength - expected) < 0.002 && !rendered.note);
          check(`DQA-${width}-${theta}-${Number(friction)}`, "Rendered force readability and N balance", ok,
            JSON.stringify(rendered && { ...rendered, arrowPaths: undefined, p, parallelLength, balanced, validArrows }));
          await figure.screenshot({ path: `${outputDir}/diagram-angle-${width}-${theta}-${Number(friction)}.png` });
        }
      }
      await range.fill("5");
      await frictionInput.uncheck();
      await inspector.locator(".diagram-shape-mode").click();
      await inspector.getByRole("button", { name: zh ? "继续精细编辑" : "Continue to fine edit" }).click();
      await inspector.locator(".diagram-shape-target").nth(3).focus();
      await inspector.locator(".diagram-shape-target").nth(3).press("ArrowRight");
      check(`DQA-${width}-conversion`, "Materialized force note remains visible",
        (await figure.locator(".diagram-scale-note").innerText()).includes(zh ? "不按比例" : "not to scale"));
      await page.screenshot({ path: `${outputDir}/diagram-angle-converted-${width}.png`, fullPage: true });
      check(`DQA-${width}-console`, "No browser errors", page.errors.length === 0, page.errors.join("; "));
    } finally { await context.close(); }
  }
}
