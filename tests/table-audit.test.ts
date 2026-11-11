import { describe, expect, it } from 'vitest';
import { auditChunks, auditRows, auditText, bisectAudit } from '../shared/table-audit';
import { validateAuditResult } from '../server/table-audit';
import { OutputLimitError } from '../server/providers';
import type { Candidate } from '../shared/schema';
const rows: Candidate[] = Array.from({length:190},(_,i)=>({id:`row-${i}`,source:`术语${i}𠀀`,target:`Term ${i}`,category:'industry',priority:70,basis:'source',evidence:`原表证据${i}`,location:`第 ${i+1} 行`,hot:i%2===0,translation:true,pinned:i===0}));
const response = (candidates: Candidate[]) => ({terms:candidates.map(c=>({id:c.id,category:'industry',priority:80,riskReason:'缩写歧义',reviewReason:'',categoryEvidence:'原表专业术语'})),complete:true});
describe('原表 + AI 分类核对', () => {
  it('190 条全部覆盖，AI 输出顺序不影响配对、出处、选择和必保', () => {
    const raw=response(rows);raw.terms.reverse();
    const result=validateAuditResult(raw,rows);
    expect(result.candidates).toHaveLength(190);
    result.candidates.forEach((c,i)=>expect(c).toMatchObject({...rows[i],priority:80}));
  });
  it('缺少任何 id 或 complete=false 都触发拆分，不保存残缺结果', () => {
    const raw=response(rows);raw.terms.pop();
    expect(()=>validateAuditResult(raw,rows)).toThrow(OutputLimitError);
    expect(()=>validateAuditResult({...response(rows),complete:false},rows)).toThrow(OutputLimitError);
  });
  it('未知和重复 id 被拒绝，模型不能注入新的词条', () => {
    const raw=response(rows);raw.terms[0].id='unknown';
    expect(()=>validateAuditResult(raw,rows)).toThrow('未知');
    const duplicate=response(rows);duplicate.terms[0].id=duplicate.terms[1].id;
    expect(()=>validateAuditResult(duplicate,rows)).toThrow('重复');
  });
  it('按完整行切片和二分，长行不会被打断，所有 id 保留一次', () => {
    const chunks=auditChunks(rows,2200,9);
    expect(chunks.every(c=>c.text.length<=2200 && c.text.split('\n').length<=9)).toBe(true);
    expect(chunks.flatMap(c=>auditRows(c.text,rows)).map(c=>c.id)).toEqual(rows.map(c=>c.id));
    const halves=bisectAudit(auditText(rows))!;
    expect(halves.flatMap(t=>auditRows(t,rows)).map(c=>c.id)).toEqual(rows.map(c=>c.id));
    expect(bisectAudit(auditText([rows[0]]))).toBeNull();
    expect(()=>auditChunks(rows,10,1)).toThrow('单条术语');
  });
  it('机构误判为人名时保留原类别并进入待核对，未知类别也不直接覆盖', () => {
    const original={...rows[0],source:'青山医院',target:'Greenhill Hospital',category:'company' as const};
    const raw=response([original]);raw.terms[0].category='person';
    expect(validateAuditResult(raw,[original]).candidates[0]).toMatchObject({category:'company',reviewReason:expect.stringContaining('冲突')});
    raw.terms[0].category='place';raw.terms[0].reviewReason='地名证据不足';
    expect(validateAuditResult(raw,[original]).candidates[0].category).toBe('company');
  });
});
