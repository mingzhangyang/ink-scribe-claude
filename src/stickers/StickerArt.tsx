import { memo, type ComponentType } from "react";
import { DoodleArt } from "../components/note/DoodleArt.tsx";
import { builtinDoodle } from "../doodles/library.ts";
import { hashString } from "../lib/random.ts";
import { paint, type ArtProps } from "./art/common.tsx";
import { BinderClip, MaskingTape, Paperclip, PhotoCorner, PushPin, Staple, Tape } from "./art/fasten.tsx";
import {
  BellCurve,
  CarbonDioxide,
  Euler,
  GlucoseFormula,
  GREEK_ART,
  InfinitySign,
  Integral,
  MassEnergy,
  NewtonSecond,
  Ohm,
  Pi,
  Pythagorean,
  Sigma,
  SineWave,
  SodiumChloride,
  SquareRoot,
  WaterFormula,
} from "./art/formulas.tsx";
import { Apple, Banana, Grape, Mango, Orange, Strawberry, Watermelon } from "./art/fruit.tsx";
import { Bird, Chili, Detective, Dog, Hedgehog, Princess } from "./art/line-art.tsx";
import { Arrow, Bracket, Check, CircleMark, Cross, Exclaim, Question, WavyUnderline } from "./art/marks.tsx";
import { Face, Heart, PressedFlower, Sparkles, Star } from "./art/mood.tsx";
import { DogEar, KraftTag, PageFlag, PostageStamp, RibbonBookmark, StickyNote, TicketStub, TornPaper } from "./art/paper.tsx";
import {
  Geili,
  Hang,
  Jiang,
  Juan,
  Ku,
  LetterY,
  Shuai,
  Tainiule,
  Tangping,
  Tongyi,
  Wang,
  Wanmei,
  Yyds,
  Zan,
  Zhengnengliang,
  Zhixingheyi,
} from "./art/phrases.tsx";
import {
  AlphaHelix,
  Antibody,
  Atom,
  Beaker,
  Benzene,
  Circuit,
  Dna,
  Flask,
  GlucoseRing,
  Lens,
  Magnet,
  Microscope,
  TRna,
  WaterMolecule,
} from "./art/science.tsx";
import { Astronaut, BigDipper, BlackHole, Comet, Earth, Galaxy, Jupiter, Moon, Saturn, Sun } from "./art/space.tsx";
import { CoffeeStain, InkBlot, PawPrint, Postmark, Seal } from "./art/stamps.tsx";
import { Airplane, BulletTrain, Car, Rocket, Sailboat, Satellite, Ship, Starship, Train } from "./art/vehicles.tsx";
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
  orange: Orange,
  apple: Apple,
  banana: Banana,
  strawberry: Strawberry,
  mango: Mango,
  watermelon: Watermelon,
  grape: Grape,
  pi: Pi,
  pythagorean: Pythagorean,
  euler: Euler,
  integral: Integral,
  sigma: Sigma,
  sqrt: SquareRoot,
  infinity: InfinitySign,
  "sine-wave": SineWave,
  "bell-curve": BellCurve,
  emc2: MassEnergy,
  fma: NewtonSecond,
  ohm: Ohm,
  h2o: WaterFormula,
  co2: CarbonDioxide,
  nacl: SodiumChloride,
  "glucose-formula": GlucoseFormula,
  benzene: Benzene,
  "water-molecule": WaterMolecule,
  "glucose-ring": GlucoseRing,
  dna: Dna,
  "alpha-helix": AlphaHelix,
  antibody: Antibody,
  trna: TRna,
  atom: Atom,
  magnet: Magnet,
  lens: Lens,
  circuit: Circuit,
  beaker: Beaker,
  flask: Flask,
  microscope: Microscope,
  ...GREEK_ART,
  car: Car,
  train: Train,
  "bullet-train": BulletTrain,
  ship: Ship,
  sailboat: Sailboat,
  airplane: Airplane,
  rocket: Rocket,
  starship: Starship,
  satellite: Satellite,
  sun: Sun,
  earth: Earth,
  moon: Moon,
  saturn: Saturn,
  jupiter: Jupiter,
  comet: Comet,
  galaxy: Galaxy,
  "black-hole": BlackHole,
  "big-dipper": BigDipper,
  astronaut: Astronaut,
  bird: Bird,
  hedgehog: Hedgehog,
  dog: Dog,
  chili: Chili,
  detective: Detective,
  hang: Hang,
  geili: Geili,
  tongyi: Tongyi,
  zhixingheyi: Zhixingheyi,
  zhengnengliang: Zhengnengliang,
  yyds: Yyds,
  juan: Juan,
  tangping: Tangping,
  wanmei: Wanmei,
  tainiule: Tainiule,
  zan: Zan,
  "letter-y": LetterY,
  wang: Wang,
  princess: Princess,
  jiang: Jiang,
  shuai: Shuai,
  ku: Ku,
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
