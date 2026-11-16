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
  return Boolean(c.reviewReason || c.translationReview || (c.target.trim() && !c.translation) || /[/／]/.test(c.source + c.target));
}

export function applyCandidatePatch(c: Candidate, patch: Partial<Candidate>): Candidate {
  const textChanged = (patch.source !== undefined && patch.source !== c.source) || (patch.target !== undefined && patch.target !== c.target);
  return {
    ...c,
    ...(textChanged ? { translation: false, translationAuto: false, translationForced: false } : {}),
    ...patch,
    ...('translation' in patch ? { translationAuto: false, ...(patch.translation ? { translationReview: undefined } : { translationForced: false }) } : {}),
    ...(patch.category ? { reviewReason: undefined, categoryEvidence: '已手动选择类别' } : {}),
  };
}

export type OutputStatus = { label: string; detail: string; attention: boolean; reasons: string[]; adjustment?: 'content' | 'budget'; forced?: boolean; warnings?: string[] };
export function outputIndex(compiled: Compiled) {
  const byId = new Map<string, Pick<Compiled, 'included' | 'excluded' | 'forced'>>();
  for (const kind of ['included', 'excluded'] as const) for (const entry of compiled[kind]) {
    const group = byId.get(entry.id) ?? { included: [], excluded: [] };
    if (kind === 'included') group.included.push(entry as Compiled['included'][number]);
    else group.excluded.push(entry as Compiled['excluded'][number]);
    byId.set(entry.id, group);
  }
  for (const entry of compiled.forced ?? []) {
    const group = byId.get(entry.id) ?? { included: [], excluded: [] };
    group.forced = [...(group.forced ?? []), entry]; byId.set(entry.id, group);
  }
  return byId;
}
export function outputStatus(c: Candidate, compiled: Pick<Compiled, 'included' | 'excluded' | 'forced'>, kind: 'hot' | 'translation'): OutputStatus {
  if (!(kind === 'hot' ? c.hot : c.translation)) return { label: kind === 'translation' && c.target ? '待确认' : '未选择', detail: kind === 'translation' && c.target ? '点击“加入指定翻译”完成确认并纳入导出' : '未选择此文件', attention: false, reasons: [] };
  const included = compiled.included.filter(e => e.id === c.id);
  const issues = compiled.excluded.filter(e => e.id === c.id && e.reason !== '重复条目');
  const details = issues.map(e => `${e.term}：${e.reason}`);
  const reasons = [...new Set(issues.map(e => e.reason))];
  const adjustment = reasons.length ? reasons.every(reason => /预算|上限/.test(reason)) ? 'budget' : 'content' : undefined;
  if (included.length) {
    const forced = kind === 'translation' && !!c.translationForced;
    const warnings = [...new Set((compiled.forced ?? []).filter(e => e.id === c.id).map(e => e.reason))];
    return { label: issues.length ? forced ? '部分强制纳入' : '部分纳入' : forced ? '已强制纳入' : included.every(e => e.reused) ? '已去重纳入' : '已纳入', detail: [...details, ...warnings].join('；') || included.map(e => `${e.term}${e.reused ? '（与已有条目共用）' : ''}`).join('；'), attention: issues.length > 0, reasons, adjustment, ...(forced ? { forced, warnings } : {}) };
  }
  return { label: '已选择，但未纳入', detail: details.join('；') || '没有可导出的完整内容', attention: true, reasons: reasons.length ? reasons : ['没有可导出的完整内容'], adjustment: adjustment ?? 'content' };
}
