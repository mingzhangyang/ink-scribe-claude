// 原文输入位于弹窗（窄屏为底部抽屉）中：填写、选择示例或生成之前先打开，操作画布与侧栏之前先关闭。

/** 打开原文弹窗；正在播放关闭动画时等它关闭后再重新打开。 */
export async function openInput(page) {
  const sheet = page.locator(".input-sheet");
  const open = await sheet.evaluate((dialog) => dialog.open && !dialog.hasAttribute("data-closing"));
  if (!open) await page.locator(".input-trigger").click();
  await sheet.waitFor({ state: "visible" });
}

/** 用关闭按钮收起原文弹窗，并等待关闭动画结束。 */
export async function closeInput(page) {
  await page.locator(".input-sheet .sheet-close").click();
  await page.locator(".input-sheet").waitFor({ state: "hidden" });
}

/** 打开弹窗填写原文后关闭。 */
export async function fillSource(page, text) {
  await openInput(page);
  await page.locator(".source-text").fill(text);
  await closeInput(page);
}
