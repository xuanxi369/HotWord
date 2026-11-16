import { describe, expect, it, vi } from 'vitest';
import { prepareTranslations, approveTranslations, resolveTranslationConflicts, completeTranslations } from '../server/translations';
import { modelDefaults } from '../shared/models';
import type { Env } from '../server/env';
import { adoptableTranslations, translationSummary } from '../shared/translation-review';
import { compileTranslations, validateExport } from '../shared/compiler';
import { OutputLimitError } from '../server/providers';
import type { Candidate } from '../shared/schema';
const c=(id:string,source:string,target='',patch:Partial<Candidate>={}):Candidate=>({id,source,target,category:'industry',priority:70,basis:'none',evidence:source,location:'正文',hot:true,translation:false,pinned:false,...patch});
const proposal=(rows:Candidate[])=>({terms:rows.map(c=>({id:c.id,target:c.target||'Standard Translation',basis:'suggested',certainty:'standard',targetEvidence:'',reason:'通行术语'})),complete:true});
const verdict=(rows:Candidate[],approved=true)=>({terms:rows.map(c=>({id:c.id,approved,reason:approved?'标准译法':'对应译名不可靠'})),complete:true});
describe('指定翻译自动补全与独立复核',()=>{
  it('63 条中只补未确认的 28 条，Cloudflare 分批输出后保留原顺序、已确认译法和选择', async () => {
    const rows = Array.from({ length: 63 }, (_, i) => c(`row-${i}`, `术语${i}`, i < 35 ? `Existing ${i}` : '', { translation: i < 35, basis: i < 35 ? 'manual' : 'none', pinned: i === 0, hot: i % 2 === 0 }));
    const proposals: string[][] = [];
    const run = vi.fn().mockImplementation(async (_model: string, body: any) => {
      const terms = JSON.parse(body.messages[1].content).terms;
      expect(terms.every((term: any) => Number(term.id.split('-')[1]) >= 35)).toBe(true);
      expect(body.max_completion_tokens).toBeLessThanOrEqual(3328);
      const verifying = body.messages[0].content.startsWith('你是独立');
      if (!verifying) proposals.push(terms.map((term: any) => term.id));
      const output = verifying ? terms.map((term: any) => ({ id: term.id, approved: true, reason: '标准译法' }))
        : terms.map((term: any) => ({ id: term.id, target: `Standard ${term.id}`, basis: 'suggested', certainty: 'standard', targetEvidence: '', reason: '标准译法' }));
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ terms: output, complete: true }) } }], usage: { prompt_tokens: 50, completion_tokens: 30 } };
    });
    const record = vi.fn();
    const result = await completeTranslations({ AI: { run } } as unknown as Env, modelDefaults('cloudflare'), '', rows, '原文', async () => {}, record);
    expect(proposals.map(batch => batch.length)).toEqual([12, 12, 4]);
    expect(proposals.flat()).toEqual(rows.slice(35).map(row => row.id));
    expect(result.candidates.slice(0, 35)).toEqual(rows.slice(0, 35));
    expect(result.candidates.map(row => row.id)).toEqual(rows.map(row => row.id));
    expect(result.candidates.every(row => row.translation)).toBe(true);
    expect(run).toHaveBeenCalledTimes(6); expect(record).toHaveBeenCalledTimes(6);
  });
  it('无可靠译名或编写阶段不确定的条目保留待核对原因，不发起无效的复核调用', async () => {
    const rows = [c('a', '未知姓名', '', { category: 'person' }), c('b', '歧义术语')];
    const run = vi.fn().mockResolvedValue({ response: JSON.stringify({ terms: [
      { id: 'a', target: '', basis: 'none', certainty: 'uncertain', targetEvidence: '', reason: '缺少官方姓名对照' },
      { id: 'b', target: 'Possible Term', basis: 'suggested', certainty: 'uncertain', targetEvidence: '', reason: '有多个备选译法' },
    ], complete: true }) });
    const result = await completeTranslations({ AI: { run } } as unknown as Env, modelDefaults('cloudflare'), '', rows, '原文', async () => {}, async () => {});
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.candidates.map(row => row.translationReview)).toEqual(['缺少官方姓名对照', '有多个备选译法']);
    expect(result.candidates.every(row => !row.translation)).toBe(true);
  });
  it('单语原词获得标准建议，复核通过后直接导出，不要求逐条勾选',()=>{
    const rows=[c('a','无水染色'),c('b','可持续餐饮')],raw=proposal(rows);
    raw.terms[0].target='Waterless Dyeing';raw.terms[1].target='Sustainable Dining';
    const proposed=prepareTranslations(raw,rows,'无水染色和可持续餐饮');
    expect(proposed.every(c=>!c.translation)).toBe(true);
    const result=approveTranslations(verdict(proposed),proposed,rows);
    expect(result.every(c=>c.translation && c.translationAuto)).toBe(true);
    expect(compileTranslations(result).count).toBe(2);
    expect(()=>validateExport(compileTranslations(result).content,'translation')).not.toThrow();
  });
  it('复核否定、编写阶段不确定、未知姓名和斜杠词组不自动锁定',()=>{
    const rows=[c('a','行业术语'),c('b','Unknown Person','',{category:'person'}),c('c','共享/别称')];
    const raw=proposal(rows);raw.terms[1]={...raw.terms[1],target:'',basis:'none',certainty:'uncertain',reason:'缺少官方姓名对照'};
    const proposed=prepareTranslations(raw,rows,'原文');
    const decisions=verdict(proposed);decisions.terms[0].approved=false;
    const result=approveTranslations(decisions,proposed,rows);
    expect(result.every(c=>!c.translation)).toBe(true);
    expect(result[1]).toMatchObject({target:'',translationReview:'缺少官方姓名对照'});
    const uncertain=proposal([rows[0]]);uncertain.terms[0].certainty='uncertain';
    const u=prepareTranslations(uncertain,[rows[0]],'');
    expect(approveTranslations(verdict(u),u,[rows[0]])[0].translation).toBe(false);
  });
  it('保留已有原词、译文、已选状态与手动译法，不被补全模型重写',()=>{
    const rows=[c('a','原有术语','Original Term',{basis:'source',translation:true,pinned:true}),c('b','手动译法','Manual Term',{basis:'manual'})];
    const raw=proposal(rows);raw.terms.forEach(t=>t.target='模型试图重写');
    const proposed=prepareTranslations(raw,rows,'原文');
    expect(proposed[0]).toEqual(rows[0]);expect(proposed[1].target).toBe('Manual Term');
    expect(approveTranslations(verdict(proposed,false),proposed,rows)[0]).toEqual(rows[0]);
  });
  it('目标摘录必须存在，source 与译文分处段落也能验证',()=>{
    const rows=[c('a','围炉夜话')],raw=proposal(rows);raw.terms[0]={...raw.terms[0],target:'Fireside Chat',basis:'source',targetEvidence:'The Fireside Chat begins at eight.'};
    const context='围炉夜话在八点开始。\nThe Fireside Chat begins at eight.';
    expect(prepareTranslations(raw,rows,context)[0]).toMatchObject({basis:'source',targetEvidence:raw.terms[0].targetEvidence});
    expect(prepareTranslations(raw,rows,'围炉夜话在八点开始。')[0].basis).toBe('suggested');
  });
  it('缺少任何 ID 要继续拆分，重复和未知 ID 不能进入结果',()=>{
    const rows=[c('a','术语甲'),c('b','术语乙')];
    const raw=proposal(rows);raw.terms.pop();expect(()=>prepareTranslations(raw,rows,'')).toThrow(OutputLimitError);
    const duplicate=proposal(rows);duplicate.terms[1].id='a';expect(()=>prepareTranslations(duplicate,rows,'')).toThrow('重复');
    const unknown=proposal(rows);unknown.terms[0].id='fake';expect(()=>prepareTranslations(unknown,rows,'')).toThrow('未知');
    const missing=verdict(rows);missing.terms.pop();expect(()=>approveTranslations(missing,rows,rows)).toThrow(OutputLimitError);
  });
  it('跨片段的冲突取消自动纳入，批量采用也跳过冲突、空译文与格式疑点',()=>{
    const rows=[c('a','同一概念','Term A',{translation:true,translationAuto:true}),c('b','同一概念','Term B',{translation:true,translationAuto:true}),c('c','完整术语','Complete Term'),c('d','无译文'),c('e','别称/型号','Alias'),c('f','标题','')];
    const result=resolveTranslationConflicts(rows);
    expect(result.slice(0,2).every(c=>!c.translation && c.translationReview?.includes('多个译法'))).toBe(true);
    expect(adoptableTranslations(result).map(c=>c.id)).toEqual(['c']);
    expect(translationSummary(result)).toMatchObject({selected:0,pending:4,missing:2});
  });
});
