// 墨语笔记的品牌图形：用 SVG 描述，generate.mjs 在浏览器的 canvas 中把它们栅格化为各尺寸图标与 OG 图。
// 图形含义：深墨蓝底上一页微微倾斜的笔记纸（左侧康奈尔线索栏、荧光笔高亮、手写波浪线），右下角一支金色笔尖。

export const COLORS = {
  inkDeep: "#141c3d",
  ink: "#1e3a8a",
  inkLight: "#2b4aa8",
  paper: "#fdfbf7",
  paperShade: "#efe8d8",
  cue: "#e07a64",
  highlight: "#f7d55c",
  gold: "#e8c468",
  goldDark: "#b8892c",
};

/** 一段手写感的波浪线：从 (x, y) 起，宽 w，振幅 a。 */
function scribble(x, y, w, a = 1.4) {
  const step = w / 4;
  let d = `M${x} ${y}`;
  for (let i = 0; i < 4; i++) {
    const x1 = x + step * i + step / 2;
    const x2 = x + step * (i + 1);
    d += ` Q${x1} ${y + (i % 2 ? a : -a)} ${x2} ${y}`;
  }
  return d;
}

function nib(x, y, angle, size, strokeColor) {
  // 笔尖朝下，尖端位于 (0, 0)；整体按 size 缩放后旋转平移到 (x, y)
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${size})">
    <path d="M0 0 C-2.2 -3.2 -5 -6.5 -5 -10.5 L-4 -17 L4 -17 L5 -10.5 C5 -6.5 2.2 -3.2 0 0 Z" fill="url(#nib)" stroke="${strokeColor}" stroke-width="0.9" stroke-linejoin="round"/>
    <path d="M0 -0.6 V-8.6" stroke="${COLORS.inkDeep}" stroke-width="0.9" stroke-linecap="round"/>
    <circle cx="0" cy="-10" r="1.5" fill="${COLORS.inkDeep}"/>
    <rect x="-5.2" y="-23" width="10.4" height="6.6" rx="1.4" fill="${COLORS.inkDeep}" stroke="${strokeColor}" stroke-width="0.9"/>
  </g>`;
}

/**
 * 品牌标志（64×64 视图）。
 * - detail "full"：完整版，用于页面中的标志与大图标
 * - detail "small"：简化版，线条更粗、元素更少，用于 16–48px 的 favicon
 * - shape "rounded"：圆角方块（默认）；"square"：直角铺满，交给系统加圆角（apple-touch-icon）；
 *   "maskable"：直角铺满且内容缩进到安全区内，供 Android 自适应图标裁切
 */
export function logoSvg({ detail = "full", shape = "rounded" } = {}) {
  const small = detail === "small";
  const body = small
    ? `<g transform="rotate(-8 30 32)">
        <rect x="12" y="9" width="34" height="45" rx="4" fill="${COLORS.paper}"/>
        <path d="M20.5 9v45" stroke="${COLORS.cue}" stroke-width="2.4"/>
        <path d="M26 21h14" stroke="${COLORS.highlight}" stroke-width="8" stroke-linecap="round"/>
        <path d="${scribble(26, 21, 14, 1.6)}" stroke="${COLORS.ink}" stroke-width="3.4" fill="none" stroke-linecap="round"/>
        <path d="${scribble(26, 32, 14, 1.6)}" stroke="${COLORS.ink}" stroke-width="3.4" fill="none" stroke-linecap="round"/>
        <path d="M26 43h7" stroke="${COLORS.ink}" stroke-width="3.4" stroke-linecap="round"/>
      </g>
      ${nib(45, 49, 38, 1.15, COLORS.goldDark)}`
    : `<g transform="rotate(-8 30 32)">
        <rect x="13.5" y="10.5" width="33" height="44" rx="3.5" fill="${COLORS.inkDeep}" opacity=".35"/>
        <rect x="12" y="9" width="33" height="44" rx="3.5" fill="${COLORS.paper}"/>
        <path d="M12 15.5h33" stroke="${COLORS.paperShade}" stroke-width="1"/>
        <path d="M20 15.5v37.5" stroke="${COLORS.cue}" stroke-width="1.3" opacity=".85"/>
        <path d="M15 22.5h2.4M15 31h2.4" stroke="${COLORS.ink}" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M24 22.5h14" stroke="${COLORS.highlight}" stroke-width="5.6" stroke-linecap="round" opacity=".95"/>
        <path d="${scribble(24, 22.5, 14, 1.3)}" stroke="${COLORS.ink}" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${scribble(24, 31, 16, 1.3)}" stroke="${COLORS.ink}" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${scribble(24, 39.5, 10, 1.3)}" stroke="${COLORS.ink}" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M15 47.5h26" stroke="${COLORS.paperShade}" stroke-width="1"/>
      </g>
      ${nib(45, 48.5, 38, 1, COLORS.goldDark)}`;
  const content = shape === "maskable" ? `<g transform="translate(32 32) scale(0.72) translate(-32 -32)">${body}</g>` : body;
  const radius = shape === "rounded" ? 14 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${COLORS.inkLight}"/>
      <stop offset="1" stop-color="${COLORS.inkDeep}"/>
    </linearGradient>
    <linearGradient id="nib" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${COLORS.gold}"/>
      <stop offset="1" stop-color="#f6e2a4"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="${radius}" fill="url(#bg)"/>
  ${content}
</svg>
`.replace(/\n\s*/g, "");
}
