import { memo, type ComponentType } from "react";
import { DoodleArt } from "../components/note/DoodleArt.tsx";
import { builtinDoodle } from "../doodles/library.ts";
import { hashString } from "../lib/random.ts";
import { paint, type ArtProps } from "./art/common.tsx";
import { BinderClip, MaskingTape, Paperclip, PhotoCorner, PushPin, Staple, Tape } from "./art/fasten.tsx";
import { Arrow, Bracket, Check, CircleMark, Cross, Exclaim, Question, WavyUnderline } from "./art/marks.tsx";
import { Face, Heart, PressedFlower, Sparkles, Star } from "./art/mood.tsx";
import { DogEar, KraftTag, PageFlag, PostageStamp, RibbonBookmark, StickyNote, TicketStub, TornPaper } from "./art/paper.tsx";
import { CoffeeStain, InkBlot, PawPrint, Postmark, Seal } from "./art/stamps.tsx";
import { isDoodleTheme, STICKER_SIZES, stickerVariant, type DecorStickerType, type StickerItem } from "./types.ts";

const DECOR_ART: Record<DecorStickerType, ComponentType<ArtProps>> = {
  tape: Tape,
  "masking-tape": MaskingTape,
  paperclip: Paperclip,
  "binder-clip": BinderClip,
  "push-pin": PushPin,
  staple: Staple,
  "photo-corner": PhotoCorner,
  "sticky-note": StickyNote,
  "page-flag": PageFlag,
  "torn-paper": TornPaper,
  "kraft-tag": KraftTag,
  "ticket-stub": TicketStub,
  "postage-stamp": PostageStamp,
  "dog-ear": DogEar,
  "ribbon-bookmark": RibbonBookmark,
  arrow: Arrow,
  "circle-mark": CircleMark,
  "wavy-underline": WavyUnderline,
  bracket: Bracket,
  check: Check,
  cross: Cross,
  exclaim: Exclaim,
  question: Question,
  seal: Seal,
  postmark: Postmark,
  "ink-blot": InkBlot,
  "coffee-stain": CoffeeStain,
  "paw-print": PawPrint,
  star: Star,
  sparkles: Sparkles,
  heart: Heart,
  face: Face,
  "pressed-flower": PressedFlower,
};

type Props = { item: StickerItem; naturalness: number; seed: number };

export const StickerArt = memo(function StickerArt({ item, naturalness, seed }: Props) {
  if (item.type === "custom-doodle") {
    const spec = item.doodle ?? builtinDoodle(isDoodleTheme(item.variant) ? item.variant : "star");
    const { w, h } = STICKER_SIZES["custom-doodle"];
    return (
      <div style={{ width: w, height: h }}>
        <DoodleArt spec={spec} seed={seed ^ hashString(item.id)} naturalness={naturalness} className="sticker-doodle" />
      </div>
    );
  }
  const variant = stickerVariant(item.type, item.variant);
  const Art = DECOR_ART[item.type];
  return <Art color={paint(variant.color)} variant={variant} seed={hashString(item.id)} />;
});
