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
      // The primary entry lives above the canvas, before the lower editor panel.
      const shortcut = page.locator(".diagram-workspace-add");
      check("D2-" + viewport + "-entry", "Visible diagram entry exists on note canvas",
        await shortcut.count() === 1 && await shortcut.isVisible());
      await shortcut.click();
      const quick = page.locator("#diagram-quick-insert");
      await quick.waitFor();
      check("D2-" + viewport + "-navigate", "Canvas shortcut opens the content quick picker",
        await page.getByRole("tab", { name: cn ? "内容" : "Content", exact: true })
          .getAttribute("aria-selected") === "true"
        && await quick.locator(".diagram-template-choice").count() === 4);
      const first = page.locator(".section-editor").first();
      check("D2-" + viewport + "-four", "Four template choices available",
        await quick.locator(".diagram-template-choice").count() === 4);
      const start = performance.now();
      await quick.getByRole("button", { name: cn ? "插入斜面受力" : "Insert Inclined plane" }).click();
      check("D2-" + viewport + "-added", "Quick insert confirms success",
        await quick.getByRole("status").count() === 1);
      await quick.getByRole("button", { name: cn ? "编辑参数" : "Edit parameters" }).click();
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
      // Quick entry allows selecting the exact section instead of always
      // attaching the new drawing after section 1.
      await quick.locator("select").selectOption("1");
      await quick.getByRole("button", { name: cn ? "插入数轴" : "Insert Number line" }).click();
      check("D2-" + viewport + "-position", "Quick picker anchors to the chosen section",
        await page.locator('.note-page .diagram-block[data-diagram-after-section="1"]').count() === 1);
      await second.locator(".diagram-expand").click();
      check("D2-" + viewport + "-limit", "Two-diagram cap enforced in both placement surfaces",
        await page.locator(".note-page .diagram-block").count() === 2
        && await page.locator(".diagram-add").count() === 0
        && await quick.locator(".diagram-template-choice").count() === 0
        && (await shortcut.textContent() ?? "").includes(cn ? "管理示意图" : "Manage diagrams"));
      const number = second.locator('.diagram-number').last().locator("input");
      await number.fill("0");
      await number.blur();
      check("D2-" + viewport + "-reject", "Invalid tick interval stays out of model",
        await number.getAttribute("aria-invalid") === "true");
      const numberStart = second.locator(".diagram-number").first().locator("input");
      await numberStart.fill("-4");
      await numberStart.press("Enter");
      check("D2-" + viewport + "-enter", "Enter commits a valid number-line start",
        await numberStart.inputValue() === "-4");
      const beforeCancelSvg = await page.locator('.note-page .diagram-block[data-diagram-after-section="1"] svg').textContent();
      await numberStart.fill("-3");
      await numberStart.press("Escape");
      await page.waitForTimeout(50);
      const afterCancelSvg = await page.locator('.note-page .diagram-block[data-diagram-after-section="1"] svg').textContent();
      check("D2-" + viewport + "-escape", "Escape cancels input and blur without saving the draft",
        await numberStart.inputValue() === "-4" && afterCancelSvg === beforeCancelSvg);

      await first.locator(".diagram-remove").click();
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
      const sectionCount = await page.locator(".section-editor").count();
      const attachedSection = page.locator(".section-editor").nth(1);
      const removeAttached = attachedSection.getByRole("button",
        { name: cn ? "删除段落 2" : "Remove section 2" });
      await removeAttached.click();
      check("D2-" + viewport + "-section-protect", "Section deletion warns before discarding attached diagrams",
        await page.locator(".note-page .diagram-block").count() === 2
        && await attachedSection.locator(".section-remove-confirmation").isVisible());
      await attachedSection.locator(".section-remove-confirmation").getByRole("button",
        { name: cn ? "取消" : "Cancel" }).click();
      check("D2-" + viewport + "-section-cancel", "Cancel keeps the section and diagram intact",
        await page.locator(".section-editor").count() === sectionCount
        && await page.locator(".note-page .diagram-block").count() === 2
        && await attachedSection.locator(".section-remove-confirmation").count() === 0);
      await removeAttached.click();
      await attachedSection.locator(".section-remove-confirmation").getByRole("button",
        { name: cn ? "确认删除段落 2 及示意图" : "Confirm delete section 2 and diagrams" }).click();
      check("D2-" + viewport + "-section-confirm", "Confirmed removal deletes only that section and its diagram",
        await page.locator(".section-editor").count() === sectionCount - 1
        && await page.locator(".note-page .diagram-block").count() === 1
        && await page.locator('.note-page .diagram-block[data-diagram-after-section="0"]').count() === 1);
      if (sectionCount > 2) {
        const plainSection = page.locator(".section-editor").last();
        await plainSection.getByRole("button",
          { name: cn ? "删除段落 " + (sectionCount - 1) : "Remove section " + (sectionCount - 1) }).click();
        check("D2-" + viewport + "-section-plain", "Section without diagrams still removes directly",
          await page.locator(".section-editor").count() === sectionCount - 2
          && await page.locator(".section-remove-confirmation").count() === 0);
      }
      check("D2-" + viewport + "-errors", "No browser errors during D2 interactions", page.errors.length === 0,
        page.errors.slice(0, 2).join("; "));
    } finally {
      await context.close();
    }
  }
}
