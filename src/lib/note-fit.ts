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
