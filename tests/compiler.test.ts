import { describe, expect, it } from 'vitest';
import { compileHotwords, compileTranslations, fileText, normalizeTerm, validateExport } from '../shared/compiler';
import { chunkSegments } from '../shared/chunks';
import { importTable } from '../shared/table-import';
import type { Candidate } from '../shared/schema';
const c = (source: string, target = '', patch: Partial<Candidate> = {}): Candidate => ({ id: source, source, target, category: 'industry', priority: 70, basis: 'source', evidence: '', location: '', hot: true, translation: true, pinned: false, ...patch });
describe('用户导入格式回归', () => {
  it('完整词组仅用一个 ASCII 连字符连接，内部连字符和逗号替换为空格', () => {
    const output = compileTranslations([c('Fuzhou High-tech Industrial Development Zone', '福州高新技术产业开发区'), c('Industrial, Collaboration', '产业，协同')]);
    const entries = output.content.split('，');
    expect(entries).toContain('Fuzhou High tech Industrial Development Zone-福州高新技术产业开发区');
    expect(entries).toContain('Industrial Collaboration-产业 协同');
    expect(entries.every(e => e.split('-').length === 2)).toBe(true);
    expect(output.content).not.toContain('Industrial，Collaboration');
  });
  it('Unicode 破折号、负号、不可见字符也不会污染分隔符', () => {
    expect(normalizeTerm(' ＡI—driven\u200b,\n跨−境 ')).toBe('ＡI driven 跨 境');
  });
  it('热词保留中英完整短语，去重，不拆空格', () => {
    const output = compileHotwords([c('Industrial Collaboration', '产业协同'), c('industrial collaboration', '产业协同')]);
    expect(output.count).toBe(2);
    expect(output.content.split('，').some(t => t.toLowerCase() === 'industrial collaboration')).toBe(true);
    expect(output.content).not.toContain('-');
  });
  it('英文大小写和标点归一后发现冲突，并隔离所有冲突映射', () => {
    const output = compileTranslations([c('PV Frame', '光伏边框'), c('pv frame', '光伏支架'), c('Dk', '介电常数')]);
    expect(output.content).toBe('Dk-介电常数');
    expect(output.excluded.filter(e => e.reason.includes('不同译文'))).toHaveLength(2);
  });
  it('双向映射也检查逆向冲突', () => {
    const output = compileTranslations([c('Direct Roving', '直接纱'), c('Single End Roving', '直接纱')], true);
    expect(output.content).toContain('Direct Roving-直接纱');
    expect(output.content).not.toContain('直接纱-');
  });
  it('严格按 UTF-16 计数并包含 BOM 和 CRLF，边界不多出一字符', () => {
    const exact = compileHotwords([c('词'.repeat(2045))]);
    expect(exact.chars).toBe(2048);
    expect(fileText(exact.content).length).toBe(2048);
    const tooLong = compileHotwords([c('词'.repeat(2046))]);
    expect(tooLong.count).toBe(0);
    expect(compileHotwords([c('😀')]).chars).toBe(5);
    const exactTranslation = compileTranslations([c('A'.repeat(20475), 'B')]);
    expect(exactTranslation.chars).toBe(20480);
  });
  it('限长优先实际人名、地名，完整条目取舍并报告原因', () => {
    const output = compileHotwords([c('术'.repeat(2000), '', { priority: 100 }), c('单长乐', '', { category: 'person', priority: 50 }), c('Chongqing', '', { category: 'place' }), ...Array.from({ length: 10 }, (_, i) => c('低优先级术语'.repeat(10) + i, '', { priority: 0 }))]);
    expect(output.content).toContain('单长乐'); expect(output.content).toContain('Chongqing');
    expect(output.chars).toBeLessThanOrEqual(2048);
    expect(output.excluded.length).toBeGreaterThan(0);
    expect(output.content.split('，').every(t => t === '单长乐' || t === 'Chongqing' || t === '术'.repeat(2000) || /^低优先级术语/.test(t))).toBe(true);
  });
  it('必保超过预算时阻止下载，不能悄悄删除', () => {
    const output = compileHotwords([c('甲'.repeat(1500), '', { pinned: true }), c('乙'.repeat(1500), '', { pinned: true })]);
    expect(output.errors).not.toHaveLength(0);
  });
  it('空条目和损坏映射不能导出', () => {
    expect(() => validateExport('Industrial，Collaboration-产业，协同', 'translation')).toThrow();
    expect(() => validateExport('A-B-C', 'translation')).toThrow();
    expect(() => validateExport('A，', 'hot')).toThrow();
    expect(() => validateExport('A,B', 'hot')).toThrow();
  });
  it('未经确认的模型建议译文不会进入热词', () => {
    expect(compileHotwords([c('Direct Roving', '直接纱', { basis: 'suggested', translation: false })]).content).toBe('Direct Roving');
  });
});
describe('原表优先与片段完整性', () => {
  it('保持型号配对和完整斜杠词组，别称标记审核', () => {
    const result = importTable([{ id: 's', label: '导入表', text: '', rows: [['英文','中文'], ['LDK Gen 1','LDK 一代'], ['Fire-Resistant / Protective Fabric','防火防护织物'], ['未知公司','']] }], 0, 1, true);
    expect(result.candidates[0].target).toBe('LDK 一代');
    expect(result.candidates[1].source).toBe('Fire-Resistant / Protective Fabric');
    expect(result.candidates[1].translation).toBe(false);
    expect(result.candidates[2].target).toBe('');
    expect(result.warnings).toHaveLength(2);
  });
  it('分片重建完全等于输入，没有偷偷删掉后半段或断开 emoji', () => {
    const text = 'A'.repeat(9999) + '😀\n' + 'B'.repeat(12000);
    const chunks = chunkSegments([{ id: 's', label: '第 1 页', text }]);
    expect(chunks.map(c => c.text).join('')).toBe(text);
    expect(chunks.every(c => !/[\uD800-\uDBFF]$/.test(c.text))).toBe(true);
  });
  it('大量随机标点条目仍满足两个导入器的语法和预算', () => {
    const candidates = Array.from({ length: 2000 }, (_, i) => c(`Term-${i}, with phrase`, `术—语${i}，对照`, { category: i % 3 ? 'industry' : 'person', priority: i % 100 }));
    const hot = compileHotwords(candidates), translations = compileTranslations(candidates, true);
    expect(() => validateExport(hot.content, 'hot')).not.toThrow();
    expect(() => validateExport(translations.content, 'translation')).not.toThrow();
    expect(fileText(hot.content).length).toBeLessThanOrEqual(2048);
    expect(fileText(translations.content).length).toBeLessThanOrEqual(20480);
  });
  it('短页合并成片段，避免每一页重复调用模型，内容仍保留', () => {
    const chunks = chunkSegments(Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, label: `第 ${i + 1} 页`, text: `本页内容 ${i}` })));
    expect(chunks).toHaveLength(1);
    for (let i = 0; i < 40; i++) expect(chunks[0].text).toContain(`本页内容 ${i}`);
    expect(chunks[0].label).toContain('第 1 页');
    expect(chunks[0].label).toContain('第 40 页');
  });
});
