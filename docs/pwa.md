# 安装与离线（PWA）

墨语笔记是一个可安装的 Progressive Web App：支持的浏览器（Chrome、Edge、Android 浏览器，iOS / iPadOS Safari 的“添加到主屏幕”）可以把它安装到桌面或主屏幕，以独立窗口打开，离线时也能继续编辑本机的笔记。

## 组成

| 文件 | 作用 |
| --- | --- |
| `public/site.webmanifest` | 名称、图标、`display: standalone`、`id`、主题色，以及“笔记库”“图库”快捷方式 |
| `src/sw.ts` | Service Worker 源码，构建为站点根目录的 `/sw.js`（作用域 `/`） |
| `src/pwa/routing.ts` | Service Worker 的请求分类、缓存键与可缓存判断，单元测试见 `tests/pwa.test.ts` |
| `src/pwa/cleanup.ts` | 版本更新后旧缓存的保留与清理，单元测试见 `tests/pwa.test.ts` |
| `src/pwa/register.ts` | 注册 Service Worker、保存浏览器的安装提示（菜单中的“安装应用”）、新版本就绪时提示刷新 |
| `vite.config.ts` 中的 `serviceWorker()` | 打包 `src/sw.ts`，注入本次构建的版本号与预缓存清单 |

开发服务器（`npm run dev`）不注册 Service Worker，以免缓存 Vite 的模块与热更新；`npm run preview` 与线上环境会注册。

## 缓存策略

| 请求 | 策略 | 缓存 |
| --- | --- | --- |
| 页面导航（`/`、`/library`、`/n/:id` 等） | 网络优先；离线时返回缓存的首页外壳，由前端路由渲染对应页面 | 版本缓存 |
| 构建产物 `/assets/*.js`、`*.css` 等，以及 manifest、图标、`theme-init.js` | 缓存优先 | 版本缓存（`ink-scribe-app-<版本>`） |
| 字体分片 `/assets/*.woff2`、PDF CMap `/pdfjs/cmaps/*` | 缓存优先，首次使用时缓存；字体重试参数 `ink-font-retry` 不计入缓存键 | 长期缓存（`ink-scribe-static-v1`），跨版本保留 |
| `/api/*`、`/llms.txt`、`/robots.txt`、`/sitemap.xml`、非 GET 与跨域请求 | 不经过 Service Worker | — |

安装时只预缓存应用外壳：首页 HTML、公共图标与 manifest、全部 JS 与 CSS。中文手写字体按 unicode-range 切成数百个分片，总量约 16 MB，因此不预缓存，而是在页面实际用到时缓存；PDF 解析器（约 1.3 MB）也在第一次导入 PDF 时缓存。只缓存同源、状态 200、非 HTML 的响应，静态资源未命中时的 SPA 回退页不会被当作脚本或字体缓存。

## 离线时可以做什么

- 打开编辑器和笔记库，继续编辑本机草稿与笔记库中的笔记（都保存在 IndexedDB）；
- 用“本地快速排版”整理新文字，调整样式、贴纸并导出图片（已缓存的字体正常显示，未缓存的字体分片回退为系统字体）；
- AI 整理、AI 插图、图库与发布需要联网，离线时会显示与网络错误相同的提示。

## 版本更新

版本号由预缓存清单、`index.html`、公共文件与 Service Worker 本身的内容计算，任何一项改变都会产生新的 `/sw.js`。`public/_headers` 让 `/sw.js` 与 manifest 使用 `Cache-Control: no-cache`，注册时也设置了 `updateViaCache: "none"`，浏览器在每次导航和页面回到前台时都会检查更新。

新版本安装完成后不会立即接管正在编辑的页面，而是在页面底部提示“新版本已就绪”。点击“刷新”后新版本接管所有标签页并重新加载当前页面；选择“稍后”则在所有标签页关闭后的下一次打开时生效。首次安装会直接接管当前页面，无需刷新即可离线使用。

其他标签页被新版本接管后仍运行旧版本的脚本，可能还要按需加载旧版本的分片。因此新版本启用时会记下这些页面和此刻被替换的缓存，在这些页面全部关闭之前保留旧版本缓存（构建产物文件名带内容哈希，可以从任何版本的缓存中取用），之后在下一次打开或刷新页面时删除。只删除启用时记下的缓存：之后才下载、正在等待启用的新版本缓存不受影响。

`sw.js` 必须是不依赖其他分片的独立脚本（构建插件会检查），所以应用代码不能导入 `src/pwa/` 下供 Service Worker 使用的模块，否则打包器会把它们拆成共享分片。

## 测试

- `tests/pwa.test.ts`：请求分类、可缓存判断与 manifest 字段；
- `e2e/acceptance.mjs` 的 PWA 用例：Service Worker 接管首页并预缓存外壳，断网后重新加载仍能打开编辑器与笔记库。其余 e2e 用例默认屏蔽 Service Worker，因为受控页面的请求由 Service Worker 发出，`page.route` 无法拦截。
