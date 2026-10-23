import { useCallback, useRef, useState } from "react";
import { charLength } from "../../shared/text.ts";
import { extractTextFromFile, FileImportError, type ExtractResult, type ImportErrorKey } from "../import/extractText.ts";
import { useNoteStore } from "../state/store.ts";

export type ImportState =
  | { kind: "idle" }
  | { kind: "busy"; name: string }
  | { kind: "done"; name: string; result: Omit<ExtractResult, "text">; chars: number }
  | { kind: "error"; name: string; key?: ImportErrorKey };

/**
 * 在浏览器本地把文件解析为原文。由编辑页持有，原文弹窗与页面级拖放共用同一份导入状态，
 * 弹窗关闭期间仍在解析的文件完成后照常写入原文。
 */
export function useFileImport() {
  const setInput = useNoteStore((s) => s.setInput);
  const [importState, setImportState] = useState<ImportState>({ kind: "idle" });
  // 连续导入多个文件时，只采用最后一次导入的结果（较早的大文件可能更晚解析完）
  const importGeneration = useRef(0);

  const importFile = useCallback(
    async (file: File) => {
      const current = ++importGeneration.current;
      setImportState({ kind: "busy", name: file.name });
      try {
        const result = await extractTextFromFile(file);
        if (current !== importGeneration.current) return;
        const { text, ...meta } = result;
        setInput({ text });
        setImportState({ kind: "done", name: file.name, result: meta, chars: charLength(text) });
      } catch (error) {
        if (current !== importGeneration.current) return;
        setImportState({ kind: "error", name: file.name, ...(error instanceof FileImportError ? { key: error.key } : {}) });
      }
    },
    [setInput],
  );

  return { importState, importFile };
}
