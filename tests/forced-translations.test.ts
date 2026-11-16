import { describe, expect, it, vi } from 'vitest';
import { compileHotwords, compileTranslations, fileText, validateExport } from '../shared/compiler';
import { compileMultilingualTranslations } from '../shared/multilingual-compiler';
import { applyCandidatePatch, outputIndex, outputStatus } from '../shared/review';
import { translationSelectionStatus } from '../shared/translation-review';
import { CandidateSchema, JobInputSchema, type Candidate } from '../shared/schema';
import { parseReviewProject, serializeReviewProject } from '../shared/project';
import { completeTranslations } from '../server/translations';
import { modelDefaults } from '../shared/models';
import type { Env } from '../server/env';

const term = (id: string, source = 'Nicolas, Perret', target = 'Nicolas Perret', patch: Partial<Candidate> = {}): Candidate => ({ id, source, target, category: 'person', priority: 70, basis: 'manual', evidence: '', location: '', hot: true, translation: true, pinned: false, ...patch });

describe('人工强制指定翻译的完整导出流程', () => {
  it('两端归一后相同仍提示原因，只有显式强制项才写入 TXT', () => {
    const original = term('same');
    expect(compileTranslations([original]).count).toBe(0);
    const forced = { ...original, translationForced: true };
    const compiled = compileTranslations([forced]);
    expect(compiled.content).toBe('Nicolas Perret-Nicolas Perret');
    expect(compiled.forced).toEqual([{ id: forced.id, term: compiled.content, reason: '两端相同，无需锁定翻译' }]);
    expect(compiled.excluded).toHaveLength(0);
    expect(outputStatus(forced, outputIndex(compiled).get(forced.id)!, 'translation')).toMatchObject({ label: '已强制纳入', attention: false, forced: true, warnings: ['两端相同，无需锁定翻译'] });
    expect(fileText(compiled.content)).toBe('\uFEFFNicolas Perret-Nicolas Perret\r\n');
    expect(translationSelectionStatus([forced], forced.id, false, undefined, false)?.reasons).toContain('两端相同，无需锁定翻译');
  });

  it('相同映射开启双向时只生成一条实际映射和一条风险记录', () => {
    const compiled = compileTranslations([term('same', undefined, undefined, { translationForced: true })], true);
    expect(compiled.count).toBe(1);
    expect(compiled.content).toBe('Nicolas Perret-Nicolas Perret');
    expect(compiled.forced).toHaveLength(1);
  });

  it('有多个客户指定译法时仅强制项可越过冲突检查，普通项继续隔离', () => {
    const rows = [term('a', '统一原词', 'Term A', { translationForced: true }), term('b', '统一原词', 'Term B', { translationForced: true }), term('normal', '统一原词', 'Term C')];
    const compiled = compileTranslations(rows);
    expect(compiled.content.split('，')).toEqual(['统一原词-Term A', '统一原词-Term B']);
    expect(compiled.excluded).toEqual([{ id: 'normal', term: '统一原词-Term C', reason: '同一原词对应不同译文，请选择一个译法' }]);
    expect(compiled.forced?.every(entry => entry.reason.includes('不同译文'))).toBe(true);
  });

  it('内容判断可按客户要求强制采用，最终校验仅豁免被确认的具体映射', () => {
    const row = term('numeric', '21', 'Direct Roving', { translationForced: true });
    const compiled = compileTranslations([row]);
    expect(compiled.content).toBe('21-Direct Roving');
    expect(compiled.forced?.[0].reason).toContain('独立数字');
    const accepted = compiled.forced!.map(entry => entry.term);
    expect(() => validateExport(compiled.content, 'translation', accepted)).not.toThrow();
    expect(() => validateExport(compiled.content, 'translation')).toThrow('非术语');
    expect(() => validateExport(`${compiled.content}，22-Another Term`, 'translation', accepted)).toThrow('非术语');
    expect(compileHotwords([row]).count).toBe(0);
  });

  it('多语模式保留文字语言原因，同时允许人工强制导出', () => {
    const pair = { source: 'en', target: 'de' } as const;
    const row = term('language', 'Artificial Intelligence', '人工智能', { translationForced: true });
    const compiled = compileMultilingualTranslations([row], false, pair);
    expect(compiled.content).toBe('Artificial Intelligence-人工智能');
    expect(compiled.forced?.some(entry => entry.reason.includes('德语'))).toBe(true);
    expect(translationSelectionStatus([row], row.id, false, pair, false)).toMatchObject({ attention: true, adjustment: 'content' });
    expect(translationSelectionStatus([row], row.id, false, pair, true)).toMatchObject({ attention: false, forced: true });
  });

  it('强制不生成空映射或损坏格式，也不突破真实文件字符上限', () => {
    expect(compileTranslations([term('empty', '原词', '', { translationForced: true })])).toMatchObject({ content: '', count: 0 });
    expect(() => validateExport('A-B-C', 'translation', ['A-B-C'])).toThrow('原词-译文');
    expect(() => validateExport('A,B-C', 'translation', ['A,B-C'])).toThrow('非法分隔符');
    const rows = Array.from({ length: 65 }, (_, index) => term(`budget-${index}`, `Term ${index} ${'a'.repeat(160)}`, `Value ${index} ${'b'.repeat(160)}`, { priority: index === 64 ? 0 : 70, translationForced: index === 64 }));
    const compiled = compileTranslations(rows);
    expect(fileText(compiled.content).length).toBeLessThanOrEqual(20480);
    expect(translationSelectionStatus(rows, 'budget-64', false, undefined, true)).toMatchObject({ attention: true, adjustment: 'budget' });
    expect(compiled.forced).toBeUndefined();
  });

  it('修改内容或取消指定翻译撤销旧的强制决定，优先级调整不撤销', () => {
    const original = term('forced', undefined, undefined, { translationForced: true });
    expect(applyCandidatePatch(original, { target: 'Nicolas Pierre' })).toMatchObject({ translation: false, translationForced: false });
    expect(applyCandidatePatch(original, { source: 'Nicolas Pierre' })).toMatchObject({ translation: false, translationForced: false });
    expect(applyCandidatePatch(original, { translation: false })).toMatchObject({ translation: false, translationForced: false });
    expect(applyCandidatePatch(original, { priority: 90 })).toMatchObject({ translation: true, translationForced: true });
    expect(compileTranslations([{ ...original, translation: false }]).count).toBe(0);
  });

  it('审核项目和 AI 请求保留人工决定，旧项目仍兼容', () => {
    const forced = term('forced', undefined, undefined, { translationForced: true });
    for (const pair of [undefined, { source: 'en', target: 'de' } as const]) {
      const restored = parseReviewProject(JSON.parse(serializeReviewProject('客户要求', [forced], pair)));
      expect(restored.candidates[0].translationForced).toBe(true);
      expect(compileTranslations(restored.candidates).content).toBe('Nicolas Perret-Nicolas Perret');
    }
    expect(CandidateSchema.parse(term('old')).translationForced).toBeUndefined();
    expect(JobInputSchema.parse({ name: '核对', segments: [{ id: 's', label: '原文', text: 'Nicolas Perret' }], translationCandidates: [forced] }).translationCandidates?.[0].translationForced).toBe(true);
  });

  it('AI 补全尊重已强制确认的译法，不再次调用模型或重写客户决定', async () => {
    const run = vi.fn();
    const original = term('forced', undefined, undefined, { translationForced: true });
    const result = await completeTranslations({ AI: { run } } as unknown as Env, modelDefaults('cloudflare'), '', [original], '原文', async () => {}, async () => {});
    expect(run).not.toHaveBeenCalled();
    expect(result.candidates[0]).toEqual(original);
  });
});
