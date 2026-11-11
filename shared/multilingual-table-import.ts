import { termKey } from './compiler';
import { categoryFromLabel } from './term-category';
import { LanguagePairSchema, languageCodeForHeader, languageHeaderKey, languageName, type LanguagePair } from './languages';
import { multilingualLanguageIssue, multilingualTermIssue } from './multilingual-quality';
import { termRisk } from './review';
import type { Candidate, Category, ParsedSegment } from './schema';
import type { TableColumns } from './table-import';

const sourceHeaders = /^(?:原词|原文|源词|源文|source(?: term| text)?|original(?: term| text)?|term|ausgangstext|quelltext|原文言語|원문|النص الأصلي)$/iu;
const targetHeaders = /^(?:译文|译法|翻译|目标词|target(?: term| text)?|translation|übersetzung|zieltext|訳文|翻訳|번역|الترجمة)$/iu;
const nonTermSheet = (label: string) => /使用说明|译法红线|误译|避免写法|目录|\breadme\b|\binstructions?\b|\bred.?lines?\b|anleitung|hinweise|使い方|説明書|사용 안내|تعليمات|إرشادات/iu.test(label);
const hasRows = (segment: ParsedSegment) => !!segment.rows?.some(row => row.some(cell => cell.trim()));

function recognizedHeader(segment: ParsedSegment, pair: LanguagePair) {
  for (const [headerRow, row] of (segment.rows ?? []).slice(0, 10).entries()) {
    const codes = row.map(languageCodeForHeader), keys = row.map(languageHeaderKey);
    let sourceColumn = codes.indexOf(pair.source), targetColumn = codes.indexOf(pair.target);
    if (sourceColumn < 0) sourceColumn = keys.findIndex(key => sourceHeaders.test(key));
    if (targetColumn < 0) targetColumn = keys.findIndex(key => targetHeaders.test(key));
    if (sourceColumn >= 0 && targetColumn >= 0 && sourceColumn !== targetColumn) return { sourceColumn, targetColumn, headerRow };
  }
}
export function detectMultilingualTableColumns(segment: ParsedSegment, pair: LanguagePair): TableColumns | undefined {
  LanguagePairSchema.parse(pair);
  return recognizedHeader(segment, pair);
}

function sourceOnlyHeader(segment: ParsedSegment, pair: LanguagePair) {
  for (const [headerRow, row] of (segment.rows ?? []).slice(0, 10).entries()) {
    const codes = row.map(languageCodeForHeader), keys = row.map(languageHeaderKey);
    const namedSource = codes.indexOf(pair.source), genericSource = keys.findIndex(key => sourceHeaders.test(key));
    const sourceColumn = namedSource >= 0 ? namedSource : genericSource;
    if (sourceColumn >= 0) return { sourceColumn, headerRow };
  }
}
function anyLanguageHeader(segment: ParsedSegment) {
  return (segment.rows ?? []).slice(0, 10).some(row => row.some(cell => languageCodeForHeader(cell)));
}

export function recommendMultilingualTableImport(segments: ParsedSegment[], pair: LanguagePair) {
  LanguagePairSchema.parse(pair);
  const tables = segments.filter(segment => hasRows(segment) && !nonTermSheet(segment.label));
  const recognized = tables.map(segment => ({ segment, columns: recognizedHeader(segment, pair) })).filter(table => table.columns);
  const dedicated = recognized.filter(table => /导入(?:用)?(?:双列|对照|术语)?表|导入用双列表|\bimport\b/iu.test(table.segment.label));
  const recommended = dedicated.length ? dedicated : recognized;
  const partial = tables.filter(segment => sourceOnlyHeader(segment, pair) || !anyLanguageHeader(segment));
  const chosen = recommended.length ? recommended.map(table => table.segment) : partial;
  const first = recommended[0]?.columns, sourceOnly = !first && chosen.length ? sourceOnlyHeader(chosen[0], pair) : undefined;
  const sourceColumn = first?.sourceColumn ?? (sourceOnly ? sourceOnly.sourceColumn : 0), targetColumn = first?.targetColumn ?? (sourceColumn === 0 ? 1 : 0);
  const preview = chosen.flatMap(segment => {
    const columns = recognizedHeader(segment, pair);
    return (segment.rows ?? []).slice(columns ? columns.headerRow + 1 : sourceOnlyHeader(segment, pair) ? sourceOnlyHeader(segment, pair)!.headerRow + 1 : 0)
      .filter(row => (row[columns?.sourceColumn ?? sourceColumn] ?? '').trim() && (row[columns?.targetColumn ?? targetColumn] ?? '').trim()
        && !multilingualTermIssue(row[columns?.sourceColumn ?? sourceColumn] ?? '') && !multilingualTermIssue(row[columns?.targetColumn ?? targetColumn] ?? '')
        && !multilingualLanguageIssue(row[columns?.sourceColumn ?? sourceColumn] ?? '', pair.source) && !multilingualLanguageIssue(row[columns?.targetColumn ?? targetColumn] ?? '', pair.target));
  });
  const bilingual = !!preview.length && (!!first || chosen.every(segment => !anyLanguageHeader(segment)));
  return { selected: chosen.map(segment => segment.id), automatic: !!first, sourceColumn, targetColumn,
    skipHeader: !!first || !!sourceOnly, bilingual,
    note: dedicated.length ? '已识别所选语言的专用双语导入表，默认只选择该表。'
      : first ? `已识别${languageName(pair.source)}和${languageName(pair.target)}列，按所选翻译方向导入。`
      : !chosen.length ? '未找到所选原文语言的工作表，请核对语言选择和资料范围。'
      : sourceOnly ? `未找到完整的${languageName(pair.target)}对照，将使用 AI 补全所选语言译法。`
      : bilingual ? '未识别到语言表头，请核对原词列与译文列及翻译方向。'
      : '资料缺少完整双语对照，可使用 AI 提取和补全所选语言译法。' };
}

const categories: Record<string, Category> = {
  personennamen: 'person', personen: 'person', namen: 'person', 'أسماء الأشخاص': 'person', 'أسماء': 'person', 이름: 'person', 성명: 'person',
  机构名: 'company', unternehmen: 'company', institutionen: 'company', organisationen: 'company', 'مؤسسات': 'company', 'شركات': 'company', 会社: 'company', 機関: 'company', 기관: 'company', 회사: 'company',
  ortsnamen: 'place', orte: 'place', 'أماكن': 'place', 'أسماء الأماكن': 'place', 지명: 'place',
  produkte: 'product', arzneimittel: 'product', 'منتجات': 'product', 製品: 'product', 薬品: 'product', 제품: 'product', 약품: 'product',
  fachbegriffe: 'industry', terminologie: 'industry', 'مصطلحات': 'industry', 用語: 'industry', 용어: 'industry', 기타: 'other', sonstige: 'other', その他: 'other', 'أخرى': 'other',
};
function categoryLabel(raw: string) { return categoryFromLabel(raw) ?? categories[languageHeaderKey(raw)]; }
function categoryFor(context: string[], source: string, target: string): { category: Category; explicit?: string } {
  const explicit = context.find(value => categoryLabel(value));
  if (explicit) return { category: categoryLabel(explicit)!, explicit };
  const text = `${source} ${target}`;
  if (/公司|集团|大学|医院|协会|学会|研究所|\b(?:company|corporation|university|hospital|association|institute|gmbh|universität|universitaet|krankenhaus|gesellschaft|unternehmen)\b|株式会社|大学|病院|협회|대학교|병원|شركة|جامعة|مستشفى/iu.test(text)) return { category: 'company' };
  if (/奖项|奖章|职务|\b(?:award|medal|prize|conference|president|professor|chairman|preis|konferenz|professor)\b|学会|会議|회의|교수|مؤتمر|جائزة/iu.test(text)) return { category: 'other' };
  return { category: 'industry' };
}

export function importMultilingualTable(segments: ParsedSegment[], sourceColumn: number, targetColumn: number, skipHeader: boolean, automatic: boolean, pair: LanguagePair): { candidates: Candidate[]; warnings: string[] } {
  LanguagePairSchema.parse(pair);
  const candidates: Candidate[] = [], warnings: string[] = [], seen = new Set<string>();
  for (const segment of segments) {
    if (nonTermSheet(segment.label)) { warnings.push(`${segment.label}：说明或错误译法工作表不作为术语导入`); continue; }
    const detected = automatic ? recognizedHeader(segment, pair) : undefined;
    if (automatic && !detected) { warnings.push(`${segment.label}：未识别到所选语言的双语列，请手动核对`); continue; }
    const sourceIndex = detected?.sourceColumn ?? sourceColumn, targetIndex = detected?.targetColumn ?? targetColumn;
    if (sourceIndex === targetIndex) { warnings.push(`${segment.label}：原词和译文列不能相同`); continue; }
    const rows = segment.rows ?? [], headerRow = detected?.headerRow ?? recognizedHeader(segment, pair)?.headerRow ?? sourceOnlyHeader(segment, pair)?.headerRow;
    if (headerRow !== undefined) {
      const sourceCode = languageCodeForHeader(rows[headerRow][sourceIndex] ?? ''), targetCode = languageCodeForHeader(rows[headerRow][targetIndex] ?? '');
      if ((sourceCode && sourceCode !== pair.source) || (targetCode && targetCode !== pair.target)) {
        warnings.push(`${segment.label}：所选列的语言与当前翻译方向不一致，请核对术语列`); continue;
      }
    } else if (anyLanguageHeader(segment)) {
      warnings.push(`${segment.label}：工作表语言与所选语言不匹配，请核对术语列`); continue;
    }
    let section = '';
    rows.forEach((row, index) => {
      if (skipHeader && index <= (headerRow ?? 0)) return;
      const sectionCells = row.filter(cell => cell.trim());
      if (sectionCells.length === 1 && categoryLabel(sectionCells[0])) { section = sectionCells[0]; return; }
      const source = (row[sourceIndex] ?? '').trim(); let target = (row[targetIndex] ?? '').trim();
      if (!source && !target) return;
      if (!source) { warnings.push(`${segment.label} 第 ${index + 1} 行缺少${languageName(pair.source)}原词，未生成反向词条`); return; }
      if (source.length > 180 || target.length > 180) { warnings.push(`${segment.label} 第 ${index + 1} 行过长，请检查所选列`); return; }
      const sourceIssue = multilingualTermIssue(source, pair);
      if (sourceIssue) { warnings.push(`${segment.label} 第 ${index + 1} 行：已排除${sourceIssue}，请核对术语列`); return; }
      const sourceLanguage = multilingualLanguageIssue(source, pair.source);
      if (sourceLanguage) { warnings.push(`${segment.label} 第 ${index + 1} 行：${sourceLanguage}`); return; }
      const targetIssue = target && (multilingualTermIssue(target, pair) || multilingualLanguageIssue(target, pair.target));
      if (targetIssue) { warnings.push(`${segment.label} 第 ${index + 1} 行：译文是${targetIssue}，仅保留原词`); target = ''; }
      if (!target) warnings.push(`${segment.label} 第 ${index + 1} 行缺少${languageName(pair.target)}对照，可使用 AI 补全指定翻译`);
      const key = `${termKey(source)}\u0000${termKey(target)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const ambiguous = /[/／]/u.test(source + target);
      if (ambiguous) warnings.push(`${segment.label} 第 ${index + 1} 行含斜杠别称，请拆成完整词组后确认指定翻译`);
      const context = [...row.filter((_, column) => column !== sourceIndex && column !== targetIndex), section, segment.label,
        ...(headerRow !== undefined ? [rows[headerRow][sourceIndex] ?? '', rows[headerRow][targetIndex] ?? ''] : [])];
      const classification = categoryFor(context, source, target);
      candidates.push({ id: `table-${segment.id}-${index}`, source, target, category: classification.category, priority: 70, basis: 'source',
        evidence: row.filter(Boolean).join(' | ').slice(0, 400), location: `${segment.label} · 第 ${index + 1} 行`, hot: true,
        translation: !!target && !ambiguous, pinned: false, riskReason: termRisk(source, target, classification.category),
        categoryEvidence: classification.explicit ? `原表分类：${classification.explicit}` : classification.category === 'industry' ? '原表未提供明确类别，暂按行业术语整理' : '根据完整名称中的机构或职务信息识别',
        reviewReason: !classification.explicit && classification.category === 'industry' ? '原表未提供类别，可使用 AI 分类核对' : undefined });
    });
  }
  return { candidates, warnings };
}
