import { describe, expect, it } from "vitest";
import { decodeTextBytes, docxXmlToText, joinPdfTextItems } from "../src/import/decode.ts";

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
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>列表项</w:t></w:r></w:p>',
      '<w:p><w:del><w:r><w:delText>删除</w:delText></w:r></w:del><w:r><w:t>保留</w:t></w:r></w:p>',
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      "</w:body></w:document>",
    ].join("");
    expect(docxXmlToText(xml)).toBe("标题\nA & B \tC<D\n换行\n- 列表项\n保留\n表格");
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
