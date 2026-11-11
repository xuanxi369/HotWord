import { describe, expect, it } from 'vitest';
import { compileHotwords, compileTranslations, validateExport } from '../shared/compiler';
import { detectTableColumns, importTable, recommendTableImport } from '../shared/table-import';
import { termIssue } from '../shared/term-quality';
import { validateModelResult } from '../server/ai';
import type { Candidate, ParsedSegment } from '../shared/schema';

const term = (source: string, target = '', patch: Partial<Candidate> = {}): Candidate => ({ id: source, source, target, category: 'industry', priority: 70, basis: 'source', evidence: '', location: '测试', hot: true, translation: !!target, pinned: false, ...patch });
const table = (id: string, label: string, rows: string[][]): ParsedSegment => ({ id, label, rows, text: rows.map(r => r.join('\t')).join('\n') });

describe('真实污染类型的内容防线', () => {
  it('旧审核项目中的数字、标题、占位与说明不会再次导出', () => {
    const bad = ['21', '53', '2026-11-08', '专有名词', '待确认', '① 客户官方物料 → ② 客户官网中英对照', '1）收齐主讲PPT与致辞稿', '公司名只能用官方全称；详见 07 译法红线。', '01 核心产品｜02 工艺与装备｜03 应用领域', '行业盛会即将拉开帷幕', 'An industry gathering focused on the frontier trends of composite materials is about to kick off.', '携手聚力，共赢新未来', '创新复合材料，引领绿色未来', '共谋合作新篇', '实现巴西、巴林海外基地国际化布局'];
    const valid = term('LDK Gen 2 Yarn', '超低介电电子级玻璃纤维纱');
    const hot = compileHotwords([...bad.map(s => term(s, '说明内容')), valid]);
    expect(hot.content.split('，')).toEqual(expect.arrayContaining([valid.source, valid.target]));
    expect(hot.count).toBe(2);
    expect(hot.excluded).toHaveLength(bad.length);
    const translations = compileTranslations([...bad.map(s => term(s, '说明内容')), valid]);
    expect(translations.content).toBe(`${valid.source}-${valid.target}`);
    expect(translations.excluded).toHaveLength(bad.length);
  });
  it('数字技术名称、机构全称、斜杠别称与长技术短语不能被误删', () => {
    const valid = ['5G', '5G-A', 'LDK Gen 2 Yarn', 'TM+ Glass', 'T700', '301526.SZ', 'Yuntianhua Group Co., Ltd.', 'Chongqing Polycomp International Corporation', 'Glass Fiber / Fiberglass', 'Advanced IC Substrate / Package Substrate', 'Complete Glass Fiber Production Technology and Equipment', '𠀀', '低介电电子级玻璃纤维', '2026 CPIC Customer Conference', '应用开发', '需求管理', '请柬', 'US Advanced Composite Materials Research and Development Center'];
    for (const value of valid) expect(termIssue(value), value).toBeUndefined();
    const output = compileHotwords(valid.map(s => term(s)));
    expect(output.count).toBe(valid.length);
    expect(output.excluded).toHaveLength(0);
  });
  it('合法原词搭配说明性译文时仅保留原词，不导出错误映射', () => {
    const c = term('Direct Roving', '请按客户官网确认译名');
    expect(compileHotwords([c]).content).toBe('Direct Roving');
    expect(compileTranslations([c]).count).toBe(0);
  });
  it('错误数字列不会因另一列是技术术语而生成数字映射', () => {
    const output = compileHotwords([term('21', 'Direct Roving')]);
    expect(output.count).toBe(0);
    expect(compileTranslations([term('21', 'Direct Roving')]).count).toBe(0);
  });
  it('必保的污染项必须报告错误，不能悄悄丢弃后下载', () => {
    expect(compileHotwords([term('21', '', { pinned: true })]).errors.join('')).toContain('非术语');
    expect(compileTranslations([term('Direct Roving', '待确认', { pinned: true })]).errors.join('')).toContain('非术语');
  });
  it('最终导出校验也会拒绝绕过编译器的数字与说明', () => {
    expect(() => validateExport('21，Direct Roving', 'hot')).toThrow('非术语');
    expect(() => validateExport('21-Direct Roving', 'translation')).toThrow('非术语');
    expect(() => validateExport('Direct Roving-请按客户官网确认译名', 'translation')).toThrow('非术语');
  });
});

describe('多工作表必须识别真实双语列', () => {
  const products = table('products', '01 核心产品', [['核心产品术语表'], ['序号', '子类', '中文', '英文（首选译法）', '备注'], ['21', '玻纤', '直接纱', 'Direct Roving', '需核对客户现场译法']]);
  const materials = table('materials', '02 材料', [['原词', '译文'], ['低介电纱', 'Low Dk Yarn']]);
  const instructions = table('notes', '00 使用说明', [['项目', '内容'], ['会前建议动作', '1）收齐主讲PPT与致辞稿']]);
  const redlines = table('redlines', '07 译法红线', [['序号', '类别', '避免这样写', '建议这样写 / 原因说明'], ['1', '公司名', 'Wrong Company Name', '请用客户正式名称']]);
  const dedicated = table('import', '08 导入用双列表', [['中文 (zh-CN)', 'English (en-US)'], ['直接纱', 'Direct Roving'], ['5G 通信', '5G Communications']]);

  it('有专用双列表时只默认选该表，避免说明与重复导入', () => {
    const recommendation = recommendTableImport([instructions, products, materials, redlines, dedicated]);
    expect(recommendation).toMatchObject({ selected: ['import'], automatic: true, sourceColumn: 0, targetColumn: 1, skipHeader: true });
    const result = importTable([dedicated], 0, 1, true, true);
    expect(result.candidates.map(c => [c.source, c.target])).toEqual([['直接纱', 'Direct Roving'], ['5G 通信', '5G Communications']]);
  });
  it('没有专用表时选双语术语表，并分别使用各自的列和表头位置', () => {
    expect(recommendTableImport([instructions, products, materials, redlines]).selected).toEqual(['products', 'materials']);
    expect(detectTableColumns(products)).toEqual({ sourceColumn: 2, targetColumn: 3, headerRow: 1 });
    expect(importTable([products, materials], 0, 1, true, true).candidates.map(c => [c.source, c.target])).toEqual([['直接纱', 'Direct Roving'], ['低介电纱', 'Low Dk Yarn']]);
  });
  it('用户取消跳过表头，也不会把中文和English导入成词条', () => {
    expect(importTable([dedicated], 0, 1, false, true).candidates).toHaveLength(2);
  });
  it('手动勾选说明/红线表也不能把错误写法当作正式术语', () => {
    const result = importTable([instructions, redlines], 0, 1, false, true);
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings).toHaveLength(2);
  });
  it('手动选错序号列时隔离数字，并提示核对列', () => {
    const result = importTable([products], 0, 1, true);
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings.join('')).toContain('核对术语列');
  });
  it('无表头的简单对照表不默认跳过第一条术语', () => {
    const plain = table('plain', 'CSV 表格', [['Direct Roving', '直接纱']]);
    const recommendation = recommendTableImport([plain]);
    expect(recommendation.skipHeader).toBe(false);
    expect(importTable([plain], 0, 1, recommendation.skipHeader).candidates[0].source).toBe('Direct Roving');
  });
});

describe('模型有原文证据也必须通过术语质量检查', () => {
  it('真实出现的编号与说明句仍被排除', () => {
    const sources = ['21', '待确认', '请把本表另存为CSV后导入', 'An industry gathering is about to kick off.', 'LDK Gen 2 Yarn'];
    const terms = sources.map(source => ({ source, target: '', category: 'industry', priority: 80, basis: 'none', evidence: source }));
    const result = validateModelResult({ terms }, sources.join('\n'), '文档', 'test');
    expect(result.candidates.map(c => c.source)).toEqual(['LDK Gen 2 Yarn']);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('模型把说明当译文时保留技术原词并清空译文', () => {
    const evidence = 'Direct Roving 请按客户官网确认译名';
    const result = validateModelResult({ terms: [{ source: 'Direct Roving', target: '请按客户官网确认译名', category: 'industry', priority: 80, basis: 'source', evidence }] }, evidence, '文档', 'test');
    expect(result.candidates[0]).toMatchObject({ source: 'Direct Roving', target: '', translation: false });
  });
});
