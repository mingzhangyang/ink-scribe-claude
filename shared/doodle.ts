import { cleanText } from "./text.ts";

/**
 * 受限的插图图元规格（DoodleSpec）。
 *
 * 模型只能描述有限几种图元，坐标位于 0–100 的方形画布内，颜色只能取调色板中的名称。
 * 任何未知字段都会被丢弃，数值会被钳制到合法区间。最终 SVG 由客户端的受控生成器绘制，
 * 不存在脚本、事件处理器、外部资源或 URL。
 */

export const DOODLE_ELEMENT_TYPES = ["line", "path", "circle", "rect", "arrow"] as const;
export type DoodleElementType = (typeof DOODLE_ELEMENT_TYPES)[number];

export const DOODLE_STROKES = ["ink", "accent", "muted"] as const;
export type DoodleStroke = (typeof DOODLE_STROKES)[number];

export const DOODLE_FILLS = ["none", "yellow", "green", "orange", "ink"] as const;
export type DoodleFill = (typeof DOODLE_FILLS)[number];

type StrokeStyle = { stroke: DoodleStroke; width: number };

export type DoodleLine = { type: "line"; x1: number; y1: number; x2: number; y2: number } & StrokeStyle;
export type DoodleArrow = { type: "arrow"; x1: number; y1: number; x2: number; y2: number } & StrokeStyle;
export type DoodleCircle = { type: "circle"; cx: number; cy: number; r: number; fill: DoodleFill } & StrokeStyle;
export type DoodleRect = {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  fill: DoodleFill;
} & StrokeStyle;
export type DoodlePath = {
  type: "path";
  points: Array<[number, number]>;
  closed: boolean;
  smooth: boolean;
  fill: DoodleFill;
} & StrokeStyle;

export type DoodleElement = DoodleLine | DoodleArrow | DoodleCircle | DoodleRect | DoodlePath;

export type DoodleSpec = {
  concept: string;
  elements: DoodleElement[];
};

export const DOODLE_LIMITS = {
  canvas: 100,
  maxElements: 24,
  maxPoints: 24,
  minPoints: 2,
  minRadius: 1,
  maxRadius: 50,
  minSize: 1,
  minWidth: 0.5,
  maxWidth: 4,
  maxCornerRadius: 20,
  concept: 40,
} as const;

export type NormalizeResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: string[] };

function toNumber(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function coord(value: unknown): number | undefined {
  const n = toNumber(value);
  return n === undefined ? undefined : round(clamp(n, 0, DOODLE_LIMITS.canvas));
}

function pick<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

function strokeStyle(raw: Record<string, unknown>): StrokeStyle {
  const width = toNumber(raw.width);
  return {
    stroke: pick(DOODLE_STROKES, raw.stroke, "ink"),
    width: round(clamp(width ?? 2, DOODLE_LIMITS.minWidth, DOODLE_LIMITS.maxWidth)),
  };
}

function normalizePoint(value: unknown): [number, number] | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    const x = coord(value[0]);
    const y = coord(value[1]);
    return x === undefined || y === undefined ? undefined : [x, y];
  }
  if (value && typeof value === "object") {
    const p = value as Record<string, unknown>;
    const x = coord(p.x);
    const y = coord(p.y);
    return x === undefined || y === undefined ? undefined : [x, y];
  }
  return undefined;
}

export function normalizeDoodleElement(value: unknown): DoodleElement | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const type = raw.type;

  switch (type) {
    case "line":
    case "arrow": {
      const x1 = coord(raw.x1);
      const y1 = coord(raw.y1);
      const x2 = coord(raw.x2);
      const y2 = coord(raw.y2);
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return undefined;
      if (x1 === x2 && y1 === y2) return undefined;
      return { type, x1, y1, x2, y2, ...strokeStyle(raw) };
    }
    case "circle": {
      const cx = coord(raw.cx);
      const cy = coord(raw.cy);
      const r = toNumber(raw.r);
      if (cx === undefined || cy === undefined || r === undefined) return undefined;
      return {
        type,
        cx,
        cy,
        r: round(clamp(r, DOODLE_LIMITS.minRadius, DOODLE_LIMITS.maxRadius)),
        fill: pick(DOODLE_FILLS, raw.fill, "none"),
        ...strokeStyle(raw),
      };
    }
    case "rect": {
      const x = coord(raw.x);
      const y = coord(raw.y);
      const w = toNumber(raw.w ?? raw.width);
      const h = toNumber(raw.h ?? raw.height);
      if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
      const maxW = DOODLE_LIMITS.canvas - x;
      const maxH = DOODLE_LIMITS.canvas - y;
      if (maxW < DOODLE_LIMITS.minSize || maxH < DOODLE_LIMITS.minSize) return undefined;
      // 兼容模型把描边宽度写在 width 上的情况：只有提供了 w/h 时 width 才被当作描边宽度
      const style = strokeStyle(raw.w !== undefined ? raw : { ...raw, width: undefined });
      return {
        type,
        x,
        y,
        w: round(clamp(w, DOODLE_LIMITS.minSize, maxW)),
        h: round(clamp(h, DOODLE_LIMITS.minSize, maxH)),
        rx: round(clamp(toNumber(raw.rx) ?? 0, 0, DOODLE_LIMITS.maxCornerRadius)),
        fill: pick(DOODLE_FILLS, raw.fill, "none"),
        ...style,
      };
    }
    case "path": {
      if (!Array.isArray(raw.points)) return undefined;
      const points = raw.points
        .slice(0, DOODLE_LIMITS.maxPoints)
        .map(normalizePoint)
        .filter((p): p is [number, number] => p !== undefined);
      if (points.length < DOODLE_LIMITS.minPoints) return undefined;
      return {
        type,
        points,
        closed: raw.closed === true,
        smooth: raw.smooth !== false,
        fill: pick(DOODLE_FILLS, raw.fill, "none"),
        ...strokeStyle(raw),
      };
    }
    default:
      return undefined;
  }
}

export function normalizeDoodleSpec(input: unknown): NormalizeResult<DoodleSpec> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["doodleSpec 必须是对象"] };
  }
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.elements)) {
    return { ok: false, errors: ["doodleSpec.elements 必须是数组"] };
  }
  const warnings: string[] = [];
  if (raw.elements.length > DOODLE_LIMITS.maxElements) {
    warnings.push(`图元数量超过 ${DOODLE_LIMITS.maxElements}，已截断`);
  }
  const elements: DoodleElement[] = [];
  let dropped = 0;
  for (const item of raw.elements.slice(0, DOODLE_LIMITS.maxElements)) {
    const element = normalizeDoodleElement(item);
    if (element) elements.push(element);
    else dropped++;
  }
  if (dropped > 0) warnings.push(`丢弃了 ${dropped} 个不合法的图元`);
  if (elements.length === 0) {
    return { ok: false, errors: ["doodleSpec 不包含任何合法图元"] };
  }
  return {
    ok: true,
    value: { concept: cleanText(raw.concept, DOODLE_LIMITS.concept), elements },
    warnings,
  };
}

/** 提供给 Workers AI JSON 模式的 Schema（扁平结构，兼容对 oneOf 支持有限的模型）。 */
export const DOODLE_JSON_SCHEMA = {
  type: "object",
  properties: {
    concept: { type: "string" },
    elements: {
      type: "array",
      maxItems: DOODLE_LIMITS.maxElements,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...DOODLE_ELEMENT_TYPES] },
          x1: { type: "number" },
          y1: { type: "number" },
          x2: { type: "number" },
          y2: { type: "number" },
          cx: { type: "number" },
          cy: { type: "number" },
          r: { type: "number" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          rx: { type: "number" },
          points: {
            type: "array",
            maxItems: DOODLE_LIMITS.maxPoints,
            items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
          },
          closed: { type: "boolean" },
          stroke: { type: "string", enum: [...DOODLE_STROKES] },
          fill: { type: "string", enum: [...DOODLE_FILLS] },
          width: { type: "number" },
        },
        required: ["type"],
      },
    },
  },
  required: ["concept", "elements"],
} as const;
