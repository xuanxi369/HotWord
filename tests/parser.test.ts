import { beforeAll, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { parseFile } from '../src/parser.worker';
let parse: typeof parseFile;
beforeAll(async () => {
  vi.stubGlobal('self', { postMessage: vi.fn() });
  parse = (await import('../src/parser.worker')).parseFile;
});
describe('文件解析不破坏词组和原文', () => {
  it('UTF-8 BOM 与完整英文词组保留', async () => {
    const output = await parse(new File(['\uFEFFIndustrial Collaboration 产业协同\nChongqing 重庆'], 'conference.txt'));
    expect(output.segments[0].text).toBe('Industrial Collaboration 产业协同\nChongqing 重庆');
  });
  it('CSV 引号内部的逗号和换行不会被拆成错列', async () => {
    const output = await parse(new File(['source,target\n"Mitsui O.S.K. Lines, Ltd.","商船三井"\n"Cross-Border\nCoordination",跨境协调'], 'terms.csv'));
    expect(output.segments[0].rows![1]).toEqual(['Mitsui O.S.K. Lines, Ltd.', '商船三井']);
    expect(output.segments[0].rows![2]).toEqual(['Cross-Border\nCoordination', '跨境协调']);
  });
  it('DOCX 按段落提取完整中英文本', async () => {
    const zip = zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="test"><w:body><w:p><w:r><w:t>Industrial Collaboration 产业协同</w:t></w:r></w:p><w:p><w:r><w:t>长寿 Changshou</w:t></w:r></w:p></w:body></w:document>') });
    const output = await parse(new File([zip as Uint8Array<ArrayBuffer>], 'terms.docx'));
    expect(output.segments[0].text).toBe('Industrial Collaboration 产业协同\n长寿 Changshou\n');
  });
  it('损坏 DOCX、无效类型和大文件明确拒绝', async () => {
    await expect(parse(new File(['not-a-zip'], 'bad.docx'))).rejects.toThrow();
    await expect(parse(new File(['text'], 'bad.exe'))).rejects.toThrow('支持');
    await expect(parse(new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.txt'))).rejects.toThrow('20 MB');
  });
});
