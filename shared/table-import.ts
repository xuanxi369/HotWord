import { termKey } from './compiler';
import type { Candidate, ParsedSegment } from './schema';

// A slash can denote a model, alternatives, or a literal phrase. Never expand it automatically.
export function importTable(segments: ParsedSegment[], sourceColumn: number, targetColumn: number, skipHeader: boolean): { candidates: Candidate[]; warnings: string[] } {
  const candidates: Candidate[] = [], warnings: string[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const rows = segment.rows ?? [];
    rows.forEach((row, index) => {
      if (index === 0 && skipHeader) return;
      const source = (row[sourceColumn] ?? '').trim(), target = (row[targetColumn] ?? '').trim();
      if (!source && !target) return;
      if (!source || !target) { warnings.push(`${segment.label} 第 ${index + 1} 行缺少对照，只加入热词`); }
      const actualSource = source || target;
      if (actualSource.length > 180 || target.length > 180) { warnings.push(`${segment.label} 第 ${index + 1} 行过长，请检查所选列`); return; }
      const key = `${termKey(actualSource)}\u0000${termKey(target)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const ambiguous = /[/／]/.test(actualSource + target);
      if (ambiguous) warnings.push(`${segment.label} 第 ${index + 1} 行含斜杠别称，请拆成完整词组后确认指定翻译`);
      const context = segment.label + ' ' + row.filter((_, i) => i !== sourceColumn && i !== targetColumn).join(' ');
      const category = /人名|嘉宾姓名|\bperson\b|\bnames\b/i.test(context) ? 'person'
        : /地名|\bplaces\b/i.test(context) || /^(重庆|长寿|大渡口|福州|巴西|巴林|卡皮瓦里|Chongqing|Changshou|Dadukou|Fuzhou|Brazil|Bahrain|Capivari)$/i.test(actualSource) || /开发区|\b(?:Province|City|Industrial Development Zone)\b/i.test(actualSource + target) ? 'place'
        : /公司|集团|联盟|大学|研究院|corporation|company|university|alliance/i.test(actualSource + target) ? 'company'
        : /^[A-Z][A-Z0-9+]{1,12}$/.test(actualSource) ? 'product' : 'industry';
      candidates.push({ id: `table-${segment.id}-${index}`, source: actualSource, target: source ? target : '', category,
        priority: 70, basis: 'source', evidence: row.filter(Boolean).join(' | ').slice(0, 400),
        location: `${segment.label} · 第 ${index + 1} 行`, hot: true, translation: Boolean(source && target && !ambiguous), pinned: false });
    });
  }
  return { candidates, warnings };
}
