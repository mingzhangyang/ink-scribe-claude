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
      // Diagram tools stay exclusively in the Content editor, never on the canvas.
      check("D2-" + viewport + "-clean-canvas", "No insertion action in canvas",
        await page.locator(".diagram-workspace-add").count() === 0);
      await page.getByRole("tab", { name: cn ? "内容" : "Content", exact: true }).click();
      const quick = page.locator("#diagram-quick-insert");
      await quick.waitFor();
      check("D2-" + viewport + "-entry", "Compact Content-tab entry is collapsed by default",
        await quick.locator(".diagram-quick-trigger").isVisible()
        && await quick.locator(".diagram-template-choice").count() === 0);
      await quick.locator(".diagram-quick-trigger").click();
      check("D2-" + viewport + "-open", "Diagram picker appears only after explicit action",
        await quick.locator(".diagram-template-choice").count() === 4);
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
      // Restrict the control and value assertion to template parameters; the
      // inspector also has an independent hand-drawn jitter slider.
      const angle = first.locator(".diagram-parameters .diagram-range");
      const range = angle.getByRole("slider", { name: cn ? "倾角 θ" : "Slope angle θ", exact: true });
      await range.focus();
      await range.press("End");
      check("D2-" + viewport + "-angle", "Inclined-plane angle updates the editor",
        await angle.locator("strong").innerText() === "60°");
      const caption = first.locator(".diagram-caption input");
      await caption.fill(cn ? "斜面力分解" : "Slope vectors");
      check("D2-" + viewport + "-caption-draft", "Typing a caption stays local until blur",
        await page.locator(".note-page .diagram-block figcaption").count() === 0);
      await caption.blur();
      check("D2-" + viewport + "-caption", "Caption propagates to live note SVG",
        (await page.locator(".note-page .diagram-block figcaption").allInnerTexts())
          .includes(cn ? "斜面力分解" : "Slope vectors"));
      const d2History = first.locator(".diagram-edit-toolbar");
      const undo = d2History.getByRole("button", { name: cn ? "撤销" : "Undo", exact: true });
      const redo = d2History.getByRole("button", { name: cn ? "重做" : "Redo", exact: true });
      await undo.click();
      check("D2-" + viewport + "-caption-undo", "D2 toolbar undoes a completed caption edit",
        await page.locator(".note-page .diagram-block figcaption").count() === 0);
      await redo.click();
      check("D2-" + viewport + "-caption-redo", "D2 toolbar redoes the caption edit",
        await page.locator(".note-page .diagram-block figcaption").count() === 1);
      await undo.click(); // caption
      await undo.click(); // slider angle (one gesture)
      check("D2-" + viewport + "-angle-undo", "D2 toolbar restores the previous angle",
        await angle.locator("strong").innerText() === "30°");
      await redo.click();
      await redo.click();
      check("D2-" + viewport + "-angle-redo", "D2 toolbar restores angle and caption",
        await angle.locator("strong").innerText() === "60°"
        && await page.locator(".note-page .diagram-block figcaption").count() === 1);
      await caption.fill("Escape me");
      await caption.press("Escape");
      check("D2-" + viewport + "-caption-escape", "Escape cancels uncommitted caption text",
        await page.locator(".note-page .diagram-block figcaption").innerText()
          === (cn ? "斜面力分解" : "Slope vectors"));

      const second = page.locator(".section-editor").nth(1);
      // Quick entry allows selecting the exact section instead of always
      // attaching the new drawing after section 1.
      await quick.locator(".diagram-quick-trigger").click();
      await quick.locator("select").selectOption("1");
      await quick.getByRole("button", { name: cn ? "插入数轴" : "Insert Number line" }).click();
      check("D2-" + viewport + "-position", "Quick picker anchors to the chosen section",
        await page.locator('.note-page .diagram-block[data-diagram-after-section="1"]').count() === 1);
      await second.locator(".diagram-expand").click();
      const fullTrigger = await quick.locator(".diagram-quick-trigger").innerText();
      check("D2-" + viewport + "-manage-trigger", "At 2/2, the trigger says Manage diagrams",
        fullTrigger.includes(cn ? "管理示意图" : "Manage diagrams")
        && fullTrigger.includes("(2/2)"), fullTrigger);
      await quick.locator(".diagram-quick-trigger").click();
      check("D2-" + viewport + "-limit", "Two diagrams switch the compact entry to management",
        await page.locator(".note-page .diagram-block").count() === 2
        && await page.locator(".diagram-add").count() === 0
        && await quick.locator(".diagram-template-choice").count() === 0
        && await quick.locator(".diagram-quick-existing").count() === 2);
      await quick.locator(".diagram-quick-trigger").click();
      const number = second.locator('.diagram-number').last().locator("input");
      const numberStart = second.locator(".diagram-number").first().locator("input");
      const numberEnd = second.locator(".diagram-number").nth(1).locator("input");
      const noteDiagram = page.locator('.note-page .diagram-block[data-diagram-after-section="1"]');
      const beforeDraftSvg = await noteDiagram.locator("svg").innerHTML();
      await number.fill("0");
      await number.blur();
      check("D2-" + viewport + "-reject", "Zero step remains an invalid draft",
        await number.getAttribute("aria-invalid") === "true");
      check("D2-" + viewport + "-stale", "Unapplied params visibly mark the actual canvas",
        await second.locator(".diagram-preview-stale").isVisible()
        && await noteDiagram.getAttribute("data-diagram-unapplied") === "true"
        && await noteDiagram.locator(".diagram-unapplied-badge").isVisible()
        && await noteDiagram.locator("svg").innerHTML() === beforeDraftSvg);
      await page.getByRole("tab", { name: cn ? "导出" : "Export", exact: true }).click();
      check("D2-" + viewport + "-block-export", "Download, clipboard and sharing are blocked",
        await page.locator("#tabpanel-export").getByRole("button", { name: cn ? "下载图片" : "Download image" }).isDisabled()
        && await page.locator("#tabpanel-export").getByRole("button", { name: cn ? "复制到剪贴板" : "Copy to clipboard" }).isDisabled()
        && await page.locator(".share-fab").isDisabled()
        && await noteDiagram.getAttribute("data-diagram-unapplied") === "true");
      await page.getByRole("tab", { name: cn ? "内容" : "Content", exact: true }).click();
      check("D2-" + viewport + "-resume-draft", "Returning from Export reopens the pending inspector",
        await second.locator(".diagram-expand").getAttribute("aria-expanded") === "true"
        && await numberStart.isVisible()
        && await second.locator(".diagram-preview-stale").isVisible());
      await numberStart.fill("0");
      await numberEnd.fill("5");
      await number.fill("10");
      check("D2-" + viewport + "-sparse-draft", "Invalid intermediate combos are not committed",
        await second.locator(".diagram-number-form button[type=submit]").isEnabled()
        && await noteDiagram.getAttribute("data-diagram-unapplied") === "true"
        && await noteDiagram.locator("svg").innerHTML() === beforeDraftSvg);
      await second.getByRole("button", { name: cn ? "应用参数" : "Apply parameters" }).click();
      check("D2-" + viewport + "-sparse-applied", "0→5, step 10 applies atomically",
        await numberStart.inputValue() === "0"
        && await numberEnd.inputValue() === "5"
        && await number.inputValue() === "10"
        && await noteDiagram.getAttribute("data-diagram-unapplied") === null
        && (await noteDiagram.locator("svg").textContent()).includes("5"));
      await numberStart.fill("0.0");
      check("D2-" + viewport + "-equivalent-draft", "Equivalent text creates a visible pending draft",
        await noteDiagram.getAttribute("data-diagram-unapplied") === "true");
      await second.getByRole("button", { name: cn ? "应用参数" : "Apply parameters" }).click();
      check("D2-" + viewport + "-equivalent-applied", "Equivalent Apply clears the export blocker",
        await numberStart.inputValue() === "0"
        && await noteDiagram.getAttribute("data-diagram-unapplied") === null
        && await second.locator(".diagram-preview-stale").count() === 0);
      await numberStart.fill("-4");
      await numberStart.press("Enter");
      check("D2-" + viewport + "-enter", "Enter applies the complete valid draft",
        await numberStart.inputValue() === "-4"
        && await noteDiagram.getAttribute("data-diagram-unapplied") === null);
      const beforeCancelSvg = await noteDiagram.locator("svg").textContent();
      await numberStart.fill("-3");
      await numberStart.press("Escape");
      await page.waitForTimeout(50);
      const afterCancelSvg = await noteDiagram.locator("svg").textContent();
      check("D2-" + viewport + "-escape", "Escape discards pending edits without changing saved geometry",
        await numberStart.inputValue() === "-4" && afterCancelSvg === beforeCancelSvg
        && await noteDiagram.getAttribute("data-diagram-unapplied") === null);

      await first.locator(".diagram-remove").click();
      await first.locator(".diagram-remove").click();
      check("D2-" + viewport + "-remove", "Removing a diagram frees another slot",
        await page.locator(".note-page .diagram-block").count() === 1);
      await quick.locator(".diagram-quick-trigger").click();
      await quick.locator("select").selectOption("0");
      await quick.getByRole("button", { name: cn ? "插入直角三角形" : "Insert Right triangle" }).click();
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
