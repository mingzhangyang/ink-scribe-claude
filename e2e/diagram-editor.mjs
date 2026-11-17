/**
 * D2 browser acceptance: actual content-tab insertion, editable parameters, per-note limit,
 * section anchoring and identical live-NotePage render. Standalone from CI: invoked by
 * the existing local-only e2e/acceptance.mjs runner.
 */
export async function verifyDiagramEditor({ newPage, check, url, outputDir }) {
  for (const [viewport, locale] of [[390, "zh-CN"], [1280, "en-US"]]) {
    const cn = locale === "zh-CN";
    const { page, context } = await newPage({ viewport: { width: viewport, height: 900 }, locale });
    try {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.locator('.note-page[data-render-status="ready"]').waitFor({ timeout: 30000 });
      await page.getByRole("tab", { name: cn ? "内容" : "Content", exact: true }).click();

      const first = page.locator(".section-editor").first();
      await first.locator(".diagram-add").click();
      check("D2-" + viewport + "-four", "Four template choices available",
        await first.locator(".diagram-template-choice").count() === 4);
      const start = performance.now();
      await first.getByRole("button", { name: cn ? "插入斜面受力" : "Insert Inclined plane" }).click();
      await page.locator('.note-page .diagram-block[data-diagram-after-section="0"]').waitFor();
      check("D2-" + viewport + "-quick", "Template insertion reaches NotePage in under 10 seconds",
        performance.now() - start < 10000);
      check("D2-" + viewport + "-inline", "New diagram renders inline with original section",
        await page.locator('.note-page .note-section').first().locator(".diagram-block").count() === 1);
      const range = first.locator('.diagram-range input[type="range"]');
      await range.focus();
      await range.press("End");
      check("D2-" + viewport + "-angle", "Inclined-plane angle updates the editor",
        await first.locator(".diagram-range strong").innerText() === "60°");
      const caption = first.locator(".diagram-caption input");
      await caption.fill(cn ? "斜面力分解" : "Slope vectors");
      await caption.blur();
      check("D2-" + viewport + "-caption", "Caption propagates to live note SVG",
        (await page.locator(".note-page .diagram-block figcaption").allInnerTexts())
          .includes(cn ? "斜面力分解" : "Slope vectors"));

      const second = page.locator(".section-editor").nth(1);
      await second.locator(".diagram-add").click();
      await second.getByRole("button", { name: cn ? "插入数轴" : "Insert Number line" }).click();
      check("D2-" + viewport + "-limit", "Two-diagram cap enforced in every section",
        await page.locator(".note-page .diagram-block").count() === 2
        && await page.locator(".diagram-add").count() === 0);
      const number = second.locator('.diagram-number').last().locator("input");
      await number.fill("0");
      await number.blur();
      check("D2-" + viewport + "-reject", "Invalid tick interval stays out of model",
        await number.getAttribute("aria-invalid") === "true");

      await first.locator(".diagram-remove").click();
      check("D2-" + viewport + "-remove", "Removing a diagram frees another slot",
        await page.locator(".note-page .diagram-block").count() === 1
        && await first.locator(".diagram-add").count() === 1);
      await first.locator(".diagram-add").click();
      await first.getByRole("button", { name: cn ? "插入直角三角形" : "Insert Right triangle" }).click();
      check("D2-" + viewport + "-reinsert", "Slot accepts another template",
        await page.locator(".note-page .diagram-block").count() === 2);

      await first.getByRole("button", { name: cn ? "下移段落" : "Move section down" }).click();
      check("D2-" + viewport + "-anchor", "Diagram follows its section when sections move",
        await page.locator('.note-page .diagram-block[data-diagram-after-section="1"]').count() === 1
        && await page.locator('.note-page .diagram-block[data-diagram-after-section="0"]').count() === 1);
      await page.screenshot({ path: outputDir + "/diagram-d2-" + viewport + ".png", fullPage: true });
      check("D2-" + viewport + "-errors", "No browser errors during D2 interactions", page.errors.length === 0,
        page.errors.slice(0, 2).join("; "));
    } finally {
      await context.close();
    }
  }
}
