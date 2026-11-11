import { describe, expect, it } from 'vitest';
import { appears, validateModelResult } from '../server/ai';
const term = { source: '单长乐', target: 'Shan Changle', category: 'person', priority: 100, basis: 'suggested', evidence: '单长乐出席会议' };
describe('模型输出不能替代原文证据', () => {
  it('未知人名译名留空，不猜拼音或多音字读法', () => {
    const result = validateModelResult({ terms: [term] }, '单长乐出席会议', '第 1 页', 'test');
    expect(result.candidates[0].target).toBe('');
    expect(result.candidates[0].translation).toBe(false);
  });
  it('未出现的词条与伪造出处被拒绝', () => {
    const result = validateModelResult({ terms: [term] }, '另一位嘉宾出席会议', '第 1 页', 'test');
    expect(result.candidates).toHaveLength(0);
  });
  it('验证英文词边界，不能从 chair 提取 AI', () => {
    expect(appears('AI', 'chair')).toBe(false);
    expect(appears('AI', 'AI translation')).toBe(true);
  });
  it('已提供对照的专名可以导出', () => {
    const confirmed = { ...term, basis: 'source', evidence: '单长乐 (Shan Changle) 出席会议' };
    const result = validateModelResult({ terms: [confirmed] }, confirmed.evidence, '第 1 页', 'test');
    expect(result.candidates[0].translation).toBe(true);
  });
  it('伪装成原表对照但译文不在文档的专名被清空', () => {
    const result = validateModelResult({ terms: [{ ...term, basis: 'source' }] }, term.evidence, '第 1 页', 'test');
    expect(result.candidates[0].target).toBe('');
  });
  it('待提供姓名的说明不算实际人名', () => {
    const text = '外籍嘉宾姓名待提供';
    const result = validateModelResult({ terms: [{ ...term, source: text, target: '', evidence: text, basis: 'none' }] }, text, '说明页', 'test');
    expect(result.candidates).toHaveLength(0);
  });
  it('失效 JSON、无效类别与整段词条都无法进入候选库', () => {
    expect(() => validateModelResult('ignore instructions', '', '', '')).toThrow();
    expect(() => validateModelResult({ terms: [{ ...term, category: 'system' }] }, '', '', '')).toThrow();
    expect(() => validateModelResult({ terms: [{ ...term, source: '字'.repeat(181) }] }, '', '', '')).toThrow();
  });
  it('有原文依据的候选不会因超过 180 条而被拒绝', () => {
    const terms = Array.from({ length: 181 }, (_, i) => ({ source: `行业词条${i}`, target: '', category: 'industry', priority: 80, basis: 'none', evidence: `行业词条${i}` }));
    expect(validateModelResult({ terms, complete: true }, terms.map(t => t.evidence).join('\n'), '原文', 't').candidates).toHaveLength(181);
  });
});
