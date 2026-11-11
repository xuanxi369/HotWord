import { describe, expect, it } from 'vitest';
import { languages } from '../shared/languages';
import { multilingualLanguageIssue } from '../shared/multilingual-quality';
import { languageMismatch, multilingualAppears } from '../server/language-context';

describe('新工作台和后台使用相同文字校验', () => {
  it('混入目标语言不支持的文字不会因存在 AI 等拉丁缩写而通过', () => {
    for (const text of ['人工知能 AI', 'AI 인공지능', 'Artificial Intelligence الذكاء']) {
      expect(multilingualLanguageIssue(text, 'en')).toBeDefined();
      expect(multilingualLanguageIssue(text, 'de')).toBeDefined();
      expect(languageMismatch(text, 'de')).toBe(multilingualLanguageIssue(text, 'de'));
    }
  });

  it('合法母语字形、官方拉丁拼写、数字、标点和组合音标继续保留', () => {
    expect(multilingualLanguageIssue('Ku\u0308nstliche Intelligenz (AI-2026)', 'de')).toBeUndefined();
    expect(multilingualLanguageIssue('인공지능 (AI-2026)', 'ko')).toBeUndefined();
    expect(multilingualLanguageIssue('الذكاء الاصطناعي (AI-2026)', 'ar')).toBeUndefined();
    expect(multilingualLanguageIssue('コンピューター (AI-2026)', 'ja')).toBeUndefined();
    expect(multilingualLanguageIssue('الـذكاء الاصطناعي', 'ar')).toBeUndefined();
    expect(languageMismatch('コンピューター', 'ja')).toBeUndefined();
    expect(languageMismatch('الـذكاء الاصطناعي', 'ar')).toBeUndefined();
  });

  it('所有注册语言的本语言名称在前后端均接受', () => {
    for (const language of languages) {
      expect(multilingualLanguageIssue(language.nativeName, language.code)).toBeUndefined();
      expect(languageMismatch(language.nativeName, language.code)).toBeUndefined();
    }
  });

  it('阿拉伯语和希伯来语附着前缀仍可证明原文存在', () => {
    expect(multilingualAppears('الذكاء الاصطناعي', 'والذكاء الاصطناعي')).toBe(true);
    expect(multilingualAppears('ישראל', 'בישראל')).toBe(true);
    expect(multilingualAppears('ber', 'über')).toBe(false);
  });
});
