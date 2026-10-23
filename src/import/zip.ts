import { Unzip, UnzipInflate } from "fflate";

export class ZipEntryTooLargeError extends Error {}
export class NotAZipError extends Error {}

/** 每次送入解压器的压缩数据量：deflate 最高约 1:1032，单步展开量因此有上限。 */
const INPUT_SLICE = 16 * 1024;

/**
 * 以流式方式解压 ZIP 中的单个文件，并在解压出的字节数超过 maxBytes 时立即停止。
 * 不信任 ZIP 头中声明的大小（可以被伪造），按实际输出计数，避免“解压炸弹”占满内存。
 * 找不到该文件时返回 null；数据不是 ZIP 时抛出 NotAZipError。
 */
export function readZipEntry(bytes: Uint8Array, name: string, maxBytes: number): Uint8Array | null {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let sawEntry = false;
  let found = false;
  let finished = false;
  let failure: Error | null = null;

  const unzip = new Unzip((file) => {
    sawEntry = true;
    if (found || file.name !== name) return;
    found = true;
    file.ondata = (error, data, final) => {
      if (failure) return;
      if (error) {
        failure = error;
        return;
      }
      total += data.length;
      if (total > maxBytes) {
        failure = new ZipEntryTooLargeError();
        file.terminate();
        return;
      }
      chunks.push(data);
      if (final) finished = true;
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  for (let offset = 0; offset < bytes.length && !failure && !finished; offset += INPUT_SLICE) {
    const end = Math.min(offset + INPUT_SLICE, bytes.length);
    try {
      unzip.push(bytes.subarray(offset, end), end === bytes.length);
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (failure) throw failure;
  if (!sawEntry) throw new NotAZipError();
  if (!found || !finished) return null;

  const out = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    out.set(chunk, position);
    position += chunk.length;
  }
  return out;
}
