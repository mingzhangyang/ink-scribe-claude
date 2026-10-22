import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
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
        const file = join(dir, basename(decodeURIComponent((req.url ?? "").split("?")[0])));
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", "application/octet-stream");
        createReadStream(file).pipe(res);
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

export default defineConfig(({ mode }) => {
  // `vite --mode mock`：不连接 Cloudflare 远程绑定，Worker 使用本地启发式整理器与示例插图（AI_MOCK），
  // 便于在没有 Cloudflare 账号或离线时开发和测试界面。切勿用该模式构建生产产物。
  const mockAi = mode === "mock";
  return {
    plugins: [
      stripWoffFallback(),
      pdfjsCmaps(),
      react(),
      cloudflare(
        mockAi
          ? {
              remoteBindings: false,
              config: (config) => ({
                vars: { ...config.vars, AI_MOCK: "true", DOODLE_API_ENABLED: "true", THUMBNAILS_ENABLED: "false" },
              }),
            }
          : {},
      ),
    ],
    build: {
      // 中文手写字体按 unicode-range 切片，单个分片通常小于 100KB，无需内联
      assetsInlineLimit: 0,
    },
  };
});
