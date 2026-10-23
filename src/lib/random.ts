/** 可复现的伪随机数：同一份笔记在预览和导出时得到完全相同的“手写抖动”。 */

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 返回 [-1, 1) 区间的随机数生成器。 */
export function signedRandom(seed: number): () => number {
  const next = mulberry32(seed);
  return () => next() * 2 - 1;
}
