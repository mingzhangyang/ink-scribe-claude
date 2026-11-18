/** Local-only browser regression for the small-angle force display. */
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
            const paths = [...svg.querySelectorAll(".diagram-ink > g > path")];
            const parse = (path) => {
              const values = path?.getAttribute("d")?.match(/^M(-?[\\d.]+) (-?[\\d.]+) L(-?[\\d.]+) (-?[\\d.]+)/);
              return values ? values.slice(1).map(Number) : null;
            };
            const arrows = paths.slice(0, 4).map(parse);
            if (arrows.some((v) => !v)) return null;
            const [gravity, parallel, perpendicular, normal] = arrows;
            const vector = (v) => [v[2] - v[0], v[3] - v[1]];
            const length = (v) => Math.hypot(...v);
            const p = vector(parallel), n = vector(normal), q = vector(perpendicular);
            const block = svg.querySelector(".diagram-ink > path:nth-of-type(2)");
            const labels = [...svg.querySelectorAll(".diagram-label")];
            const rects = labels.map((node) => node.getBoundingClientRect());
            const view = svg.getBoundingClientRect();
            const arrowRect = paths[1].getBoundingClientRect();
            const blockRect = block?.getBoundingClientRect();
            const note = root.querySelector(".diagram-scale-note");
            const noteRect = note?.getBoundingClientRect();
            const paper = root.closest(".note-page")?.getBoundingClientRect();
            return {
              parallelLength: length(p), p, balanced: length([n[0] + q[0], n[1] + q[1]]),
              arrowCount: paths.length, label: labels.some((v) => v.textContent === "mg sinθ"),
              separate: !!blockRect && arrowRect.right + 2 < blockRect.left,
              clipped: rects.some((r) => r.left < view.left - 2 || r.right > view.right + 2 ||
                r.top < view.top - 2 || r.bottom > view.bottom + 2),
              overlap: rects.some((a, i) => rects.slice(i + 1).some((b) =>
                a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)),
              note: note?.textContent ?? "", noteVisible: !!noteRect && !!paper &&
                noteRect.width > 0 && noteRect.left >= paper.left - 2 && noteRect.right <= paper.right + 2,
            };
          });
          const short = theta < 24;
          const expected = 160 * Math.sin(theta * Math.PI / 180);
          const ok = !!rendered && rendered.label && !rendered.clipped && !rendered.overlap &&
            rendered.arrowCount === (friction ? 5 : 4) && rendered.balanced < 0.002 &&
            rendered.p[0] < 0 && rendered.p[1] > 0 &&
            (short ? rendered.parallelLength >= 64 && rendered.separate && rendered.noteVisible &&
              rendered.note === (zh ? "短分力箭头长度为示意，不按比例。" : "Short force arrow not to scale.")
              : Math.abs(rendered.parallelLength - expected) < 0.002 && !rendered.note);
          check(`DQA-${width}-${theta}-${Number(friction)}`, "Rendered force readability and N balance", ok,
            JSON.stringify(rendered));
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
