import { Frame, INK, isInk, pen, type ArtProps } from "./common.tsx";

/**
 * 动物：多色粗线条的简笔画。坐标沿用原画稿的像素，整体缩放进贴纸画框；
 * 彩色款每笔一种颜色，略透明，交叠处颜色加深，像马克笔；墨线款全部用墨水色。
 */

type Stroke = { d: string; color: string; fill?: boolean };

function LineArt({ strokes, ink, width, transform }: { strokes: Stroke[]; ink: boolean; width: number; transform: string }) {
  return (
    <g transform={transform} style={{ opacity: ink ? 1 : 0.92 }}>
      {strokes.map(({ d, color, fill }, i) =>
        fill ? (
          <path key={i} d={d} style={{ fill: ink ? INK : color }} />
        ) : (
          <path key={i} d={d} style={pen(ink ? INK : color, width)} />
        ),
      )}
    </g>
  );
}

const YELLOW = "#F9C22E";
const PINK = "#F0468F";
const ORANGE = "#F7941D";
const TEAL = "#1FB2BC";
const GREEN = "#8DC63F";
const BROWN = "#7A4B2A";

/** 站在树枝上唱歌的小鸟（原稿约 1088×1445）。 */
const BIRD: Stroke[] = [
  { d: "M110 1155 C200 1070 330 1010 470 975 C600 945 750 925 850 905", color: GREEN },
  { d: "M848 906 C830 850 860 790 935 770 C955 820 930 885 848 906 Z", color: TEAL },
  { d: "M842 942 C880 918 960 915 990 985 C930 1010 865 985 842 942 Z", color: TEAL },
  { d: "M535 500 C550 420 610 360 690 338 C745 325 785 360 797 408", color: YELLOW },
  { d: "M796 470 C786 505 800 535 806 575 C826 680 776 780 700 840 C640 885 560 900 465 890 L292 1028", color: YELLOW },
  { d: "M795 418 L880 410 L800 470 L875 487", color: ORANGE },
  { d: "M713 414 A18 18 0 1 1 712.9 414 Z", color: TEAL, fill: true },
  { d: "M345 832 C305 800 315 740 350 670 C400 580 480 525 560 525 C620 527 645 575 635 640 C620 720 540 790 460 825 C410 845 365 845 345 832 Z", color: PINK },
  { d: "M505 704 C440 760 340 830 190 918", color: PINK },
  { d: "M548 902 C575 925 600 940 612 955 C620 968 618 980 614 988", color: ORANGE },
  { d: "M603 868 C640 895 668 915 683 935 C694 950 692 963 688 970", color: ORANGE },
];

export function Bird({ variant }: ArtProps) {
  return (
    <Frame type="bird">
      <LineArt strokes={BIRD} ink={isInk(variant)} width={22} transform="translate(-7 -30) scale(0.1)" />
    </Frame>
  );
}

/** 在草地上走的刺猬，背上是彩色的刺（原稿约 1386×1135）。 */
const HEDGEHOG: Stroke[] = [
  { d: "M138 937 C250 895 380 900 480 920 C600 945 750 955 900 925 C1000 905 1100 900 1270 942", color: GREEN },
  { d: "M108 742 C160 730 215 770 212 845 C150 855 105 800 108 742 Z", color: TEAL },
  { d: "M215 850 C225 870 232 885 235 900", color: GREEN },
  { d: "M235 885 C225 840 255 790 302 785 C310 840 285 880 240 885", color: GREEN },
  { d: "M1158 845 C1150 800 1185 770 1225 775 C1265 782 1285 830 1268 870 C1235 860 1195 848 1158 845 Z", color: PINK },
  { d: "M1190 860 C1180 880 1175 905 1195 915 C1220 920 1225 895 1222 868", color: ORANGE },
  // 外圈的刺，从额头一路到尾部
  { d: "M390 462 C375 420 360 390 365 372 L442 446", color: TEAL },
  { d: "M452 446 C430 360 425 290 450 240 L512 372", color: PINK },
  { d: "M515 370 C525 290 545 220 585 160 C595 200 590 260 598 305", color: YELLOW },
  { d: "M600 312 C640 240 690 180 738 158 L690 333", color: PINK },
  { d: "M700 325 C760 255 830 205 902 185 L805 340", color: TEAL },
  { d: "M805 342 C880 295 960 265 1045 268 L910 385", color: ORANGE },
  { d: "M912 386 C990 360 1080 362 1145 398 L1000 460", color: PINK },
  { d: "M1002 460 C1090 485 1160 520 1196 555 L1015 560", color: YELLOW },
  { d: "M1015 562 C1090 600 1150 650 1182 700 L1045 678", color: PINK },
  { d: "M1046 678 C1080 720 1105 760 1112 800", color: YELLOW },
  { d: "M935 766 C1000 780 1060 790 1110 803", color: GREEN },
  // 身体里的几排刺
  { d: "M535 470 C570 420 600 395 632 383 L610 505", color: PINK },
  { d: "M615 495 C680 440 760 400 838 392 L758 488 C820 475 890 478 940 498 L838 562", color: GREEN },
  { d: "M838 563 C900 570 960 590 1005 632 L905 655 C960 690 1000 715 1028 742", color: TEAL },
  { d: "M632 567 C680 550 720 550 752 570 L672 632 C730 645 790 660 838 700 L725 718", color: ORANGE },
  { d: "M725 718 C770 745 815 770 858 795", color: PINK },
  // 脸、耳朵和身体轮廓
  { d: "M450 528 C470 500 510 495 530 520 C550 545 540 585 523 600", color: ORANGE },
  { d: "M407 587 A18 18 0 1 1 406.9 587 Z", color: BROWN, fill: true },
  { d: "M215 577 A28 28 0 1 1 214.9 577 Z", color: BROWN, fill: true },
  { d: "M240 607 C300 610 360 560 392 465", color: BROWN },
  {
    d: "M222 632 C270 730 380 770 480 790 C540 805 545 845 500 860 C455 875 440 905 470 912 C520 925 570 900 585 838 C700 865 800 870 910 840 C905 860 870 870 862 895 C858 915 900 920 940 905 C985 885 990 830 975 800 C968 785 955 775 940 768",
    color: BROWN,
  },
];

export function Hedgehog({ variant }: ArtProps) {
  return (
    <Frame type="hedgehog">
      <LineArt strokes={HEDGEHOG} ink={isInk(variant)} width={24} transform="translate(-6 -9) scale(0.08)" />
    </Frame>
  );
}
