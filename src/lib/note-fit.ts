import type { Settings } from "../../shared/settings.ts";

export type FitResult = { status: "ready" | "overflow"; settings: Settings; expanded: boolean };

/** Bounded candidates preserve the author's typography until the page requires smaller text. */
export function fitCandidates(settings: Settings): Settings[] {
  const candidates = [settings];
  if (settings.pageSize === "long") return candidates;
  const minimumLineHeight = Math.min(settings.lineHeight, 1.5);
  let lineHeight = settings.lineHeight;
  while (lineHeight > minimumLineHeight) {
    lineHeight = Math.max(minimumLineHeight, Math.round((lineHeight - 0.1) * 100) / 100);
    candidates.push({ ...settings, lineHeight });
  }
  let fontSize = settings.fontSize;
  while (fontSize > 12) {
    fontSize = Math.max(12, Math.round((fontSize - 0.5) * 100) / 100);
    candidates.push({ ...settings, lineHeight, fontSize });
  }
  return candidates;
}

/**
 * Measure the actual canvas for every accepted candidate. Checking the smallest size first
 * avoids dozens of expensive layouts for a document that can only fit on a long page.
 */
export function fitNote(settings: Settings, fits: (candidate: Settings) => boolean): FitResult {
  const candidates = fitCandidates(settings);
  if (fits(settings)) return { status: "ready", settings, expanded: false };
  const smallest = candidates[candidates.length - 1];
  if (candidates.length > 1 && fits(smallest)) {
    let low = 1;
    let high = candidates.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (fits(candidates[middle])) high = middle;
      else low = middle + 1;
    }
    // Restore the chosen DOM after the final binary-search measurement.
    if (fits(candidates[low])) return { status: "ready", settings: candidates[low], expanded: false };
  }
  if (settings.pageSize !== "long" && settings.overflow === "expand") {
    const expanded = { ...settings, pageSize: "long" as const };
    return { status: fits(expanded) ? "ready" : "overflow", settings: expanded, expanded: true };
  }
  fits(smallest);
  return { status: "overflow", settings: smallest, expanded: false };
}

/**
 * Detect a short final line before forcing nowrap. Handwriting jitter creates
 * multiple inline rectangles per visual line, so merge by vertical position.
 */
function hasOrphanedTitleLine(title: HTMLElement, text: HTMLElement, baseSize: number): boolean {
  const fragments = Array.from(text.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom));
  const lines: { center: number; left: number; right: number }[] = [];
  // getClientRects() reports rendered coordinates, but font-size is measured
  // in unscaled CSS pixels. Match units under the preview's transform scale.
  const layoutWidth = title.offsetWidth;
  const previewScale = layoutWidth > 0 ? title.getBoundingClientRect().width / layoutWidth : 1;
  const sameLineTolerance = baseSize * 0.4 * previewScale;
  for (const rect of fragments) {
    const center = (rect.top + rect.bottom) / 2;
    let line = lines.find((candidate) => Math.abs(candidate.center - center) < sameLineTolerance);
    if (!line) {
      line = { center, left: rect.left, right: rect.right };
      lines.push(line);
    } else {
      line.left = Math.min(line.left, rect.left);
      line.right = Math.max(line.right, rect.right);
    }
  }
  if (lines.length !== 2) return false;
  const first = lines[0].right - lines[0].left;
  const last = lines[1].right - lines[1].left;
  const available = title.getBoundingClientRect().width;
  // Do not shrink balanced two-line titles just because they could fit on one.
  return available > 0 && first > 0 && last < available * 0.35 && last < first * 0.5;
}

/**
 * Keep near-fitting titles on one line only if the natural wrap leaves a short
 * orphan. The selected inline font size survives the export clone.
 */
export function fitNoteTitle(page: HTMLElement): void {
  const title = page.querySelector<HTMLElement>(".note-title");
  if (!title) return;
  // Re-measure from authored typography for every page-fit candidate.
  title.style.removeProperty("font-size");
  const baseSize = Number.parseFloat(getComputedStyle(title).fontSize);
  if (!Number.isFinite(baseSize) || baseSize <= 0) return;

  const previousWhiteSpace = title.style.whiteSpace;
  const previousTextAlign = title.style.textAlign;
  const previousTransform = title.style.transform;
  let keepSize = false;
  try {
    // A centered title may overflow in *both* directions; scrollWidth alone
    // can miss the overflow on the left. Measure at the natural left edge.
    // Disable decorative rotation only while taking subpixel measurements.
    // Keep natural wrapping while looking for an orphan; neither left alignment
    // nor removing decorative rotation changes where the line breaks occur.
    title.style.textAlign = "left";
    title.style.transform = "none";
    const text = title.querySelector<HTMLElement>("[data-fit-text]");
    if (!text || !hasOrphanedTitleLine(title, text, baseSize)) return;

    title.style.whiteSpace = "nowrap";
    const fits = () => {
      const width = title.getBoundingClientRect().width;
      // The epsilon absorbs arithmetic noise, not an actual CSS-pixel gap.
      return width > 0 && text.getBoundingClientRect().width <= width + 1e-7;
    };
    if (fits()) return;

    const minimumSize = baseSize * 0.8;
    title.style.fontSize = `${minimumSize}px`;
    // Never reject an exact 80% fit based on a safety margin or a ratio.
    if (!fits()) return;

    // Flex siblings may resize as the heading shrinks. Binary-search the
    // *measured* fit, always remembering a size that actually fit.
    let fittingSize = minimumSize;
    let overflowingSize = baseSize;
    for (let pass = 0; pass < 9; pass++) {
      const candidate = (fittingSize + overflowingSize) / 2;
      title.style.fontSize = `${candidate}px`;
      if (fits()) fittingSize = candidate;
      else overflowingSize = candidate;
    }
    title.style.fontSize = `${fittingSize}px`;
    keepSize = fits();
  } finally {
    if (!keepSize) title.style.removeProperty("font-size");
    title.style.whiteSpace = previousWhiteSpace;
    title.style.textAlign = previousTextAlign;
    title.style.transform = previousTransform;
  }
}
/** Both axes matter: a fixed-height multicolumn layout can overflow into hidden columns. */
export function measureNoteOverflow(page: HTMLElement): boolean {
  const regions = [...page.querySelectorAll<HTMLElement>("[data-fit]")];
  if (regions.some((region) => {
    const style = getComputedStyle(region);
    return (style.overflowY !== "visible" && region.scrollHeight > region.clientHeight + 2)
      || (style.overflowX !== "visible" && region.scrollWidth > region.clientWidth + 2);
  })) return true;

  // Long pages let handwriting rotate into the paper's padding. Its scroll extent may be
  // slightly larger than a visible region without clipping a single glyph. Check the actual
  // text against the paper instead. Decorative tape and stickers may intentionally straddle
  // an edge and must not force an unnecessary expansion or block a complete text export.
  const bounds = page.getBoundingClientRect();
  const tolerance = 2 * (bounds.width / page.offsetWidth || 1);
  return [...page.querySelectorAll<HTMLElement>("[data-fit-text]")].some((text) =>
    [...text.getClientRects()].some((rect) => rect.left < bounds.left - tolerance
      || rect.right > bounds.right + tolerance
      || rect.top < bounds.top - tolerance
      || rect.bottom > bounds.bottom + tolerance),
  );
}
