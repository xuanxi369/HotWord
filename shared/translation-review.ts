import type { Candidate } from './schema';
import { termIssue } from './term-quality';
import { compileTranslations, termKey } from './compiler';
import { compileMultilingualTranslations } from './multilingual-compiler';
import type { LanguagePair } from './languages';
import { outputStatus } from './review';

export function translationSelectionStatus(candidates: Candidate[], id: string, bidirectional = false, languagePair?: LanguagePair) {
  const candidate = candidates.find(c => c.id === id);
  if (!candidate) return undefined;
  const selected = { ...candidate, translation: true };
  const proposed = candidates.map(c => c.id === id ? selected : c);
  const compiled = languagePair ? compileMultilingualTranslations(proposed, bidirectional, languagePair) : compileTranslations(proposed, bidirectional);
  return outputStatus(selected, compiled, 'translation');
}

export function adoptableTranslations(candidates: Candidate[]) {
  const targets=new Map<string,Set<string>>();
  for(const c of candidates.filter(c=>c.target)) {const key=termKey(c.source),set=targets.get(key)??new Set<string>();set.add(termKey(c.target));targets.set(key,set);}
  return candidates.filter(c=>!c.translation && c.target.trim() && !termIssue(c.source) && !termIssue(c.target) && !/[/／]/.test(c.source+c.target) && termKey(c.source)!==termKey(c.target) && targets.get(termKey(c.source))!.size===1);
}
export function translationSummary(candidates: Candidate[]) {
  return { automatic:candidates.filter(c=>c.translation && c.translationAuto).length, selected:candidates.filter(c=>c.translation).length, pending:candidates.filter(c=>c.target.trim() && !c.translation).length, missing:candidates.filter(c=>!c.target.trim()).length };
}
