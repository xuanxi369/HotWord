import { z } from 'zod';

/** Language selection belongs to the new workbench; legacy jobs omit it. */
export const languages = [
  { code: 'zh', name: '中文', nativeName: '中文', direction: 'ltr', headers: ['中文', '汉语', '汉文', 'chinese', 'zh', 'zh-cn', 'zh-tw', 'zh-hans', 'zh-hant'] },
  { code: 'en', name: '英语', nativeName: 'English', direction: 'ltr', headers: ['英文', '英语', 'english', 'englisch', 'en', 'en-us', 'en-gb'] },
  { code: 'de', name: '德语', nativeName: 'Deutsch', direction: 'ltr', headers: ['德文', '德语', 'german', 'deutsch', 'de', 'de-de'] },
  { code: 'ar', name: '阿拉伯语', nativeName: 'العربية', direction: 'rtl', headers: ['阿拉伯语', '阿拉伯文', 'arabic', 'العربية', 'عربي', 'ar', 'ar-sa'] },
  { code: 'ja', name: '日语', nativeName: '日本語', direction: 'ltr', headers: ['日文', '日语', 'japanese', '日本語', 'ja', 'ja-jp'] },
  { code: 'ko', name: '韩语', nativeName: '한국어', direction: 'ltr', headers: ['韩文', '韩语', 'korean', '한국어', '조선어', 'ko', 'ko-kr'] },
  { code: 'fr', name: '法语', nativeName: 'Français', direction: 'ltr', headers: ['法文', '法语', 'french', 'français', 'francais', 'fr', 'fr-fr'] },
  { code: 'es', name: '西班牙语', nativeName: 'Español', direction: 'ltr', headers: ['西班牙语', '西班牙文', 'spanish', 'español', 'espanol', 'es', 'es-es'] },
  { code: 'it', name: '意大利语', nativeName: 'Italiano', direction: 'ltr', headers: ['意大利语', '意大利文', 'italian', 'italiano', 'it', 'it-it'] },
  { code: 'pt', name: '葡萄牙语', nativeName: 'Português', direction: 'ltr', headers: ['葡萄牙语', '葡萄牙文', 'portuguese', 'português', 'portugues', 'pt', 'pt-br', 'pt-pt'] },
  { code: 'ru', name: '俄语', nativeName: 'Русский', direction: 'ltr', headers: ['俄文', '俄语', 'russian', 'русский', 'ru', 'ru-ru'] },
  { code: 'tr', name: '土耳其语', nativeName: 'Türkçe', direction: 'ltr', headers: ['土耳其语', '土耳其文', 'turkish', 'türkçe', 'turkce', 'tr', 'tr-tr'] },
  { code: 'th', name: '泰语', nativeName: 'ไทย', direction: 'ltr', headers: ['泰语', '泰文', 'thai', 'ไทย', 'th', 'th-th'] },
  { code: 'vi', name: '越南语', nativeName: 'Tiếng Việt', direction: 'ltr', headers: ['越南语', '越南文', 'vietnamese', 'tiếng việt', 'vi', 'vi-vn'] },
  { code: 'id', name: '印尼语', nativeName: 'Bahasa Indonesia', direction: 'ltr', headers: ['印尼语', '印度尼西亚语', 'indonesian', 'bahasa indonesia', 'id', 'id-id'] },
  { code: 'hi', name: '印地语', nativeName: 'हिन्दी', direction: 'ltr', headers: ['印地语', '印地文', 'hindi', 'हिन्दी', 'हिंदी', 'hi', 'hi-in'] },
  { code: 'fa', name: '波斯语', nativeName: 'فارسی', direction: 'rtl', headers: ['波斯语', '波斯文', 'persian', 'farsi', 'فارسی', 'fa', 'fa-ir'] },
  { code: 'he', name: '希伯来语', nativeName: 'עברית', direction: 'rtl', headers: ['希伯来语', '希伯来文', 'hebrew', 'עברית', 'he', 'he-il'] },
] as const;

export type LanguageCode = typeof languages[number]['code'];
export type LanguagePair = { source: LanguageCode; target: LanguageCode };
const codes = languages.map(language => language.code) as [LanguageCode, ...LanguageCode[]];
export const LanguageCodeSchema = z.enum(codes);
export const LanguagePairSchema = z.object({ source: LanguageCodeSchema, target: LanguageCodeSchema }).strict()
  .refine(pair => pair.source !== pair.target, '原文语言和译文语言不能相同');
export function languageName(code: LanguageCode) { return languages.find(language => language.code === code)!.name; }
export function languageDirection(code: LanguageCode) { return languages.find(language => language.code === code)!.direction; }
export function languagePairLabel(pair: LanguagePair) { return `${languageName(pair.source)} → ${languageName(pair.target)}`; }

export const languageHeaderKey = (raw: string) => raw.normalize('NFKC')
  .replace(/\s*\([^)]*\)/gu, '').replace(/\s+/gu, ' ').replace(/[：:]$/u, '').trim().toLowerCase();
const headerSuffix = /(?:\s+(?:terms?|names?|text|translation)|(?:术语|词条|姓名|原词|译文|首选译法|译法))$/iu;
export function languageCodeForHeader(raw: string): LanguageCode | undefined {
  const explicit = raw.normalize('NFKC').trim();
  // Uppercase short codes such as IT/ID/DE are also real glossary abbreviations.
  // Recognize them only with explicit locale/suffix context, not as bare cells.
  if (/^[a-z]{2,3}$/iu.test(explicit) && explicit !== explicit.toLowerCase()) return undefined;
  const key = languageHeaderKey(raw), base = key.replace(headerSuffix, '').trim();
  return languages.find(language => language.headers.some(header => languageHeaderKey(header) === key || languageHeaderKey(header) === base))?.code;
}
