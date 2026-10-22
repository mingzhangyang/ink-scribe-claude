import { memo } from "react";
import { DoodleArt } from "../components/note/DoodleArt.tsx";
import { builtinDoodle } from "../doodles/library.ts";
import { hashString, signedRandom } from "../lib/random.ts";
import { isDoodleTheme, STICKER_SIZES, STICKER_VARIANTS, type StickerItem } from "./types.ts";

function variantColor(item: StickerItem): string {
  if (item.type === "custom-doodle") return "";
  const variants = STICKER_VARIANTS[item.type];
  return (variants.find((v) => v.id === item.variant) ?? variants[0]).color;
}

function Tape({ color }: { color: string }) {
  const { w, h } = STICKER_SIZES.tape;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path
        d={`M4 3 L${w - 4} 1 L${w - 8} 8 L${w - 2} 14 L${w - 7} 21 L${w - 2} 28 L${w - 5} ${h - 1} L3 ${h - 2} L7 ${h - 9} L1 ${h - 16} L6 ${h - 23} L1 9 Z`}
        style={{ fill: color, opacity: 0.8 }}
      />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <path key={i} d={`M${14 + i * 20} 4 l10 ${h - 8}`} style={{ stroke: "rgba(255,255,255,0.45)", strokeWidth: 5 }} />
      ))}
    </svg>
  );
}

function StickyNote({ color }: { color: string }) {
  const { w, h } = STICKER_SIZES["sticky-note"];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={`M6 8 L${w - 2} 6 L${w - 4} ${h - 2} L24 ${h} L4 ${h - 20} Z`} style={{ fill: "rgba(0,0,0,0.12)" }} />
      <path d={`M2 2 L${w - 6} 2 L${w - 6} ${h - 6} L22 ${h - 6} L2 ${h - 26} Z`} style={{ fill: color }} />
      <path d={`M2 ${h - 26} L22 ${h - 26} L22 ${h - 6} Z`} style={{ fill: "rgba(0,0,0,0.1)" }} />
      <path d={`M2 2 L${w - 6} 2 L${w - 6} 16 L2 16 Z`} style={{ fill: "rgba(0,0,0,0.04)" }} />
    </svg>
  );
}

function Paperclip({ color }: { color: string }) {
  const { w, h } = STICKER_SIZES.paperclip;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path
        d="M24 30 L24 74 C24 84 12 84 12 74 L12 18 C12 4 32 4 32 18 L32 80 C32 96 4 96 4 80 L4 26"
        style={{ fill: "none", stroke: color, strokeWidth: 3.2, strokeLinecap: "round" }}
      />
      <path
        d="M24 30 L24 74 C24 84 12 84 12 74 L12 18 C12 4 32 4 32 18"
        style={{ fill: "none", stroke: "rgba(255,255,255,0.5)", strokeWidth: 1, strokeLinecap: "round" }}
      />
    </svg>
  );
}

function Star({ color }: { color: string }) {
  const { w, h } = STICKER_SIZES.star;
  const points = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 30 : 13;
    return `${(32 + Math.cos(a) * r).toFixed(1)} ${(33 + Math.sin(a) * r).toFixed(1)}`;
  });
  const isInk = color === "ink";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path
        d={`M${points.join(" L")} Z`}
        style={{
          fill: isInk ? "none" : color,
          stroke: isInk ? "var(--ink)" : "#CA8A04",
          strokeWidth: isInk ? 2.4 : 1.6,
          strokeLinejoin: "round",
        }}
      />
      {isInk ? null : <path d="M22 26 L28 20" style={{ stroke: "rgba(255,255,255,0.8)", strokeWidth: 2.5, strokeLinecap: "round" }} />}
    </svg>
  );
}

function CoffeeStain({ color, seed }: { color: string; seed: number }) {
  const { w, h } = STICKER_SIZES["coffee-stain"];
  const rand = signedRandom(seed);
  const ring = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r = 62 + rand() * 4;
    return `${(85 + Math.cos(a) * r).toFixed(1)} ${(85 + Math.sin(a) * r).toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={`M${ring.join(" L")} Z`} style={{ fill: "none", stroke: color, strokeWidth: 7, strokeLinejoin: "round" }} />
      <path d={`M${ring.join(" L")} Z`} style={{ fill: "none", stroke: color, strokeWidth: 2, opacity: 0.8, transform: "translate(3px, 2px)" }} />
      <circle cx={150} cy={40} r={5} style={{ fill: color }} />
      <circle cx={158} cy={56} r={2.5} style={{ fill: color }} />
      <circle cx={24} cy={140} r={3.5} style={{ fill: color }} />
    </svg>
  );
}

type Props = { item: StickerItem; naturalness: number; seed: number };

export const StickerArt = memo(function StickerArt({ item, naturalness, seed }: Props) {
  const color = variantColor(item);
  switch (item.type) {
    case "tape":
      return <Tape color={color} />;
    case "sticky-note":
      return <StickyNote color={color} />;
    case "paperclip":
      return <Paperclip color={color} />;
    case "star":
      return <Star color={color} />;
    case "coffee-stain":
      return <CoffeeStain color={color} seed={hashString(item.id)} />;
    case "custom-doodle": {
      const spec = item.doodle ?? builtinDoodle(isDoodleTheme(item.variant) ? item.variant : "star");
      const { w, h } = STICKER_SIZES["custom-doodle"];
      return (
        <div style={{ width: w, height: h }}>
          <DoodleArt spec={spec} seed={seed ^ hashString(item.id)} naturalness={naturalness} className="sticker-doodle" />
        </div>
      );
    }
  }
});
