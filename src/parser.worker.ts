import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import Papa from 'papaparse';
import type { ParsedFile, ParsedSegment } from '../shared/schema';

function checkZip(data: Uint8Array) {
  let total = 0;
  // Inspect sizes before decompression, and reject archives over the memory budget.
  unzipSync(data, { filter: entry => {
    total += entry.originalSize;
    if (total > 60 * 1024 * 1024 || entry.originalSize > 30 * 1024 * 1024) throw new Error('压缩文档展开后过大，请拆分文件');
    return false;
  } });
}
function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const object = value as { richText?: { text: string }[]; text?: string; result?: unknown; formula?: string };
  if (object.richText) return object.richText.map(t => t.text).join('');
  if (object.text) return object.text;
  if (object.result != null) return cellText(object.result);
  return '';
}
function decodeText(data: Uint8Array) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { return new TextDecoder('gb18030').decode(data); }
}
export async function parseFile(file: File): Promise<ParsedFile> {
  if (file.size > 20 * 1024 * 1024) throw new Error('单个文件最多 20 MB，请拆分后上传');
  const extension = file.name.split('.').pop()?.toLowerCase();
  const buffer = await file.arrayBuffer(), data = new Uint8Array(buffer);
  const warnings: string[] = [], segments: ParsedSegment[] = [];
  if (extension === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    // Explicitly pass a worker port: PDF.js URL resolution assumes a Window,
    // while this parser itself already runs in a DedicatedWorkerGlobalScope.
    const pdfWorker = new Worker(workerUrl, { type: 'module' });
    pdfjs.GlobalWorkerOptions.workerPort = pdfWorker;
    const task = pdfjs.getDocument({ data, useSystemFonts: true, useWorkerFetch: true,
      cMapUrl: new URL('/pdfjs/cmaps/', self.location.origin).href, cMapPacked: true,
      standardFontDataUrl: new URL('/pdfjs/standard_fonts/', self.location.origin).href,
      wasmUrl: new URL('/pdfjs/wasm/', self.location.origin).href,
    });
    let pdf;
    try {
      pdf = await task.promise;
      if (pdf.numPages > 80) throw new Error('PDF 最多 80 页，请先拆分文件');
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i), content = await page.getTextContent();
        let text = '', previousY: number | undefined;
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const y = item.transform[5];
          if (previousY !== undefined && Math.abs(y - previousY) > 3 && !text.endsWith('\n')) text += '\n';
          text += item.str + (item.hasEOL ? '\n' : ' '); previousY = y;
        }
        if (!text.trim()) warnings.push(`第 ${i} 页没有可提取文字，可能是扫描页；本版不支持 OCR`);
        segments.push({ id: `page-${i}`, label: `第 ${i} 页`, text: text.trim() });
        page.cleanup();
      }
    } finally { await task.destroy().catch(() => {}); pdfWorker.terminate(); }
  } else if (extension === 'xlsx') {
    checkZip(data);
    const { default: readXlsxFile } = await import('read-excel-file/web-worker');
    const sheets = await readXlsxFile(buffer);
    if (sheets.length > 80) throw new Error('工作表数量超过 80，请拆分文件');
    for (const [index, sheet] of sheets.entries()) {
      const rows = sheet.data.map(row => row.map(cellText));
      if (rows.length > 5000 || rows.some(r => r.length > 100)) throw new Error(`工作表 ${sheet.sheet} 超过 5000 行或 100 列，请拆分文件`);
      segments.push({ id: `sheet-${index}`, label: sheet.sheet, rows, text: rows.map(row => row.join('\t')).join('\n') });
    }
  } else if (extension === 'docx') {
    checkZip(data);
    const archive = unzipSync(data, { filter: entry => /^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(entry.name) });
    const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, removeNSPrefix: true });
    const walk = (nodes: Record<string, unknown>[]): string => nodes.map(node => {
      let value = '';
      for (const [key, children] of Object.entries(node)) {
        if (key === '#text') value += String(children);
        else if (key === 'tab') value += '\t';
        else if (key === 'br') value += '\n';
        else if (Array.isArray(children)) value += walk(children as Record<string, unknown>[]) + (key === 'p' || key === 'tr' ? '\n' : key === 'tc' ? '\t' : '');
      }
      return value;
    }).join('');
    if (!archive['word/document.xml']) throw new Error('DOCX 缺少正文或文件已损坏');
    for (const [name, value] of Object.entries(archive)) {
      segments.push({ id: name, label: name.endsWith('document.xml') ? '正文' : name.replace('word/', ''), text: walk(parser.parse(strFromU8(value))) });
    }
  } else if (extension === 'txt' || extension === 'csv') {
    const text = decodeText(data).replace(/^\uFEFF/, '');
    if (extension === 'csv') {
      const result = Papa.parse<string[]>(text, { skipEmptyLines: false });
      if (result.errors.some(e => e.code !== 'UndetectableDelimiter')) throw new Error('CSV 格式有误，请检查引号及分隔符');
      if (result.data.length > 5000) throw new Error('CSV 超过 5000 行，请拆分');
      segments.push({ id: 'csv', label: 'CSV 表格', text: result.data.map(r => r.join('\t')).join('\n'), rows: result.data });
    } else segments.push({ id: 'text', label: '文本正文', text });
  } else throw new Error('支持 PDF、XLSX、DOCX、TXT、CSV 文件');
  if (segments.reduce((n, s) => n + s.text.length, 0) > 1_000_000) throw new Error('提取文字超过 100 万字符，请拆分文件');
  return { name: file.name, kind: extension, segments, warnings };
}

self.onmessage = async (event: MessageEvent<File>) => {
  try { self.postMessage({ ok: true, file: await parseFile(event.data) }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : '文件读取失败' }); }
};
