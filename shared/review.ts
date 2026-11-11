import type { Candidate, Category } from './schema';
import type { Compiled } from './compiler';

export function termRisk(source: string, target: string, category: Category): string | undefined {
  if (category === 'person') return '姓名音译、拼音或别名容易混淆，请沿用原表译法';
  if (category === 'place') return '地名可能与人名或机构名混淆';
  if (/[/／]/.test(source + target)) return '含别称或多种译法，需要确认完整对应关系';
  if (/\b[A-Z][A-Z0-9]{1,8}\b|\b(?:ctDNA|miRNA|mCRPC)\b/.test(source + ' ' + target)) return '缩写在不同领域含义不同，请沿用本文件的展开';
  if (category === 'product') return '产品型号或药品名称容易误译，请保留完整名称';
}

export function needsReview(c: Candidate) {
  return Boolean(c.reviewReason || (c.basis === 'suggested' && !c.translation) || /[/／]/.test(c.source + c.target));
}

export type OutputStatus = { label: string; detail: string; attention: boolean };
export function outputIndex(compiled: Compiled) {
  const byId = new Map<string, Pick<Compiled, 'included' | 'excluded'>>();
  for (const kind of ['included', 'excluded'] as const) for (const entry of compiled[kind]) {
    const group = byId.get(entry.id) ?? { included: [], excluded: [] };
    if (kind === 'included') group.included.push(entry as Compiled['included'][number]);
    else group.excluded.push(entry as Compiled['excluded'][number]);
    byId.set(entry.id, group);
  }
  return byId;
}
export function outputStatus(c: Candidate, compiled: Pick<Compiled, 'included' | 'excluded'>, kind: 'hot' | 'translation'): OutputStatus {
  if (!(kind === 'hot' ? c.hot : c.translation)) return { label: kind === 'translation' && c.target ? '待确认' : '未选择', detail: kind === 'translation' && c.target ? '勾选指定翻译后再纳入导出' : '未选择此文件', attention: false };
  const included = compiled.included.filter(e => e.id === c.id);
  const issues = compiled.excluded.filter(e => e.id === c.id && e.reason !== '重复条目');
  const details = issues.map(e => `${e.term}：${e.reason}`);
  if (included.length) return { label: issues.length ? '部分纳入' : included.every(e => e.reused) ? '已去重纳入' : '已纳入', detail: details.length ? details.join('；') : included.map(e => `${e.term}${e.reused ? '（与已有条目共用）' : ''}`).join('；'), attention: issues.length > 0 };
  return { label: '未导出', detail: details.join('；') || '没有可导出的完整内容', attention: true };
}
