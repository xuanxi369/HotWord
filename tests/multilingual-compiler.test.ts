import { describe, expect, it } from 'vitest';
import { compileHotwords, compileTranslations, fileText, validateExport } from '../shared/compiler';
import { compileMultilingualHotwords, compileMultilingualTranslations } from '../shared/multilingual-compiler';
import { multilingualLanguageIssue, multilingualTermIssue } from '../shared/multilingual-quality';
import { termIssue } from '../shared/term-quality';
import type { Candidate } from '../shared/schema';

const term = (source: string, target = '', patch: Partial<Candidate> = {}): Candidate => ({ id: source, source, target, category: 'industry', priority: 70, basis: 'source', evidence: '', location: '', hot: true, translation: !!target, pinned: false, ...patch });

describe('多语内容检查只作用于新增模式', () => {
  it('拒绝各语言表头、占位和 Unicode 独立数字，保留真正带数字的名称', () => {
    for (const bad of ['Deutsch', '한국어', '日本語', 'العربية', '德语', 'English Name', '١٢٣', '１２３', '١٢/٣٤', 'nicht angegeben', '要確認', '확인 필요', 'غير متوفر', 'Fachbegriffe']) expect(multilingualTermIssue(bad), bad).toBeDefined();
    for (const good of ['Künstliche Intelligenz', 'الذكاء الاصطناعي', '인공지능', '人工知能', '5G-A', 'Produkt ١٢٣', 'Müller', 'EN', 'IT', 'T700']) expect(multilingualTermIssue(good), good).toBeUndefined();
    expect(termIssue('Deutsch')).toBeUndefined();
    expect(termIssue('١٢٣')).toBeUndefined();
  });

  it('热词剔除非法目标，指定翻译剔除整条，实际状态仍能追溯原因', () => {
    const row = term('Artificial Intelligence', 'غير متوفر');
    const hot = compileMultilingualHotwords([row]);
    expect(hot.content).toBe('Artificial Intelligence');
    expect(hot.included[0].id).toBe(row.id);
    expect(hot.excluded[0]).toMatchObject({ id: row.id, term: row.target, reason: '尚未提供的占位内容' });
    expect(compileMultilingualTranslations([row]).count).toBe(0);
    expect(row.target).toBe('غير متوفر');
  });

  it('非法原词不因译文有效而导出；必保非法内容明确禁止下载', () => {
    const invalid = term('١٢٣', 'Künstliche Intelligenz', { pinned: true });
    expect(compileMultilingualHotwords([invalid])).toMatchObject({ content: '', count: 0 });
    expect(compileMultilingualHotwords([invalid]).errors.join('')).toContain('非术语');
    expect(compileMultilingualTranslations([invalid]).errors.join('')).toContain('非术语');
    expect(compileMultilingualTranslations([term('Artificial Intelligence', 'Deutsch', { pinned: true })]).errors.join('')).toContain('非术语');
  });

  it('未选择导出或未采用的建议不制造虚假的非法目标导出状态', () => {
    expect(compileMultilingualHotwords([term('Artificial Intelligence', 'Deutsch', { basis: 'suggested', translation: false })]).excluded).toHaveLength(0);
    expect(compileMultilingualTranslations([term('١٢٣', '', { translation: false })]).excluded).toHaveLength(0);
  });

  it('文字检查保留通用缩写、拉丁姓名和共享文字体系，不假装能区分所有语言', () => {
    expect(multilingualLanguageIssue('T700', 'ko')).toBeUndefined();
    expect(multilingualLanguageIssue('Müller', 'en')).toBeUndefined();
    expect(multilingualLanguageIssue('人工知能', 'ja')).toBeUndefined();
    expect(multilingualLanguageIssue('人工智能', 'zh')).toBeUndefined();
    expect(multilingualLanguageIssue('الذكاء الاصطناعي', 'de')).toBeDefined();
    expect(multilingualLanguageIssue('Künstliche Intelligenz', 'en')).toBeUndefined();
  });

  it('手动编辑与新审核 JSON 的错误文字语言同样隔离，旧编译器继续沿用原行为', () => {
    const row = term('Artificial Intelligence', '人工智能', { pinned: true });
    const pair = { source: 'en', target: 'de' } as const;
    const hot = compileMultilingualHotwords([row], pair);
    expect(hot.content).toBe('Artificial Intelligence');
    expect(hot.excluded[0].reason).toContain('德语');
    expect(hot.errors).not.toHaveLength(0);
    const translation = compileMultilingualTranslations([row], false, pair);
    expect(translation.count).toBe(0);
    expect(translation.errors).not.toHaveLength(0);
    expect(compileTranslations([row]).count).toBe(1);
    expect(compileMultilingualTranslations([term('Artificial Intelligence', 'Künstliche Intelligenz')], false, pair).count).toBe(1);
  });
});

describe('新增页面沿用主页面 TXT 编译规则', () => {
  const valid = [term('人工智能', 'Artificial Intelligence'), term('低介电纱', 'Niedrig-dielektrisches Garn'), term('Artificial Intelligence', 'الذكاء الاصطناعي'), term('Machine Learning', '機械学習'), term('Künstliche Intelligenz', '인공지능')];
  it('合法多语词条与旧编译器逐项一致，包括格式调整和两种字符预算', () => {
    expect(compileMultilingualHotwords(valid)).toEqual(compileHotwords(valid));
    expect(compileMultilingualTranslations(valid)).toEqual(compileTranslations(valid));
    expect(compileMultilingualTranslations(valid, true)).toEqual(compileTranslations(valid, true));
    const translations = compileMultilingualTranslations(valid);
    expect(translations.content.split('，').every(entry => entry.split('-').length === 2)).toBe(true);
    expect(translations.content).toContain('低介电纱-Niedrig dielektrisches Garn');
    expect(() => validateExport(translations.content, 'translation')).not.toThrow();
    expect(() => validateExport(compileMultilingualHotwords(valid).content, 'hot')).not.toThrow();
  });

  it('UTF-8 BOM、单行、结尾一组 CRLF 和 UTF-16 精确限制保持相同', () => {
    const hot = compileMultilingualHotwords([term('词'.repeat(2045))]);
    expect(hot.chars).toBe(2048);
    expect(fileText(hot.content).length).toBe(2048);
    const translation = compileMultilingualTranslations([term('A'.repeat(20475), 'B')]);
    expect(translation.chars).toBe(20480);
    expect(fileText(translation.content).length).toBe(20480);
    const file = new TextEncoder().encode(fileText(compileMultilingualTranslations(valid).content));
    expect([...file.slice(0, 3)]).toEqual([239, 187, 191]);
    expect([...file.slice(-2)]).toEqual([13, 10]);
    expect(fileText(compileMultilingualTranslations(valid).content).match(/\r\n/gu)).toHaveLength(1);
    expect(compileMultilingualHotwords([term('词'.repeat(2046), '', { pinned: true })]).errors).not.toHaveLength(0);
  });

  it('多语重复、不同译法冲突和逆向冲突仍按旧规则隔离', () => {
    const duplicate = [term('Artificial Intelligence', '人工知能'), term('artificial intelligence', '人工知能', { id: 'duplicate' })];
    expect(compileMultilingualTranslations(duplicate).count).toBe(1);
    const conflict = [term('Artificial Intelligence', 'Künstliche Intelligenz'), term('Artificial Intelligence', 'Maschinelle Intelligenz', { id: 'conflict' })];
    expect(compileMultilingualTranslations(conflict).count).toBe(0);
    const reverseConflict = [term('Machine Learning', '機械学習'), term('Statistical Learning', '機械学習')];
    expect(compileMultilingualTranslations(reverseConflict, true).content).not.toContain('機械学習-');
  });

  it('文字连接控制字符沿用旧格式清理，但新页面明确提示用户核对词形', () => {
    const rows = [term('می\u200cخواهم', 'I want'), term('ا\u200dب', 'AB')];
    const hot = compileMultilingualHotwords(rows), translation = compileMultilingualTranslations(rows);
    expect(hot.content).toBe(compileHotwords(rows).content);
    expect(translation.content).toBe(compileTranslations(rows).content);
    expect(fileText(translation.content)).toBe(fileText(compileTranslations(rows).content));
    expect(hot.changes.some(change => change.includes('连接控制字符'))).toBe(true);
    expect(translation.changes.some(change => change.includes('请核对导出后的完整词形'))).toBe(true);
    expect(compileTranslations(rows).changes.some(change => change.includes('连接控制字符'))).toBe(false);
    expect(compileMultilingualHotwords([term('Artificial Intelligence', 'می\u200cخواهم', { basis: 'suggested', translation: false })]).changes).toHaveLength(0);
  });
});
