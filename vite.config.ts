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

export default defineConfig(({ mode }) => {
  // `vite --mode mock`：不连接 Cloudflare 远程绑定，Worker 使用本地启发式整理器与示例插图（AI_MOCK），
  // 便于在没有 Cloudflare 账号或离线时开发和测试界面。切勿用该模式构建生产产物。
  const mockAi = mode === "mock";
  return {
    plugins: [
      stripWoffFallback(),
      react(),
      cloudflare(
        mockAi
          ? {
              remoteBindings: false,
              config: (config) => ({ vars: { ...config.vars, AI_MOCK: "true", DOODLE_API_ENABLED: "true" } }),
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
