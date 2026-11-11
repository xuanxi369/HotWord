import { describe, expect, it } from 'vitest';
import { compileHotwords, compileTranslations } from '../shared/compiler';
import { outputStatus } from '../shared/review';
import { CandidateSchema, type Candidate } from '../shared/schema';
const term = (id: string, source: string, target: string, patch: Partial<Candidate> = {}): Candidate => ({ id, source, target, category: 'industry', priority: 70, basis: 'source', evidence: '', location: '', hot: true, translation: true, pinned: false, ...patch });
describe('真实导出状态', () => {
  it('热词预算不足不等于指定翻译未纳入，显示部分接受和完整接受', () => {
    const c = term('c','术语', 'English Phrase '.repeat(140));
    expect(outputStatus(c,compileHotwords([c]),'hot')).toMatchObject({label:'部分纳入',attention:true});
    expect(outputStatus(c,compileTranslations([c]),'translation')).toMatchObject({label:'已纳入',attention:false});
  });
  it('重复词已在文件中时显示去重纳入，不制造未导出的假问题', () => {
    const a = term('a','同一原词','Same Term'), b = {...a,id:'b'};
    const hot = compileHotwords([a,b]);
    expect(hot.excluded).toHaveLength(0);
    expect(outputStatus(b,hot,'hot')).toMatchObject({label:'已去重纳入',attention:false});
    expect(outputStatus(b,compileTranslations([a,b]),'translation')).toMatchObject({label:'已去重纳入',attention:false});
  });
  it('重复但全部超限时每条都记录预算不足，不能谎称已去重纳入', () => {
    const a = term('a','词'.repeat(2046),''), b = {...a,id:'b'};
    const hot = compileHotwords([a,b]);
    expect(hot.included).toHaveLength(0);
    expect(outputStatus(b,hot,'hot')).toMatchObject({label:'未导出',attention:true});
    expect(hot.excluded.every(e=>e.reason.includes('预算'))).toBe(true);
  });
  it('区分未选择、待确认以及同一原词冲突', () => {
    const a = term('a','光伏边框','Term A'), b = term('b','光伏边框','Term B');
    expect(outputStatus(a,compileTranslations([a,b]),'translation').detail).toContain('不同译文');
    const pending = {...a,translation:false};
    expect(outputStatus(pending,compileTranslations([pending]),'translation')).toMatchObject({label:'待确认',attention:false});
    expect(outputStatus({...a,hot:false},compileHotwords([]),'hot').label).toBe('未选择');
  });
  it('旧 JSON 项目无需新字段也可恢复', () => {
    expect(CandidateSchema.parse(term('old','原词','Term'))).toMatchObject({source:'原词',target:'Term'});
  });
});
