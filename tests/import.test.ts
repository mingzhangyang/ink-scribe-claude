import { describe, expect, it } from "vitest";
import { decodeTextBytes, docxXmlToText, joinPdfTextItems } from "../src/import/decode.ts";
import { strFromU8, strToU8, zipSync } from "fflate";
import { readZipEntry, ZipEntryTooLargeError } from "../src/import/zip.ts";

describe("decodeTextBytes", () => {
  it("handles UTF-8 with and without BOM, UTF-16 and GBK", () => {
    const utf8 = new TextEncoder().encode("中文 text");
    expect(decodeTextBytes(utf8)).toBe("中文 text");
    expect(decodeTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe("中文 text");
    expect(decodeTextBytes(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]))).toBe("中文");
    // “中文”的 GBK 编码，常见于 Windows 记事本保存的文本
    expect(decodeTextBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toBe("中文");
  });
});

describe("docxXmlToText", () => {
  it("extracts paragraphs, tabs, breaks, list items and entities while skipping deletions", () => {
    const xml = [
      '<w:document><w:body>',
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>',
      '<w:p><w:r><w:t xml:space="preserve">A &amp; B </w:t></w:r><w:r><w:tab/><w:t>C&lt;D</w:t></w:r><w:r><w:br/><w:t>换行</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>甲</w:t><w:tab /><w:t>乙</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>列表项</w:t></w:r></w:p>',
      '<w:p><w:del><w:r><w:delText>删除</w:delText></w:r></w:del><w:r><w:t>保留</w:t></w:r></w:p>',
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      "</w:body></w:document>",
    ].join("");
    expect(docxXmlToText(xml)).toBe("标题\nA & B \tC<D\n换行\n甲\t乙\n- 列表项\n保留\n表格");
  });

  it("ignores tab-stop definitions and keeps nested text-box paragraphs", () => {
    const xml =
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>外层</w:t></w:r>' +
      "<w:r><w:txbxContent><w:p><w:r><w:t>文本框</w:t></w:r></w:p></w:txbxContent></w:r><w:r><w:t>续</w:t></w:r></w:p>";
    expect(docxXmlToText(xml)).toBe("文本框\n外层续");
  });

  it("handles unclosed paragraphs in linear time", () => {
    expect(docxXmlToText("<w:p><w:r><w:t>甲</w:t></w:r><w:p><w:r><w:t>乙</w:t>")).toBe("甲\n乙");
    const malformed = "<w:p><w:r><w:t>x</w:t></w:r>".repeat(50_000);
    const started = performance.now();
    expect(docxXmlToText(malformed).length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("joinPdfTextItems", () => {
  it("joins wrapped Chinese and English lines but keeps paragraph and list breaks", () => {
    const items = [
      { str: "深度工作是在无干扰状态下进行的", hasEOL: true },
      { str: "专业活动。", hasEOL: true },
      { str: "Spaced repetition is", hasEOL: true },
      { str: "effective.", hasEOL: true },
      { str: "1. 第一条", hasEOL: true },
      { str: "2. 第二条", hasEOL: false },
    ];
    expect(joinPdfTextItems(items)).toBe("深度工作是在无干扰状态下进行的专业活动。\nSpaced repetition is effective.\n1. 第一条\n2. 第二条");
  });
});

describe("readZipEntry", () => {
  const archive = (entries: Record<string, Uint8Array>) => zipSync(entries, { level: 9 });

  it("extracts the requested entry", () => {
    const zip = archive({ "word/styles.xml": strToU8("<styles/>"), "word/document.xml": strToU8("<w:document>正文</w:document>") });
    expect(strFromU8(readZipEntry(zip, "word/document.xml", 1024)!)).toBe("<w:document>正文</w:document>");
  });

  it("returns null when the entry is missing", () => {
    expect(readZipEntry(archive({ "a.txt": strToU8("a") }), "word/document.xml", 1024)).toBeNull();
  });

  it("stops once the expanded size exceeds the budget", () => {
    // 4MB 的重复内容压缩后只有几 KB
    const zip = archive({ "word/document.xml": new Uint8Array(4 * 1024 * 1024).fill(0x61) });
    expect(zip.length).toBeLessThan(64 * 1024);
    expect(() => readZipEntry(zip, "word/document.xml", 1024 * 1024)).toThrow(ZipEntryTooLargeError);
  });

  it("rejects data that is not a zip archive", () => {
    expect(() => readZipEntry(strToU8("just some text, not a zip"), "word/document.xml", 1024)).toThrow();
  });
});
