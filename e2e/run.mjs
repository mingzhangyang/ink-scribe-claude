// 端到端验收测试入口：以 mock 模式构建并在本地 workerd 中预览生产产物，再运行浏览器验收脚本。
// mock 构建不调用 Workers AI，也不需要 Cloudflare 账号；它会覆盖 dist/，部署前请重新执行 npm run build。
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}/`;
// 各场景使用独立的测试密钥，保留真实的每密钥限流阈值，避免验收互相消耗额度。
// 所有密钥只写入本地 D1 的哈希，不使用生产密钥。
const API_KEYS = Object.fromEntries(["main", "contract", "dense"].map((name) => [name, `isk_e2e_${randomBytes(16).toString("hex")}`]));
// 下载的文件名包含中文，需要 UTF-8 locale，否则浏览器会改名为 "download"
const env = {
  ...process.env,
  LANG: process.env.LANG || "C.UTF-8",
  E2E_BASE_URL: BASE_URL,
  E2E_API_KEY: API_KEYS.main,
  E2E_CONTRACT_API_KEY: API_KEYS.contract,
  E2E_DENSE_API_KEY: API_KEYS.dense,
};

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
run("npx", ["wrangler", "d1", "migrations", "apply", "ink-scribe", "--local"]);
const keyRows = Object.entries(API_KEYS).map(([name, value]) => {
  const hash = createHash("sha256").update(value).digest("hex");
  return `('key_e2e_${name}', 'e2e ${name}', '${hash}', ${Date.now()})`;
});
run("npx", [
  "wrangler", "d1", "execute", "ink-scribe", "--local", "--command",
  `INSERT OR REPLACE INTO api_keys (id, name, key_hash, created_at) VALUES ${keyRows.join(", ")}`,
]);

// 预览服务只在本机通信，不需要外网；去掉代理变量，避免请求转发经过代理时偶发 “fetch failed”
const previewEnv = { ...env };
for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) delete previewEnv[name];
const preview = spawn("npx", ["vite", "preview", "--mode", "mock", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
  env: previewEnv,
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
