/**
 * 手写字体（均为 SIL Open Font License）。只引入 @font-face 声明：
 * 中文字体按 unicode-range 切分为约 100 个分片，浏览器只下载页面实际用到的分片。
 * 字体文件随静态资源一起由 Worker 同源提供，导出时不存在跨域问题。
 *
 * 默认中文字体与所有英文字体的声明随首屏加载；其余中文字体的声明（每个约 100KB）
 * 在用户选择后才按需加载。
 */
import "lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css";
import "@fontsource/kalam/400.css";
import "@fontsource/caveat/400.css";
import "@fontsource/patrick-hand/400.css";
import "@fontsource/indie-flower/400.css";

const LAZY_FONT_CSS: Record<string, () => Promise<unknown>> = {
  "Long Cang": () => import("@fontsource/long-cang/400.css"),
  "Ma Shan Zheng": () => import("@fontsource/ma-shan-zheng/400.css"),
  "ZCOOL KuaiLe": () => import("@fontsource/zcool-kuaile/400.css"),
  "Zhi Mang Xing": () => import("@fontsource/zhi-mang-xing/400.css"),
};

const pending = new Map<string, Promise<void>>();

export function loadFontCss(family: string): Promise<void> {
  const loader = LAZY_FONT_CSS[family];
  if (!loader) return Promise.resolve();
  let promise = pending.get(family);
  if (!promise) {
    promise = loader().then(() => undefined);
    pending.set(family, promise);
    promise.catch(() => pending.delete(family));
  }
  return promise;
}
