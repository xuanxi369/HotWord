import type { Candidate } from './schema';

export const HOT_LIMIT = 2048;
export const TRANSLATION_LIMIT = 20480;
// A downloaded file is UTF-8 with BOM + one CRLF. JS length counts UTF-16 units.
export const FILE_OVERHEAD = 3;
export function normalizeTerm(value: string): string {
  return value.normalize('NFC')
    .replace(/[\p{Pd}\u2212\u00ad,，\r\n\t]/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ').trim();
}
export const termKey = (value: string) => normalizeTerm(value).toLocaleLowerCase('en-US');
export const fileText = (content: string) => '\uFEFF' + content + '\r\n';
export type Exclusion = { id: string; term: string; reason: string };
export type Compiled = { content: string; count: number; chars: number; excluded: Exclusion[]; errors: string[]; changes: string[] };
type Entry = { id: string; term: string; key: string; pinned: boolean; rank: number };
const weights = { person: 500, place: 400, company: 300, product: 200, industry: 100, other: 0 };

function pack(entries: Entry[], limit: number, excluded: Exclusion[], changes: string[]): Compiled {
  const sorted = entries.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.rank - a.rank || a.key.localeCompare(b.key, 'en'));
  const seen = new Set<string>();
  const accepted: string[] = [];
  let chars = FILE_OVERHEAD;
  const errors: string[] = [];
  for (const entry of sorted) {
    if (seen.has(entry.key)) { excluded.push({ id: entry.id, term: entry.term, reason: '重复条目' }); continue; }
    seen.add(entry.key);
    const cost = entry.term.length + Number(accepted.length > 0);
    if (chars + cost > limit) {
      excluded.push({ id: entry.id, term: entry.term, reason: entry.pinned ? '必保条目超出上限' : '字符预算不足，保留了更高优先级的完整条目' });
      if (entry.pinned) errors.push('必保条目超过字符上限，请减少必保项后下载');
      continue;
    }
    accepted.push(entry.term); chars += cost;
  }
  return { content: accepted.join('，'), count: accepted.length, chars, excluded, errors: [...new Set(errors)], changes: [...new Set(changes)] };
}

export function compileHotwords(candidates: Candidate[]): Compiled {
  const entries: Entry[] = [], excluded: Exclusion[] = [], changes: string[] = [];
  for (const c of candidates.filter(c => c.hot)) {
    // Both languages are complete hotword entries; no split on spaces or slash.
    for (const raw of [c.source, c.basis !== 'suggested' || c.translation ? c.target : ''].filter(Boolean)) {
      const term = normalizeTerm(raw);
      if (!term) { excluded.push({ id: c.id, term: raw, reason: '空词条' }); continue; }
      if (term !== raw) changes.push(`${raw} → ${term}`);
      entries.push({ id: c.id, term, key: termKey(term), pinned: c.pinned, rank: weights[c.category] + c.priority });
    }
  }
  return pack(entries, HOT_LIMIT, excluded, changes);
}

export function compileTranslations(candidates: Candidate[], bidirectional = false): Compiled {
  const proposed: (Entry & { sourceKey: string; targetKey: string })[] = [];
  const excluded: Exclusion[] = [], changes: string[] = [];
  for (const c of candidates.filter(c => c.translation)) {
    const source = normalizeTerm(c.source), target = normalizeTerm(c.target);
    if (!source || !target) { excluded.push({ id: c.id, term: c.source, reason: '缺少原词或译文' }); continue; }
    if (source !== c.source) changes.push(`${c.source} → ${source}`);
    if (target !== c.target) changes.push(`${c.target} → ${target}`);
    if (termKey(source) === termKey(target)) { excluded.push({ id: c.id, term: source, reason: '两端相同，无需锁定翻译' }); continue; }
    for (const [a, b] of bidirectional ? [[source, target], [target, source]] : [[source, target]]) {
      proposed.push({ id: c.id, term: `${a}-${b}`, key: `${termKey(a)}\u0000${termKey(b)}`, sourceKey: termKey(a), targetKey: termKey(b), pinned: c.pinned, rank: weights[c.category] + c.priority });
    }
  }
  const targets = new Map<string, Set<string>>();
  for (const p of proposed) {
    const set = targets.get(p.sourceKey) ?? new Set<string>();
    set.add(p.targetKey); targets.set(p.sourceKey, set);
  }
  const entries = proposed.filter(p => {
    if (targets.get(p.sourceKey)!.size > 1) {
      excluded.push({ id: p.id, term: p.term, reason: '同一原词对应不同译文，请选择一个译法' }); return false;
    }
    return true;
  });
  const result = pack(entries, TRANSLATION_LIMIT, excluded, changes);
  if (proposed.some(p => p.pinned && targets.get(p.sourceKey)!.size > 1)) result.errors.push('必保指定翻译存在冲突，请先解决');
  validateExport(result.content, 'translation');
  return result;
}

export function validateExport(content: string, kind: 'hot' | 'translation') {
  const limit = kind === 'hot' ? HOT_LIMIT : TRANSLATION_LIMIT;
  if (fileText(content).length > limit) throw new Error('导出超过字符上限');
  if (content && content.split('，').some(t => !t.trim())) throw new Error('出现空条目');
  if (/[\r\n,]/u.test(content)) throw new Error('条目内部存在非法分隔符');
  for (const t of content ? content.split('，') : []) {
    if (kind === 'translation' && (t.split('-').length !== 2 || t.split('-').some(p => !p.trim()))) throw new Error('指定翻译必须为原词-译文');
    if (kind === 'hot' && /[\p{Pd}\u2212]/u.test(t)) throw new Error('热词内包含映射符');
  }
}
