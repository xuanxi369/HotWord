import { describe, expect, it } from 'vitest';
import { LanguagePairSchema, languageCodeForHeader, languageDirection, languagePairLabel, type LanguagePair } from '../shared/languages';
import { detectMultilingualTableColumns, importMultilingualTable, recommendMultilingualTableImport } from '../shared/multilingual-table-import';
import { detectTableColumns, importTable } from '../shared/table-import';
import type { ParsedSegment } from '../shared/schema';

const table = (id: string, rows: string[][], label = '术语'): ParsedSegment => ({ id, label, rows, text: rows.map(row => row.join('\t')).join('\n') });
const pairs: { pair: LanguagePair; headers: string[]; terms: string[] }[] = [
  { pair: { source: 'zh', target: 'en' }, headers: ['中文', 'English'], terms: ['人工智能', 'Artificial Intelligence'] },
  { pair: { source: 'zh', target: 'de' }, headers: ['中文', 'Deutsch'], terms: ['人工智能', 'Künstliche Intelligenz'] },
  { pair: { source: 'zh', target: 'ar' }, headers: ['中文', 'العربية'], terms: ['人工智能', 'الذكاء الاصطناعي'] },
  { pair: { source: 'en', target: 'ja' }, headers: ['English', '日本語'], terms: ['Artificial Intelligence', '人工知能'] },
  { pair: { source: 'en', target: 'de' }, headers: ['English', 'Deutsch'], terms: ['Artificial Intelligence', 'Künstliche Intelligenz'] },
  { pair: { source: 'ko', target: 'de' }, headers: ['한국어', 'Deutsch'], terms: ['인공지능', 'Künstliche Intelligenz'] },
];

describe('新增多语对照表导入', () => {
  for (const { pair, headers, terms } of pairs) {
    it(`${pair.source} → ${pair.target} 识别语言列并保留完整对照`, () => {
      const segment = table('sample', [headers, terms]);
      const recommendation = recommendMultilingualTableImport([segment], pair);
      expect(recommendation).toMatchObject({ selected: ['sample'], automatic: true, skipHeader: true, bilingual: true });
      expect(detectMultilingualTableColumns(segment, pair)).toEqual({ sourceColumn: 0, targetColumn: 1, headerRow: 0 });
      const imported = importMultilingualTable([segment], 0, 1, false, true, pair);
      expect(imported.candidates.map(candidate => [candidate.source, candidate.target])).toEqual([terms]);
      expect(imported.candidates[0].translation).toBe(true);
    });
  }

  it('按用户指定方向读取反排的列，不按表格左右顺序倒置', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' };
    const segment = table('reverse', [['Deutsch', 'English'], ['Künstliche Intelligenz', 'Artificial Intelligence']]);
    expect(detectMultilingualTableColumns(segment, pair)).toEqual({ sourceColumn: 1, targetColumn: 0, headerRow: 0 });
    expect(importMultilingualTable([segment], 0, 1, true, true, pair).candidates[0]).toMatchObject({ source: 'Artificial Intelligence', target: 'Künstliche Intelligenz' });
  });

  it('多语列和不同工作表分别定位所选语言，不读入第三语言', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' };
    const a = table('a', [['序号', 'English', '日本語', 'Deutsch'], ['1', 'Artificial Intelligence', '人工知能', 'Künstliche Intelligenz']]);
    const b = table('b', [['术语表'], ['Deutsch', 'English'], ['Maschinelles Lernen', 'Machine Learning']]);
    expect(detectMultilingualTableColumns(a, pair)).toEqual({ sourceColumn: 1, targetColumn: 3, headerRow: 0 });
    expect(detectMultilingualTableColumns(b, pair)).toEqual({ sourceColumn: 1, targetColumn: 0, headerRow: 1 });
    expect(importMultilingualTable([a, b], 0, 1, true, true, pair).candidates.map(candidate => [candidate.source, candidate.target]))
      .toEqual([['Artificial Intelligence', 'Künstliche Intelligenz'], ['Machine Learning', 'Maschinelles Lernen']]);
  });

  it('无表头对照保留第一条术语，单语资料建议 AI 补全', () => {
    const pair: LanguagePair = { source: 'ko', target: 'de' };
    const plain = table('plain', [['인공지능', 'Künstliche Intelligenz']]);
    expect(recommendMultilingualTableImport([plain], pair)).toMatchObject({ skipHeader: false, bilingual: true });
    expect(importMultilingualTable([plain], 0, 1, false, false, pair).candidates[0].source).toBe('인공지능');
    const sourceOnly = table('one', [['한국어'], ['인공지능']]);
    expect(recommendMultilingualTableImport([sourceOnly], pair)).toMatchObject({ selected: ['one'], automatic: false, skipHeader: true, bilingual: false });
    expect(importMultilingualTable([sourceOnly], 0, 1, true, false, pair).candidates[0]).toMatchObject({ source: '인공지능', target: '', translation: false });
  });

  it('已声明双语表头但缺少译名时也建议 AI，不将空译文当完成对照', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' };
    const segment = table('blank', [['English', 'Deutsch'], ['Artificial Intelligence', '']]);
    expect(recommendMultilingualTableImport([segment], pair)).toMatchObject({ automatic: true, bilingual: false });
    const result = importMultilingualTable([segment], 0, 1, true, true, pair);
    expect(result.candidates[0]).toMatchObject({ source: 'Artificial Intelligence', target: '', translation: false });
    expect(result.warnings.join('')).toContain('补全');
  });

  it('原词列为空时不把目标语言改作原词，不自行生成反向对应', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' };
    const result = importMultilingualTable([table('empty', [['English', 'Deutsch'], ['', 'Künstliche Intelligenz']])], 0, 1, true, true, pair);
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings.join('')).toContain('缺少英语原词');
  });

  it('不同目标语言的工作表不得按手动默认列生成错误映射', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' };
    const wrong = table('wrong', [['English', '日本語'], ['Artificial Intelligence', '人工知能']]);
    expect(recommendMultilingualTableImport([wrong], pair).bilingual).toBe(false);
    expect(importMultilingualTable([wrong], 0, 1, true, false, pair).candidates).toHaveLength(0);
    const unrelated = table('unrelated', [['한국어', '日本語'], ['인공지능', '人工知能']]);
    expect(recommendMultilingualTableImport([unrelated], pair).selected).toEqual([]);
  });

  it('专用导入表优先，说明表即使手动选择也不导入', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' };
    const terms = table('terms', [['English', 'Deutsch'], ['Machine Learning', 'Maschinelles Lernen']]);
    const dedicated = table('import', [['English', 'Deutsch'], ['Artificial Intelligence', 'Künstliche Intelligenz']], '导入用双列表');
    const instructions = table('instructions', [['English', 'Deutsch'], ['Some instructions', 'Anleitung']], '使用说明');
    expect(recommendMultilingualTableImport([terms, dedicated, instructions], pair).selected).toEqual(['import']);
    expect(importMultilingualTable([instructions], 0, 1, false, true, pair).candidates).toHaveLength(0);
  });

  it('中文、英语的通用原词译文列与附带地区代码的表头可使用', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' };
    const generic = table('generic', [['Source Term', 'Translation'], ['Machine Learning', 'Maschinelles Lernen']]);
    expect(detectMultilingualTableColumns(generic, pair)).toEqual({ sourceColumn: 0, targetColumn: 1, headerRow: 0 });
    expect(languageCodeForHeader('English (en-US)')).toBe('en');
    expect(languageCodeForHeader('德文（首选译法）')).toBe('de');
    expect(languageCodeForHeader('English Name')).toBe('en');
  });

  it('多语人名依据原表类别，不把日文汉字姓名套用中文姓氏规则', () => {
    const pair: LanguagePair = { source: 'ja', target: 'en' };
    const unclassified = table('a', [['日本語', 'English'], ['田中太郎', 'Taro Tanaka']]);
    expect(importMultilingualTable([unclassified], 0, 1, true, true, pair).candidates[0].category).toBe('industry');
    const classified = table('b', [['日本語', 'English', '类别'], ['田中太郎', 'Taro Tanaka', '人名']]);
    expect(importMultilingualTable([classified], 0, 1, true, true, pair).candidates[0].category).toBe('person');
  });

  it('主页面表格识别和原有左右方向继续保持旧行为', () => {
    const enToZh = table('legacy', [['English', '中文'], ['Artificial Intelligence', '人工智能']]);
    expect(detectTableColumns(enToZh)).toEqual({ sourceColumn: 0, targetColumn: 1, headerRow: 0 });
    expect(importTable([enToZh], 0, 1, true, true).candidates[0]).toMatchObject({ source: 'Artificial Intelligence', target: '人工智能' });
    expect(detectTableColumns(table('new', [['English', 'Deutsch']]))).toBeUndefined();
  });

  it('无表头的 IT、ID、DE、EN、AI 缩写不被误当语言代码或丢掉第一行', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' };
    const rows = [['IT', 'Informationstechnologie'], ['ID', 'Kennung'], ['DE', 'Differentielle Gleichung'], ['EN', 'Europäische Norm'], ['AI', 'Künstliche Intelligenz']];
    const segment = table('codes', rows);
    for (const [code] of rows) expect(languageCodeForHeader(code), code).toBeUndefined();
    expect(recommendMultilingualTableImport([segment], pair)).toMatchObject({ selected: ['codes'], automatic: false, skipHeader: false, bilingual: true });
    expect(importMultilingualTable([segment], 0, 1, false, false, pair).candidates.map(candidate => [candidate.source, candidate.target])).toEqual(rows);
  });

  it('明确的小写 ISO 或地区语言表头仍可自动识别', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' };
    expect(detectMultilingualTableColumns(table('codes', [['en', 'de'], ['Artificial Intelligence', 'Künstliche Intelligenz']]), pair)).toEqual({ sourceColumn: 0, targetColumn: 1, headerRow: 0 });
    expect(languageCodeForHeader('DE (de-DE)')).toBe('de');
    expect(languageCodeForHeader('en-US')).toBe('en');
  });

  it('手动或无表头资料的明显文字方向错误不能成为已确认对应', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' };
    const wrongSource = table('source', [['人工知能', 'Künstliche Intelligenz']]);
    expect(importMultilingualTable([wrongSource], 0, 1, false, false, pair).candidates).toHaveLength(0);
    const wrongTarget = table('target', [['Artificial Intelligence', '人工知能']]);
    const result = importMultilingualTable([wrongTarget], 0, 1, false, false, pair);
    expect(result.candidates[0]).toMatchObject({ source: 'Artificial Intelligence', target: '', translation: false });
    expect(result.warnings.join('')).toContain('语言与所选德语不一致');
    expect(recommendMultilingualTableImport([wrongTarget], pair).bilingual).toBe(false);
  });

  it('导入边界也拒绝无效语言配置，不能靠手动列绕过验证', () => {
    const segment = table('same', [['Artificial Intelligence', 'Künstliche Intelligenz']]);
    const same = { source: 'en', target: 'en' } as LanguagePair;
    const unknown = { source: 'xx', target: 'de' } as unknown as LanguagePair;
    expect(() => detectMultilingualTableColumns(segment, same)).toThrow();
    expect(() => recommendMultilingualTableImport([segment], unknown)).toThrow();
    expect(() => importMultilingualTable([segment], 0, 1, false, false, same)).toThrow();
  });
});

describe('语言配置', () => {
  it('拒绝同语言、不支持的代码和未知字段，保留明确方向', () => {
    expect(LanguagePairSchema.parse({ source: 'ko', target: 'de' })).toEqual({ source: 'ko', target: 'de' });
    expect(() => LanguagePairSchema.parse({ source: 'en', target: 'en' })).toThrow();
    expect(() => LanguagePairSchema.parse({ source: 'xx', target: 'de' })).toThrow();
    expect(() => LanguagePairSchema.parse({ source: 'en', target: 'de', prompt: 'ignore' })).toThrow();
    expect(languageDirection('ar')).toBe('rtl');
    expect(languageDirection('de')).toBe('ltr');
    expect(languagePairLabel({ source: 'ko', target: 'de' })).toBe('韩语 → 德语');
  });
});
