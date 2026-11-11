import { languageHeaderKey, languageName, languages, type LanguageCode, type LanguagePair } from './languages';
import { termIssue } from './term-quality';

const labels = new Set([
  ...languages.flatMap(language => [...language.headers, language.name, language.nativeName])
    .filter(header => !/^[a-z]{2,3}$/iu.test(header)).map(languageHeaderKey),
  'ausgangstext', 'quelltext', 'zieltext', 'übersetzung', 'begriff', 'kategorie', 'anmerkungen', 'hinweise',
  '原文言語', '翻訳', '訳文', '用語', '分類', '備考', '원문', '번역', '용어', '분류', '비고',
  'النص الأصلي', 'الترجمة', 'المصطلح', 'الفئة', 'ملاحظات',
  'texte source', 'traduction', 'catégorie', 'remarques', 'texto original', 'traducción', 'categoría', 'notas',
  'personennamen', 'personen', 'namen', 'unternehmen', 'institutionen', 'organisationen', 'ortsnamen', 'orte', 'produkte', 'arzneimittel', 'fachbegriffe', 'terminologie', 'sonstige',
  'أسماء الأشخاص', 'أسماء الأماكن', 'مؤسسات', 'شركات', 'منتجات', 'مصطلحات', 'أخرى', '会社', '機関', '製品', '薬品', 'その他', '이름', '성명', '기관', '회사', '지명', '제품', '약품', '기타',
]);
const pending = new Set([
  'nicht angegeben', 'noch zu bestätigen', 'ausstehend', '未確認', '要確認', '未提供', '미정', '확인 필요', '미제공',
  'غير متوفر', 'غير محدد', 'قيد التأكيد', 'à confirmer', 'non fourni', 'por confirmar', 'no proporcionado',
]);

/** Extra checks are opt-in and never change the main workbench's content rules. */
export function multilingualTermIssue(raw: string, _pair?: LanguagePair): string | undefined {
  const existing = termIssue(raw);
  if (existing) return existing;
  const text = raw.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (/^[\p{N}\s.,，٬٫:/\\%+−–—()（）年月日号第页-]+$/u.test(text)) return '独立数字、序号、页码或日期';
  const key = languageHeaderKey(text);
  const base = key.replace(/(?:\s+(?:terms?|names?|text|translation)|(?:术语|词条|姓名|原词|译文|首选译法|译法))$/iu, '').trim();
  if (labels.has(key) || labels.has(base)) return '表头、分类或说明标签';
  if (pending.has(key)) return '尚未提供的占位内容';
  if (/[؛؟]/u.test(raw)) return '完整句子或说明段落';
  const words = text.match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?/gu) ?? [];
  if (words.length >= 8 && /(?:^|\s)(?:ist|sind|war|waren|wird|werden|bitte|muss|müssen|est|sont|sera|seront|es|son|será|serán)(?:\s|$)/iu.test(text)) return '完整句子或说明段落';
  return undefined;
}

const expectedScript: Record<LanguageCode, RegExp> = {
  zh: /[\p{Script_Extensions=Han}\p{Script_Extensions=Latin}]/u,
  en: /\p{Script_Extensions=Latin}/u, de: /\p{Script_Extensions=Latin}/u, fr: /\p{Script_Extensions=Latin}/u,
  es: /\p{Script_Extensions=Latin}/u, it: /\p{Script_Extensions=Latin}/u, pt: /\p{Script_Extensions=Latin}/u,
  tr: /\p{Script_Extensions=Latin}/u, vi: /\p{Script_Extensions=Latin}/u, id: /\p{Script_Extensions=Latin}/u,
  ar: /[\p{Script_Extensions=Arabic}\p{Script_Extensions=Latin}]/u, fa: /[\p{Script_Extensions=Arabic}\p{Script_Extensions=Latin}]/u,
  ja: /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Latin}]/u,
  ko: /[\p{Script_Extensions=Hangul}\p{Script_Extensions=Han}\p{Script_Extensions=Latin}]/u,
  ru: /[\p{Script_Extensions=Cyrillic}\p{Script_Extensions=Latin}]/u,
  th: /[\p{Script_Extensions=Thai}\p{Script_Extensions=Latin}]/u,
  hi: /[\p{Script_Extensions=Devanagari}\p{Script_Extensions=Latin}]/u,
  he: /[\p{Script_Extensions=Hebrew}\p{Script_Extensions=Latin}]/u,
};
/** Reject incompatible letters anywhere in a term. Script_Extensions keeps
 * native shared letters such as Japanese ー and Arabic ـ; punctuation, numbers,
 * combining marks and official Latin spellings do not cause a mismatch. */
export function multilingualLanguageIssue(raw: string, language: LanguageCode): string | undefined {
  return [...raw].some(character => /\p{L}/u.test(character) && !expectedScript[language].test(character)) ? `文字语言与所选${languageName(language)}不一致，请核对语言或术语列` : undefined;
}
