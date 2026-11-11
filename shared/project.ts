import { CandidateSchema, type Candidate } from './schema';
import { LanguagePairSchema, type LanguagePair } from './languages';

export type ReviewProject = {
  name: string;
  candidates: Candidate[];
  languagePair?: LanguagePair;
  bidirectional?: boolean;
};

/** Version 1 retains the existing main-page project shape and import rules. */
export function parseReviewProject(raw: unknown): ReviewProject {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('不是有效的 HotWord 审核项目');
  const value = raw as Record<string, unknown>;
  if ((value.version !== 1 && value.version !== 2) || !Array.isArray(value.candidates) || value.candidates.length > 20000 || typeof value.name !== 'string') {
    throw new Error('不是有效的 HotWord 审核项目');
  }
  const candidates = value.candidates.map(candidate => CandidateSchema.parse(candidate));
  if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) throw new Error('项目内存在重复词条 ID');
  const project: ReviewProject = { name: value.name.slice(0, 100), candidates };
  if (value.version === 2) {
    project.languagePair = LanguagePairSchema.parse(value.languagePair);
    if (value.bidirectional !== undefined && typeof value.bidirectional !== 'boolean') throw new Error('双向映射设置无效');
    project.bidirectional = value.bidirectional ?? false;
  }
  return project;
}

export function serializeReviewProject(name: string, candidates: Candidate[], languagePair?: LanguagePair, bidirectional = false): string {
  if (!languagePair) return JSON.stringify({ version: 1, name, candidates }, null, 2);
  return JSON.stringify({ version: 2, name, candidates, languagePair: LanguagePairSchema.parse(languagePair), bidirectional }, null, 2);
}
