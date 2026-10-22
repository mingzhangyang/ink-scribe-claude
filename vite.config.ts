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

export default defineConfig({
  plugins: [stripWoffFallback(), react(), cloudflare()],
  build: {
    // 中文手写字体按 unicode-range 切片，单个分片通常小于 100KB，无需内联
    assetsInlineLimit: 0,
  },
});
