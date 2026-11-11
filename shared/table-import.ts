import { termKey } from './compiler';
import type { Candidate, ParsedSegment } from './schema';
import { termIssue } from './term-quality';
import { categoryFromLabel, inferTermCategory } from './term-category';
import { termRisk } from './review';

export type TableColumns = { sourceColumn: number; targetColumn: number; headerRow: number };
const headerKey = (value: string) => value.normalize('NFKC').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const sourceHeaders = /^(?:原词|原文|源词|源文|中文(?:术语|词条|姓名)?|姓名|chinese(?: term| name)?|zh-cn|source(?: term| text)?|term)$/i;
const targetHeaders = /^(?:译文|译法|翻译|目标词|英文(?:首选译法|译法|术语|姓名)?|英语|english(?: term| name)?|en-us|en-gb|target(?: term| text)?|translation)$/i;
export function detectTableColumns(segment: ParsedSegment): TableColumns | undefined {
  for (const [headerRow, row] of (segment.rows ?? []).slice(0, 10).entries()) {
    const keys = row.map(headerKey);
    const sourceColumn = keys.findIndex(k => sourceHeaders.test(k)), targetColumn = keys.findIndex(k => targetHeaders.test(k));
    if (sourceColumn >= 0 && targetColumn >= 0 && sourceColumn !== targetColumn) {
      // Language-only headers describe the workbook's left-to-right translation direction.
      // Never turn an English-to-Chinese sheet into Chinese-to-English mappings.
      const language = /^(?:中文(?:术语|词条|姓名)?|英文(?:首选译法|译法|术语|姓名)?|chinese(?: term| name)?|english(?: term| name)?)$/i;
      if (language.test(keys[sourceColumn]) && language.test(keys[targetColumn])) return { sourceColumn: Math.min(sourceColumn, targetColumn), targetColumn: Math.max(sourceColumn, targetColumn), headerRow };
      return { sourceColumn, targetColumn, headerRow };
    }
  }
}

const nonTermSheet = (label: string) => /使用说明|译法红线|误译|避免写法|目录|\breadme\b|\binstructions?\b|\bred.?lines?\b/i.test(label);
export function recommendTableImport(segments: ParsedSegment[]) {
  const tables = segments.filter(s => s.rows && !nonTermSheet(s.label));
  const recognized = tables.map(segment => ({ segment, columns: detectTableColumns(segment) })).filter(t => t.columns);
  const dedicated = recognized.filter(t => /导入(?:用)?(?:双列|对照|术语)?表|导入用双列表|\bimport\b/i.test(t.segment.label));
  const recommended = dedicated.length ? dedicated : recognized;
  const selected = recommended.length ? recommended.map(t => t.segment.id) : tables.filter(s => s.text.trim()).map(s => s.id);
  const first = recommended[0]?.columns;
  return { selected, automatic: !!first, sourceColumn: first?.sourceColumn ?? 0, targetColumn: first?.targetColumn ?? 1,
    skipHeader: !!first, note: dedicated.length ? '已识别专用双语导入表，默认只选择该表，避免导入说明与重复内容。' : recognized.length ? '已识别双语表头，按各工作表的术语列导入。' : '未识别到双语表头，请核对原词列与译文列。' };
}

// A slash can denote a model, alternatives, or a literal phrase. Never expand it automatically.
export function importTable(segments: ParsedSegment[], sourceColumn: number, targetColumn: number, skipHeader: boolean, automatic = false): { candidates: Candidate[]; warnings: string[] } {
  const candidates: Candidate[] = [], warnings: string[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    if (nonTermSheet(segment.label)) { warnings.push(`${segment.label}：说明或错误译法工作表不作为术语导入`); continue; }
    const header = detectTableColumns(segment);
    const detected = automatic ? header : undefined;
    const sourceIndex = detected?.sourceColumn ?? sourceColumn, targetIndex = detected?.targetColumn ?? targetColumn;
    if (sourceIndex === targetIndex) { warnings.push(`${segment.label}：原词和译文列不能相同`); continue; }
    const rows = segment.rows ?? [];
    let section = '';
    rows.forEach((row, index) => {
      if (skipHeader && index <= (detected?.headerRow ?? 0)) return;
      const source = (row[sourceIndex] ?? '').trim(); let target = (row[targetIndex] ?? '').trim();
      const sectionLabel = row.filter(v => v.trim());
      if (sectionLabel.length === 1 && categoryFromLabel(sectionLabel[0])) { section = sectionLabel[0]; return; }
      if (!source && !target) return;
      const actualSource = source || target;
      if (actualSource.length > 180 || target.length > 180) { warnings.push(`${segment.label} 第 ${index + 1} 行过长，请检查所选列`); return; }
      const sourceIssue = termIssue(actualSource);
      if (sourceIssue) { warnings.push(`${segment.label} 第 ${index + 1} 行：已排除${sourceIssue}，请核对术语列`); return; }
      const targetIssue = target && termIssue(target);
      if (targetIssue) { warnings.push(`${segment.label} 第 ${index + 1} 行：译文是${targetIssue}，仅保留原词`); target = ''; }
      if (!source || !target) { warnings.push(`${segment.label} 第 ${index + 1} 行缺少对照，只加入热词`); }
      const key = `${termKey(actualSource)}\u0000${termKey(target)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const ambiguous = /[/／]/.test(actualSource + target);
      if (ambiguous) warnings.push(`${segment.label} 第 ${index + 1} 行含斜杠别称，请拆成完整词组后确认指定翻译`);
      const context = [...row.filter((_, i) => i !== sourceIndex && i !== targetIndex), section, segment.label, ...(header ? [rows[header.headerRow][sourceIndex] ?? '', rows[header.headerRow][targetIndex] ?? ''] : [])];
      const neighbors = rows.slice(Math.max(0, index - 2), index + 3).filter(neighbor => neighbor !== row).map(neighbor => ({ source: neighbor[sourceIndex] ?? '', target: neighbor[targetIndex] ?? '' }));
      const category = inferTermCategory({ source: actualSource, target, context, neighbors });
      const explicit = context.find(value => categoryFromLabel(value) === category);
      const declared = context.map(categoryFromLabel).find(Boolean);
      const unclearName = category === 'industry' && (/^\p{Script=Han}{2,5}$/u.test(actualSource) && /^[A-Z][a-z]+$/.test(target) || /^[A-Z][a-z]+(?:\s+[A-Z][\p{L}.]+){1,4}$/u.test(actualSource) && !target);
      candidates.push({ id: `table-${segment.id}-${index}`, source: actualSource, target: source ? target : '', category,
        priority: 70, basis: 'source', evidence: row.filter(Boolean).join(' | ').slice(0, 400),
        categoryEvidence: explicit ? `原表分类：${explicit}` : '根据原词、对照译文和邻近行识别',
        riskReason: termRisk(actualSource, target, category),
        reviewReason: declared && declared !== category ? '原表分类与机构或职务证据不一致，请核对类别' : unclearName ? '专名类别不明确，建议用 AI 分类核对' : undefined,
        location: `${segment.label} · 第 ${index + 1} 行`, hot: true, translation: Boolean(source && target && !ambiguous), pinned: false });
    });
  }
  return { candidates, warnings };
}
