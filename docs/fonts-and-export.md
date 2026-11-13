# 字体、导出与浏览器兼容

## 手写字体

| 字体 | 用途 | 授权 | 覆盖 | 来源 |
| --- | --- | --- | --- | --- |
| 霞鹜文楷 GB 屏幕阅读版（LXGW WenKai GB Screen） | 默认中文，工整清晰 | SIL OFL 1.1 | 简体中文常用字 + 拉丁 | `lxgw-wenkai-screen-webfont` |
| 龙藏体（Long Cang） | 随性手写 | SIL OFL 1.1 | 简体中文 + 拉丁 | `@fontsource/long-cang` |
| 马善政楷书（Ma Shan Zheng） | 毛笔楷书 | SIL OFL 1.1 | 简体中文 + 拉丁 | `@fontsource/ma-shan-zheng` |
| 站酷快乐体（ZCOOL KuaiLe） | 活泼圆润 | SIL OFL 1.1 | 简体中文 + 拉丁 | `@fontsource/zcool-kuaile` |
| 志莽行书（Zhi Mang Xing） | 行书 | SIL OFL 1.1 | 简体中文 + 拉丁 | `@fontsource/zhi-mang-xing` |
| Kalam（默认）/ Caveat / Patrick Hand / Indie Flower | 英文手写 | SIL OFL 1.1 | 拉丁 | `@fontsource/*` |

OFL 允许随应用分发与嵌入（包括嵌入导出的图片），但不允许单独出售字体文件。

### 加载策略

- 中文字体按 Google Fonts 的方式切分为约 100 个 `unicode-range` 分片（每片约 30–90KB，只保留 woff2），浏览器只下载页面实际用到的字形分片。实测示例笔记首屏共下载 14 个字体文件、约 650KB。
- 默认中文字体与全部英文字体的 `@font-face` 声明随首屏 CSS 加载（约 120KB，gzip 后约 41KB）；其余 4 款中文字体的声明各约 90KB，在用户选择时才动态加载。
- 字体文件随静态资源由 Worker 同源提供（带哈希、长期缓存），不依赖 Google Fonts 等第三方 CDN，在国内网络和导出时都不会遇到跨域问题。
- 字体栈为 `英文手写字体, 中文手写字体, Kaiti SC, STKaiti, KaiTi, cursive`：拉丁字符使用英文字体，中日韩字符回退到中文字体；字体加载失败时回退到系统楷体。
- 笔记区域统一 `font-weight: 400` 并关闭合成粗体（手写字体合成粗体效果很差），层级通过字号与颜色区分。

## 图片导出

导出使用 [modern-screenshot](https://github.com/qq15725/modern-screenshot)，预览和导出共用同一个 DOM 节点（内部坐标系宽 840px，预览时由外层容器缩放），因此贴纸位置、旋转、缩放与手写抖动完全一致。流程：

1. 动态加载所选字体的 `@font-face` 声明，并用 `document.fonts.load()` 等待笔记文字所需的分片加载完成；
2. 遍历同源样式表，找出所用字体中 `unicode-range` 与笔记文字有交集的分片，转成 data URL 生成内嵌 CSS（结果缓存，重复导出不再下载）；
3. 过滤掉编辑态元素（贴纸选框、手柄），按 1x/2x/3x 渲染为 PNG 或 JPG（JPG 质量 0.92，背景色为纸张底色）。

modern-screenshot 会把每个元素的计算样式（含布局后的像素宽高）写成内联样式。导出前会标记尺寸本为 `auto` 的盒子并在克隆时去掉这些固定宽高，让导出按与预览相同的规则重新排版；否则导出环境里文字只要比预览宽出一丝（iOS Safari），恰好容纳文字的标题、日期、关键词就会多折一行并与后面的内容重叠。按字号适配成一行的标题会带上 `data-single-line`（`white-space: nowrap`），同样不会在导出时折行。

放开尺寸后，导出排版完全取决于导出环境里的文字宽度，而 SVG 图片内部的几何信息脚本读不到，溢出检查只能在页面内做。为此导出前先用同一条导出路径渲染几行“探针”（`src/export/textDrift.ts`）：每行几百个字符后跟一个色块，从画布像素读出色块位置，得到导出环境里每个字符比页面内宽多少。

- 没有偏差（桌面 Chromium、WebKit 实测）：不做任何调整，多一次约 0.1 秒的小图渲染。
- 有偏差：按字号用 `letter-spacing` 抵消，使导出与已通过溢出检查的预览排版一致，再渲染一次探针确认。
- 抵消后仍有残差：把残差加到页面内的导出快照上，模拟出导出的实际排版，重新做溢出检查（固定页面放不下则拒绝导出，而不是静默裁掉正文），并按该排版的高度出长图。

色块在导出图里会对齐到整像素，探针行的总偏移小于 0.75px（约每字符 0.004px）时视为没有偏差。mock 构建可用 `window.__inkExportTextDrift = { px, ignoreCompensation? }` 模拟偏差，验收测试 `e2e/export-drift.mjs` 以此覆盖三条路径。

在无头 Chromium 中实测：A4 页面 2x PNG（1680×2376）导出约 1.2–1.8 秒。

**画布尺寸限制**：Safari 的单张画布面积上限约 1670 万像素，长图在高倍率下可能超出。导出时会自动把倍率降到安全范围，并在界面中提示实际倍率。

## 剪贴板

“复制到剪贴板”使用 `navigator.clipboard.write([new ClipboardItem({ "image/png": Promise<Blob> })])`：

- 需要 HTTPS 安全上下文（`localhost` 除外）；
- `ClipboardItem` 在点击事件中同步创建、图片以 Promise 形式提供，以满足 Safari 对用户手势的要求；
- 只复制 PNG（浏览器普遍不支持 JPG 写入剪贴板）；
- 不支持时按钮置灰并说明原因，下载功能始终可用；写入被拒绝时提示改用下载。

已在无头 Chromium 中验证复制与读取；Safari 与 Firefox 需在上线前人工验证（见部署检查清单）。

## 已验证与待验证事项

| 事项 | 状态 |
| --- | --- |
| Vite 构建产物与 Workers Static Assets 兼容（SPA 回退、`_headers`、`run_worker_first`） | 已在本地 workerd（`vite preview`）中验证 |
| CSP 下导出 PNG/JPG、复制到剪贴板 | 已在无头 Chromium 中验证 |
| 中文字体授权、按需加载与导出内嵌 | 已验证（授权见上表） |
| 移动端布局（390px 宽）无横向滚动 | 已验证 |
| Safari / Firefox 的剪贴板与导出表现 | 待人工验证 |
| Workers AI 模型目录、定价、限额与模型质量 | 待在目标账户中运行 `npm run eval:models` |
