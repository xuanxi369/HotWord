import type { Candidate } from './schema';
import { termIssue } from './term-quality';
import { termKey } from './compiler';

export function adoptableTranslations(candidates: Candidate[]) {
  const targets=new Map<string,Set<string>>();
  for(const c of candidates.filter(c=>c.target)) {const key=termKey(c.source),set=targets.get(key)??new Set<string>();set.add(termKey(c.target));targets.set(key,set);}
  return candidates.filter(c=>!c.translation && c.target.trim() && !termIssue(c.source) && !termIssue(c.target) && !/[/／]/.test(c.source+c.target) && termKey(c.source)!==termKey(c.target) && targets.get(termKey(c.source))!.size===1);
}
export function translationSummary(candidates: Candidate[]) {
  return { automatic:candidates.filter(c=>c.translation && c.translationAuto).length, selected:candidates.filter(c=>c.translation).length, pending:candidates.filter(c=>c.target.trim() && !c.translation).length, missing:candidates.filter(c=>!c.target.trim()).length };
}
