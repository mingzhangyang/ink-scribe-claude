// 端到端验收测试入口：以 mock 模式构建并在本地 workerd 中预览生产产物，再运行浏览器验收脚本。
// mock 构建不调用 Workers AI，也不需要 Cloudflare 账号；它会覆盖 dist/，部署前请重新执行 npm run build。
import { spawn, spawnSync } from "node:child_process";

const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}/`;
// 下载的文件名包含中文，需要 UTF-8 locale，否则浏览器会改名为 "download"
const env = { ...process.env, LANG: process.env.LANG || "C.UTF-8", E2E_BASE_URL: BASE_URL };

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // 服务尚未就绪
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`预览服务在 ${timeoutMs / 1000} 秒内未就绪：${url}`);
}

if (!process.argv.includes("--skip-build")) run("npx", ["vite", "build", "--mode", "mock"]);

const preview = spawn("npx", ["vite", "preview", "--mode", "mock", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
  env,
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});

let code = 1;
try {
  await waitForServer(BASE_URL, 60_000);
  const result = spawnSync("node", ["e2e/acceptance.mjs"], { stdio: "inherit", env });
  code = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  try {
    process.kill(-preview.pid, "SIGTERM");
  } catch {
    // 进程已退出
  }
}
process.exit(code);
