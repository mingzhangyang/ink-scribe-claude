import { forwardRef, useEffect, useMemo, type CSSProperties } from "react";
import type { DoodleSpec } from "../../../shared/doodle.ts";
import type { NoteStructure } from "../../../shared/note.ts";
import { TEMPLATE_DEFAULT_THEME } from "../../../shared/themes.ts";
import { ACCENTS, byId, fontStack, INKS, PAGE_SIZES, PAGE_WIDTH, PAPERS, usedFamilies } from "../../config/appearance.ts";
import { builtinDoodle } from "../../doodles/library.ts";
import { loadFontCss } from "../../fonts.ts";
import type { Settings } from "../../state/store.ts";
import { StickerLayer } from "../../stickers/StickerLayer.tsx";
import type { StickerItem } from "../../stickers/types.ts";
import { LAYOUTS } from "./layouts.tsx";
import { labelsFor } from "./parts.tsx";

type Props = {
  note: NoteStructure;
  settings: Settings;
  stickers: StickerItem[];
  aiDoodle: DoodleSpec | null;
  selectedStickerId: string | null;
  interactive: boolean;
  displayScale: number;
  onSelectSticker: (id: string | null) => void;
  onChangeSticker: (id: string, patch: Partial<StickerItem>) => void;
  onRemoveSticker: (id: string) => void;
};

export function pageHeightFor(settings: Settings): number | null {
  return byId(PAGE_SIZES, settings.pageSize).height;
}

export function resolveDoodle(note: NoteStructure, settings: Settings, aiDoodle: DoodleSpec | null): DoodleSpec | null {
  switch (settings.doodleMode) {
    case "none":
      return null;
    case "ai":
      return aiDoodle ?? builtinDoodle(note.doodleTheme ?? settings.doodleTheme);
    case "theme":
      return builtinDoodle(settings.doodleTheme);
    case "auto":
      return note.doodleSpec ?? builtinDoodle(note.doodleTheme ?? TEMPLATE_DEFAULT_THEME.general);
  }
}

/**
 * 笔记画布。预览与导出使用同一个 DOM 节点：显示时由外层容器整体缩放，
 * 导出时直接对该节点按 1x/2x/3x 渲染，保证字体、贴纸位置和旋转完全一致。
 */
export const NotePage = forwardRef<HTMLDivElement, Props>(function NotePage(
  { note, settings, stickers, aiDoodle, selectedStickerId, interactive, displayScale, onSelectSticker, onChangeSticker, onRemoveSticker },
  ref,
) {
  const height = pageHeightFor(settings);
  const paper = byId(PAPERS, settings.paper);
  const labels = useMemo(() => labelsFor(note), [note]);
  const doodle = useMemo(() => resolveDoodle(note, settings, aiDoodle), [note, settings, aiDoodle]);
  const Layout = LAYOUTS[settings.layout];

  useEffect(() => {
    for (const family of usedFamilies(settings.zhFont, settings.enFont)) void loadFontCss(family);
  }, [settings.zhFont, settings.enFont]);

  const style = {
    width: PAGE_WIDTH,
    height: height ?? undefined,
    minHeight: height ?? byId(PAGE_SIZES, "a4").height,
    "--paper": paper.base,
    "--paper-line": paper.lineColor,
    "--ink": byId(INKS, settings.ink).color,
    "--accent": byId(ACCENTS, settings.accent).color,
    "--hand-font": fontStack(settings.zhFont, settings.enFont),
    "--fs": `${settings.fontSize}px`,
    "--lh": settings.lineHeight,
    "--ls": `${settings.letterSpacing}em`,
    "--jit": settings.naturalness,
    "--rule": `${Math.round(settings.fontSize * settings.lineHeight)}px`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className={`note-page paper-${paper.id} layout-${settings.layout}${height ? "" : " is-long"}`}
      style={style}
      onPointerDown={(event) => {
        if (interactive && !(event.target as HTMLElement).closest(".sticker")) onSelectSticker(null);
      }}
    >
      <Layout note={note} labels={labels} seed={settings.seed} naturalness={settings.naturalness} doodle={doodle} />
      <StickerLayer
        stickers={stickers}
        selectedId={selectedStickerId}
        interactive={interactive}
        displayScale={displayScale}
        pageHeight={height ?? 2400}
        naturalness={settings.naturalness}
        seed={settings.seed}
        onSelect={onSelectSticker}
        onChange={onChangeSticker}
        onRemove={onRemoveSticker}
      />
    </div>
  );
});
