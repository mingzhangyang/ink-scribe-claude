// 装饰贴纸按分类排列：先选分类，点预览添加，再在“颜色与款式”中换色。
// “最近使用”一行里有同名的按钮，所以只在分类网格中查找。

/** 当前显示的分类网格（或搜索结果）中的贴纸按钮。 */
export function paletteTile(page, name) {
  return page.locator(".sticker-palette").getByRole("button", { name: `添加贴纸：${name}`, exact: true });
}

/** 添加一张装饰贴纸；variant 为空时使用这类贴纸记住的款式。 */
export async function addDecorSticker(page, category, name, variant) {
  await page.getByRole("radio", { name: category, exact: true }).click();
  await paletteTile(page, name).click();
  if (variant) await page.getByRole("radio", { name: variant, exact: true }).click();
}
