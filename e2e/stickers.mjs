// 装饰贴纸按分类排列：先选分类，点预览添加，再在“颜色与款式”中换色。

/** 添加一张装饰贴纸；variant 为空时使用这类贴纸记住的款式。 */
export async function addDecorSticker(page, category, name, variant) {
  await page.getByRole("radio", { name: category, exact: true }).click();
  await page.getByRole("button", { name: `添加贴纸：${name}`, exact: true }).click();
  if (variant) await page.getByRole("radio", { name: variant, exact: true }).click();
}
