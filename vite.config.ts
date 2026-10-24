import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * Fontsource 的 CSS 同时声明 woff2 与 woff 两种格式。所有目标浏览器都支持 woff2，
 * 去掉 woff 回退可以让构建产物中的字体文件数量减半，加快 Workers 静态资源上传。
 */
function stripWoffFallback(): Plugin {
  return {
    name: "ink-scribe:strip-woff-fallback",
    enforce: "pre",
    transform(code, id) {
      if (!/@fontsource[\\/].+\.css(\?.*)?$/.test(id)) return null;
      return {
        code: code.replace(/,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g, ""),
        map: null,
      };
    },
  };
}

/**
 * pdf.js 解析中文等 CID 字体的 PDF 时需要 Adobe CMap 文件。开发时直接提供，
 * 构建时输出到前端静态资源的 pdfjs/cmaps/ 下（同源，按需加载）。
 */
function pdfjsCmaps(): Plugin {
  const dir = resolve("node_modules/pdfjs-dist/cmaps");
  return {
    name: "ink-scribe:pdfjs-cmaps",
    configureServer(server) {
      server.middlewares.use("/pdfjs/cmaps/", (req, res, next) => {
        let name: string;
        try {
          name = basename(decodeURIComponent((req.url ?? "").split("?")[0]));
        } catch {
          return next();
        }
        // 空文件名会指向 CMap 目录本身，读取目录会抛出 EISDIR
        if (!name || name === "." || name === "..") return next();
        const file = join(dir, name);
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", "application/octet-stream");
        createReadStream(file)
          .on("error", (error) => (res.headersSent ? res.destroy(error) : next(error)))
          .pipe(res);
      });
    },
    generateBundle() {
      if (this.environment.name !== "client") return;
      for (const name of readdirSync(dir)) {
        this.emitFile({ type: "asset", fileName: `pdfjs/cmaps/${name}`, source: readFileSync(join(dir, name)) });
      }
    },
  };
}

/**
 * PWA：把 src/sw.ts 打包为站点根目录的 /sw.js，并注入本次构建的版本号与预缓存清单。
 * 预缓存只包含应用外壳（首页、脚本、样式与公共图标）；字体分片、PDF 解析器与 CMap 在用到时缓存，
 * 避免首次安装就下载十几 MB 字体。版本号由清单与外壳内容计算，任何一项改变都会让浏览器安装新版本。
 */
function serviceWorker(): Plugin {
  const swFile = "sw.js";
  const placeholder = "__PWA_MANIFEST__";
  const publicFiles = ["site.webmanifest", "theme-init.js", "favicon.ico", "favicon.svg", "logo.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];
  return {
    name: "ink-scribe:service-worker",
    apply: "build",
    buildStart() {
      if (this.environment.name !== "client") return;
      this.emitFile({ type: "chunk", id: resolve("src/sw.ts"), fileName: swFile });
    },
    generateBundle(_, bundle) {
      if (this.environment.name !== "client") return;
      const sw = bundle[swFile];
      if (sw?.type !== "chunk" || sw.imports.length > 0 || !sw.code.includes(placeholder)) {
        this.error(`${swFile} 必须是不依赖其他分片、包含 ${placeholder} 的独立脚本`);
      }
      const files = Object.values(bundle)
        .filter((file) => file.fileName !== swFile && (file.type === "chunk" || file.fileName.endsWith(".css")))
        .map((file) => `/${file.fileName}`)
        .sort();
      const hash = createHash("sha256").update(sw.code).update(files.join("\n"));
      const html = bundle["index.html"];
      if (html?.type === "asset") hash.update(html.source);
      for (const name of publicFiles) hash.update(readFileSync(resolve("public", name)));
      const manifest = { version: hash.digest("hex").slice(0, 12), precache: ["/", ...publicFiles.map((name) => `/${name}`), ...files] };
      sw.code = sw.code.replaceAll(placeholder, JSON.stringify(manifest));
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // `vite --mode mock`：不连接 Cloudflare 远程绑定，Worker 使用本地启发式整理器与示例插图（AI_MOCK），
  // 便于在没有 Cloudflare 账号或离线时开发和测试界面。切勿用该模式构建生产产物。
  const mockAi = mode === "mock";
  // 本地开发与 mock 构建中的分享链接应指向本机，而不是线上域名
  const localLinks = command === "serve" || mockAi;
  return {
    plugins: [
      stripWoffFallback(),
      pdfjsCmaps(),
      serviceWorker(),
      react(),
      cloudflare({
        ...(mockAi ? { remoteBindings: false } : {}),
        config: (config) => ({
          vars: {
            ...config.vars,
            ...(localLinks ? { PUBLIC_BASE_URL: "" } : {}),
            ...(mockAi ? { AI_MOCK: "true", DOODLE_API_ENABLED: "true" } : {}),
          },
        }),
      }),
    ],
    build: {
      // 中文手写字体按 unicode-range 切片，单个分片通常小于 100KB，无需内联
      assetsInlineLimit: 0,
    },
  };
});
