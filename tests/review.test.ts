import { describe, expect, it } from 'vitest';
import { compileHotwords, compileTranslations } from '../shared/compiler';
import { outputStatus } from '../shared/review';
import { translationSelectionStatus } from '../shared/translation-review';
import { CandidateSchema, type Candidate } from '../shared/schema';
const term = (id: string, source: string, target: string, patch: Partial<Candidate> = {}): Candidate => ({ id, source, target, category: 'industry', priority: 70, basis: 'source', evidence: '', location: '', hot: true, translation: true, pinned: false, ...patch });
describe('真实导出状态', () => {
  it('热词预算不足不等于指定翻译未纳入，显示部分接受和完整接受', () => {
    const c = term('c','术语', 'English Phrase '.repeat(140));
    expect(outputStatus(c,compileHotwords([c]),'hot')).toMatchObject({label:'部分纳入',attention:true,adjustment:'budget'});
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
    expect(outputStatus(b,hot,'hot')).toMatchObject({label:'已选择，但未纳入',attention:true,adjustment:'budget'});
    expect(hot.excluded.every(e=>e.reason.includes('预算'))).toBe(true);
  });
  it('区分未选择、待确认以及同一原词冲突', () => {
    const a = term('a','光伏边框','Term A'), b = term('b','光伏边框','Term B');
    expect(outputStatus(a,compileTranslations([a,b]),'translation').detail).toContain('不同译文');
    const pending = {...a,translation:false};
    expect(outputStatus(pending,compileTranslations([pending]),'translation')).toMatchObject({label:'待确认',attention:false});
    expect(outputStatus({...a,hot:false},compileHotwords([]),'hot').label).toBe('未选择');
  });
  it('两端相同时保留选择意愿，明确展示内容原因；重新勾选不能绕过限制', () => {
    const c = term('same','阿雷蒙','阿雷蒙');
    expect(outputStatus(c,compileTranslations([c]),'translation')).toMatchObject({
      label:'已选择，但未纳入', attention:true, adjustment:'content', reasons:['两端相同，无需锁定翻译'],
    });
    expect(outputStatus(c,compileHotwords([c]),'hot')).toMatchObject({attention:false,reasons:[]});
    const unselected = {...c,translation:false};
    expect(outputStatus(unselected,compileTranslations([unselected]),'translation')).toMatchObject({attention:false,reasons:[]});
    expect(compileTranslations([{...unselected,translation:true}]).count).toBe(0);
    const corrected = {...c,target:'ARaymond'};
    expect(outputStatus(corrected,compileTranslations([corrected]),'translation')).toMatchObject({label:'已纳入',attention:false,reasons:[]});
  });
  it('旧 JSON 项目无需新字段也可恢复', () => {
    expect(CandidateSchema.parse(term('old','原词','Term'))).toMatchObject({source:'原词',target:'Term'});
  });
  it('加入动作预先检查实际文件，待确认译法无需先取消再勾选', () => {
    const pending = term('pending','产业协同','Industrial Collaboration',{translation:false});
    expect(translationSelectionStatus([pending],pending.id)).toMatchObject({label:'已纳入',attention:false});
    expect(pending.translation).toBe(false);
    const selected = {...pending,translation:true};
    expect(compileTranslations([selected]).content).toBe('产业协同-Industrial Collaboration');
    const same = {...pending,target:pending.source};
    expect(translationSelectionStatus([same],same.id)).toMatchObject({attention:true,adjustment:'content'});
    const conflict = {...selected,id:'other',target:'Another Translation'};
    expect(translationSelectionStatus([pending,conflict],pending.id)?.reasons.join('；')).toContain('不同译文');
  });
  it('加入动作沿用语言与字符预算检查，不能显示虚假的加入成功', () => {
    const oversized = term('large','术语','Term '.repeat(4200),{translation:false});
    expect(translationSelectionStatus([oversized],oversized.id)).toMatchObject({attention:true,adjustment:'budget'});
    const wrongLanguage = term('language','人工智能','机器智能',{translation:false});
    expect(translationSelectionStatus([wrongLanguage],wrongLanguage.id,false,{source:'zh',target:'de'})?.reasons.join('；')).toContain('德语');
  });
});
