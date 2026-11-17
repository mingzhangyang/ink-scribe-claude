import { DIAGRAM_LIMITS, validDiagramBlocks, type DiagramBlock, type DiagramTemplate } from "../../shared/diagram.ts";
import type { NoteStructure } from "../../shared/note.ts";
import { cleanText } from "../../shared/text.ts";

/**
 * D2 authoring commands. Each is a pure, validated change to NoteStructure:
 * previews, local drafts, publishing and future D3 history all see the same data.
 */
export function newTemplateDiagram(template: DiagramTemplate, afterSection: number): DiagramBlock {
  switch (template) {
    case "inclined-plane":
      return { afterSection, template, params: { thetaDeg: 30, friction: false } };
    case "right-triangle":
      return { afterSection, template, params: { legRatio: 0.65 } };
    case "number-line":
      return { afterSection, template, params: { start: -5, end: 5, step: 1 } };
    case "coordinate-plane":
      return { afterSection, template, params: { grid: true, quadrants: "all" } };
  }
}

export function insertDiagram(note: NoteStructure, section: number, template: DiagramTemplate): NoteStructure {
  if (!Number.isSafeInteger(section) || section < 0 || section >= note.sections.length
    || (note.diagrams?.length ?? 0) >= DIAGRAM_LIMITS.maxBlocks) return note;
  const diagrams = [...(note.diagrams ?? []), newTemplateDiagram(template, section)];
  return validDiagramBlocks(diagrams, note.sections.length) ? { ...note, diagrams } : note;
}

export function editDiagram(
  note: NoteStructure,
  index: number,
  transform: (diagram: DiagramBlock) => DiagramBlock,
): NoteStructure {
  const existing = note.diagrams?.[index];
  if (!existing || !Number.isSafeInteger(index)) return note;
  const updated = transform(existing);
  // Parameter edits cannot silently move an existing diagram into another section.
  if (updated.afterSection !== existing.afterSection) return note;
  const diagrams = note.diagrams!.map((diagram, i) => i === index ? updated : diagram);
  return validDiagramBlocks(diagrams, note.sections.length) ? { ...note, diagrams } : note;
}

export function updateTemplateParams<T extends DiagramTemplate>(
  note: NoteStructure, index: number, template: T,
  patch: Partial<Extract<DiagramBlock, { template: T }>["params"]>,
): NoteStructure {
  return editDiagram(note, index, (block) => {
    if (block.template !== template) return block;
    return { ...block, params: { ...block.params, ...patch } } as DiagramBlock;
  });
}

export function setDiagramCaption(note: NoteStructure, index: number, raw: string): NoteStructure {
  const caption = cleanText(raw, DIAGRAM_LIMITS.maxCaption);
  return editDiagram(note, index, (diagram) => ({ ...diagram, caption }));
}

export function removeDiagram(note: NoteStructure, index: number): NoteStructure {
  if (!Number.isSafeInteger(index) || !note.diagrams?.[index]) return note;
  const diagrams = note.diagrams.filter((_, i) => i !== index);
  if (diagrams.length) return { ...note, diagrams };
  // Preserve the legacy absent-field shape when the final diagram is deleted.
  const next = { ...note };
  delete next.diagrams;
  return next;
}

export function reorderSection(note: NoteStructure, index: number, delta: number): NoteStructure {
  const target = index + delta;
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(delta)
    || index < 0 || target < 0 || target >= note.sections.length) return note;
  const sections = [...note.sections];
  [sections[index], sections[target]] = [sections[target], sections[index]];
  const diagrams = note.diagrams?.map((diagram) => ({
    ...diagram,
    afterSection: diagram.afterSection === index ? target
      : diagram.afterSection === target ? index : diagram.afterSection,
  }));
  return { ...note, sections, ...(diagrams ? { diagrams } : {}) };
}

export function removeSection(note: NoteStructure, index: number): NoteStructure {
  if (!Number.isSafeInteger(index) || index < 0 || index >= note.sections.length
    || note.sections.length <= 1) return note;
  const sections = note.sections.filter((_, i) => i !== index);
  const diagrams = note.diagrams?.filter((diagram) => diagram.afterSection !== index).map((diagram) => ({
    ...diagram, afterSection: diagram.afterSection > index ? diagram.afterSection - 1 : diagram.afterSection,
  }));
  const result = { ...note, sections, ...(diagrams ? { diagrams } : {}) };
  if (result.diagrams?.length === 0) delete result.diagrams;
  return result;
}
