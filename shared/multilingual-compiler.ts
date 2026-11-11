import { compileHotwords, compileTranslations, type Compiled, type Exclusion } from './compiler';
import { multilingualLanguageIssue, multilingualTermIssue } from './multilingual-quality';
import type { LanguagePair } from './languages';
import type { Candidate } from './schema';

function joiningNotes(candidates: Candidate[], kind: 'hot' | 'translation') {
  const terms = candidates.filter(candidate => kind === 'hot' ? candidate.hot : candidate.translation)
    .flatMap(candidate => [candidate.source, kind === 'translation' || candidate.basis !== 'suggested' || candidate.translation ? candidate.target : '']);
  return terms.filter(term => /[\u200c\u200d]/u.test(term)).map(term => `${term}：含文字连接控制字符，TXT 将沿用现有格式清理，请核对导出后的完整词形`);
}
function withQuality(result: Compiled, excluded: Exclusion[], errors: string[], notes: string[]) {
  return { ...result, excluded: [...excluded, ...result.excluded], errors: [...new Set([...errors, ...result.errors])], changes: [...new Set([...result.changes, ...notes])] };
}

/** Keep the existing serializer, normalization, UTF-16 budgets and priority rules. */
export function compileMultilingualHotwords(candidates: Candidate[], languagePair?: LanguagePair): Compiled {
  const excluded: Exclusion[] = [], errors: string[] = [], eligible: Candidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.hot) { eligible.push(candidate); continue; }
    const sourceIssue = multilingualTermIssue(candidate.source) || (languagePair && multilingualLanguageIssue(candidate.source, languagePair.source));
    if (sourceIssue) {
      excluded.push({ id: candidate.id, term: candidate.source, reason: sourceIssue });
      if (candidate.pinned) errors.push('必保项包含非术语内容，请修正或取消必保');
      continue;
    }
    const targetEligible = candidate.target && (candidate.basis !== 'suggested' || candidate.translation);
    const targetIssue = targetEligible ? multilingualTermIssue(candidate.target) || (languagePair && multilingualLanguageIssue(candidate.target, languagePair.target)) : undefined;
    if (targetIssue) {
      excluded.push({ id: candidate.id, term: candidate.target, reason: targetIssue });
      if (candidate.pinned) errors.push('必保项包含非术语内容，请修正或取消必保');
      eligible.push({ ...candidate, target: '' });
    } else eligible.push(candidate);
  }
  return withQuality(compileHotwords(eligible), excluded, errors, joiningNotes(eligible, 'hot'));
}

export function compileMultilingualTranslations(candidates: Candidate[], bidirectional = false, languagePair?: LanguagePair): Compiled {
  const excluded: Exclusion[] = [], errors: string[] = [], eligible: Candidate[] = [];
  for (const candidate of candidates) {
    const issue = candidate.translation && (multilingualTermIssue(candidate.source) || (languagePair && multilingualLanguageIssue(candidate.source, languagePair.source))
      || (candidate.target && (multilingualTermIssue(candidate.target) || (languagePair && multilingualLanguageIssue(candidate.target, languagePair.target)))));
    if (issue) {
      excluded.push({ id: candidate.id, term: candidate.source, reason: issue });
      if (candidate.pinned) errors.push('必保指定翻译包含非术语内容，请修正或取消必保');
    } else eligible.push(candidate);
  }
  return withQuality(compileTranslations(eligible, bidirectional), excluded, errors, joiningNotes(eligible, 'translation'));
}
