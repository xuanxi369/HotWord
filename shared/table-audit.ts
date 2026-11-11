import type { Candidate } from './schema';

// One complete source row per line. Chunking and recovery never split a mapping.
export function auditText(candidates: Candidate[]) {
  return candidates.map(c => JSON.stringify({ id: c.id, source: c.source, target: c.target, category: c.category, evidence: c.evidence, location: c.location, categoryEvidence: c.categoryEvidence })).join('\n');
}
export function auditChunks(candidates: Candidate[], size: number, maxRows: number) {
  const chunks: { text: string; label: string }[] = [];
  let batch: Candidate[] = [], chars = 0;
  for (const c of candidates) {
    const cost = auditText([c]).length;
    if (cost > size) throw new Error('单条术语的依据超过模型上下文，请增大上下文或缩短依据后重试');
    if (batch.length && (chars + 1 + cost > size || batch.length >= maxRows)) { chunks.push({ text: auditText(batch), label: `分类核对 · 片段 ${chunks.length + 1}` }); batch = []; chars = 0; }
    chars += cost + Number(batch.length > 0); batch.push(c);
  }
  if (batch.length) chunks.push({ text: auditText(batch), label: `分类核对 · 片段 ${chunks.length + 1}` });
  return chunks;
}
export function bisectAudit(text: string): [string, string] | null {
  const rows = text.split('\n').filter(Boolean);
  if (rows.length < 2) return null;
  const midpoint = Math.ceil(rows.length / 2);
  return [rows.slice(0, midpoint).join('\n'), rows.slice(midpoint).join('\n')];
}
export function auditRows(text: string, candidates: Candidate[]) {
  const ids = text.split('\n').filter(Boolean).map(line => JSON.parse(line).id as string);
  const byId = new Map(candidates.map(c => [c.id, c]));
  return ids.map(id => {
    const candidate = byId.get(id);
    if (!candidate) throw new Error('分类核对的原表词条缺失');
    return candidate;
  });
}
