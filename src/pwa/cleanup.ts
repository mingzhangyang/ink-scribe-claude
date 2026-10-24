/**
 * 旧版本缓存的清理（src/sw.ts 使用）。新版本接管后，更新前打开的页面仍运行旧脚本，可能还要按需加载旧版本的分片，
 * 所以启用新版本时只记录被替换的缓存，等这些页面都关闭后再删除。依赖通过参数传入，便于单元测试。
 */

export const APP_CACHE_PREFIX = "ink-scribe-app-";
const META_CACHE = "ink-scribe-meta";
const RETIRED_KEY = "/__ink-scribe/retired-caches";

type Storage = Pick<CacheStorage, "keys" | "open" | "delete">;
type Retired = { clients: string[]; caches: string[] };

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);

async function readRetired(storage: Storage): Promise<Retired> {
  const response = await (await storage.open(META_CACHE)).match(RETIRED_KEY);
  const value = (await response?.json().catch(() => null)) as { clients?: unknown; caches?: unknown } | null | undefined;
  return { clients: strings(value?.clients), caches: strings(value?.caches) };
}

/**
 * 新版本启用时调用：此刻已有的其他版本缓存都被替换，clients 是仍在运行旧脚本的页面。
 * 只记录这一刻已有的缓存，之后才安装的更新版本的缓存不会被当作旧缓存删除。
 */
export async function retireCaches(storage: Storage, current: string, clients: string[]): Promise<void> {
  const caches = (await storage.keys()).filter((name) => name.startsWith(APP_CACHE_PREFIX) && name !== current);
  const record: Retired = { clients, caches };
  await (await storage.open(META_CACHE)).put(RETIRED_KEY, new Response(JSON.stringify(record), { headers: { "Content-Type": "application/json" } }));
}

/** 记录的旧页面都已关闭时，删除启用新版本时被替换的缓存；current 是正在运行的版本，永远不删。 */
export async function pruneRetiredCaches(storage: Storage, current: string, isAlive: (clientId: string) => Promise<boolean>): Promise<void> {
  const retired = await readRetired(storage);
  if (retired.caches.length === 0) return;
  if ((await Promise.all(retired.clients.map(isAlive))).some(Boolean)) return;
  await Promise.all(retired.caches.filter((name) => name !== current).map((name) => storage.delete(name)));
  await (await storage.open(META_CACHE)).delete(RETIRED_KEY);
}
