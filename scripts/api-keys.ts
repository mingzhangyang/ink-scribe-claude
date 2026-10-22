/**
 * API 密钥管理（手动发放）。密钥只在创建时打印一次，D1 中只保存 SHA-256 哈希。
 *
 *   npm run keys -- create --name "我的发布脚本" [--remote]
 *   npm run keys -- list [--remote]
 *   npm run keys -- revoke --id key_xxxxxxxx [--remote]
 *
 * 默认操作本地开发数据库（--local），加 --remote 操作线上 D1。
 */
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const DATABASE = "ink-scribe";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    id: { type: "string" },
    remote: { type: "boolean", default: false },
  },
});

const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

function d1(sql: string, json = false): string {
  const args = ["wrangler", "d1", "execute", DATABASE, values.remote ? "--remote" : "--local", "--command", sql];
  if (json) args.push("--json");
  const result = spawnSync("npx", args, { encoding: "utf8", stdio: json ? ["inherit", "pipe", "inherit"] : "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout ?? "";
}

const command = positionals[0];
switch (command) {
  case "create": {
    const name = values.name?.trim();
    if (!name) {
      console.error("请用 --name 指定密钥用途，例如 --name \"每日发布脚本\"");
      process.exit(1);
    }
    const key = `isk_${randomBytes(32).toString("base64url")}`;
    const id = `key_${randomBytes(6).toString("hex")}`;
    const hash = createHash("sha256").update(key).digest("hex");
    d1(`INSERT INTO api_keys (id, name, key_hash, created_at) VALUES (${sqlString(id)}, ${sqlString(name)}, ${sqlString(hash)}, ${Date.now()})`);
    console.log(`\n已创建 API 密钥（${values.remote ? "线上" : "本地"}）`);
    console.log(`  ID:   ${id}`);
    console.log(`  名称: ${name}`);
    console.log(`  密钥: ${key}`);
    console.log("\n密钥只显示这一次，请立即保存到安全的位置（例如 agent 的环境变量 INKSCRIBE_API_KEY）。");
    break;
  }
  case "list": {
    const out = d1("SELECT id, name, created_at, last_used_at, revoked_at FROM api_keys ORDER BY created_at DESC", true);
    const rows = (JSON.parse(out) as Array<{ results: Array<Record<string, number | string | null>> }>)[0]?.results ?? [];
    const fmt = (ms: unknown) => (typeof ms === "number" ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) : "-");
    for (const row of rows) {
      console.log(`${row.id}  ${row.revoked_at ? "已吊销" : "有效  "}  创建 ${fmt(row.created_at)}  最近使用 ${fmt(row.last_used_at)}  ${row.name}`);
    }
    if (rows.length === 0) console.log("还没有 API 密钥。");
    break;
  }
  case "revoke": {
    if (!values.id) {
      console.error("请用 --id 指定要吊销的密钥 ID（可通过 list 查看）");
      process.exit(1);
    }
    d1(`UPDATE api_keys SET revoked_at = ${Date.now()} WHERE id = ${sqlString(values.id)}`);
    console.log(`已吊销 ${values.id}`);
    break;
  }
  default:
    console.error("用法：npm run keys -- <create|list|revoke> [--name …] [--id …] [--remote]");
    process.exit(1);
}
