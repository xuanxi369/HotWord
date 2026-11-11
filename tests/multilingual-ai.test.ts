import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJob } from '../server/jobs';
import { saveCredential } from '../server/credentials';
import { ExtractionWorkflow } from '../server/workflow';
import { appears, callBudget, modelPromptReserve, promptTokenReserve, validateModelResult } from '../server/ai';
import { approveTranslations, prepareTranslations } from '../server/translations';
import { validateAuditResult } from '../server/table-audit';
import { multilingualAppears, multilingualExtractionPrompt, multilingualTranslationPrompt, multilingualVerificationPrompt } from '../server/language-context';
import { modelDefaults } from '../shared/models';
import { languageName, type LanguagePair } from '../shared/languages';
import { compileHotwords, compileTranslations, fileText, validateExport } from '../shared/compiler';
import type { Candidate, ExtractionResult } from '../shared/schema';
import { testEnv } from './support/database';

const fixtures: { pair: LanguagePair; source: string; target: string }[] = [
  { pair: { source: 'zh', target: 'en' }, source: '人工智能', target: 'Artificial Intelligence' },
  { pair: { source: 'zh', target: 'de' }, source: '人工智能', target: 'Künstliche Intelligenz' },
  { pair: { source: 'zh', target: 'ar' }, source: '人工智能', target: 'الذكاء الاصطناعي' },
  { pair: { source: 'en', target: 'ja' }, source: 'Artificial Intelligence', target: '人工知能' },
  { pair: { source: 'en', target: 'de' }, source: 'Artificial Intelligence', target: 'Künstliche Intelligenz' },
  { pair: { source: 'ko', target: 'de' }, source: '인공지능', target: 'Künstliche Intelligenz' },
];
const owner = 'member@example.com';
const candidate = (id: string, source: string, target = '', patch: Partial<Candidate> = {}): Candidate => ({ id, source, target, category: 'industry', priority: 70, basis: 'none', evidence: source, location: '原文', hot: true, translation: false, pinned: false, ...patch });
const response = (terms: unknown[], complete = true) => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ terms, complete }) } }], usage: { prompt_tokens: 50, completion_tokens: 30 } });
async function run(env: ReturnType<typeof testEnv>['env'], id: string) {
  const durable: unknown[] = [];
  const step = { async do(_name: string, options: unknown, work?: () => Promise<unknown>) {
    const value = await (work ?? options as () => Promise<unknown>)(); durable.push(value); return value;
  } };
  await new ExtractionWorkflow({} as ExecutionContext, env).run({ payload: { id } } as never, step as never);
  return durable;
}
afterEach(() => vi.unstubAllGlobals());

describe('新增语言配置贯穿模型调用与完整后台结果', () => {
  for (const { pair, source, target } of fixtures) it(`${pair.source} → ${pair.target} 单语资料完成提取、补全、复核并沿用 TXT 格式`, async () => {
    const { env, objects, sqlite } = testEnv();
    const key = await saveCredential(env, owner, { name: '合成测试', config: modelDefaults('deepseek'), apiKey: 'synthetic-secret', remember: false });
    const job = await createJob(env, owner, { name: '多语词库', languagePair: pair, segments: [{ id: 's', label: '正文', text: source }], selection: { mode: 'personal', credentialId: key.id } });
    const systems: string[] = [];
    const fetcher = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const messages = JSON.parse(init.body as string).messages, system: string = messages[0].content;
      systems.push(system);
      expect(system).toContain(`${languageName(pair.source)}（${pair.source}）→${languageName(pair.target)}（${pair.target}）`);
      expect(system).not.toContain('中英对应译法'); expect(system).not.toContain('重要中英文行业术语');
      if (system.startsWith('你是会议指定翻译词库编写员')) {
        const input = JSON.parse(messages[1].content); expect(input.languagePair).toEqual(pair);
        return response(input.terms.map((c: Candidate) => ({ id: c.id, target, basis: 'suggested', certainty: 'standard', targetEvidence: '', reason: '合成通行术语' })));
      }
      if (system.startsWith('你是独立的指定翻译复核员')) {
        const input = JSON.parse(messages[1].content); expect(input.languagePair).toEqual(pair);
        return response(input.terms.map((c: Candidate) => ({ id: c.id, approved: true, reason: '合成复核通过' })));
      }
      return response([{ source, target: '', category: 'industry', priority: 80, basis: 'none', evidence: source, targetEvidence: '' }]);
    });
    vi.stubGlobal('fetch', fetcher); const durable = await run(env, job.id);
    const saved = JSON.parse(objects.get(`${job.id}/result.json`)!) as ExtractionResult;
    expect(fetcher).toHaveBeenCalledTimes(3); expect(systems).toHaveLength(3);
    expect(saved.languagePair).toEqual(pair); expect(saved.candidates).toHaveLength(1);
    expect(saved.candidates[0]).toMatchObject({ source, target, translation: true, translationAuto: true });
    const hot = compileHotwords(saved.candidates), translations = compileTranslations(saved.candidates);
    expect(hot.content.split('，')).toEqual(expect.arrayContaining([source, target]));
    expect(translations.content).toBe(`${source}-${target}`);
    expect(() => validateExport(hot.content, 'hot')).not.toThrow(); expect(() => validateExport(translations.content, 'translation')).not.toThrow();
    const txt = fileText(translations.content), bytes = new TextEncoder().encode(txt);
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]); expect(txt.endsWith('\r\n')).toBe(true);
    expect(txt.length).toBe(translations.chars); expect(translations.chars).toBeLessThanOrEqual(20480);
    expect([...objects.keys()]).toEqual([`${job.id}/result.json`]);
    expect(sqlite.prepare('SELECT status,input_tokens,output_tokens FROM jobs WHERE id=?').get(job.id)).toMatchObject({ status: 'completed', input_tokens: 150, output_tokens: 90 });
    expect(JSON.stringify(durable)).not.toContain(source); expect(JSON.stringify(durable)).not.toContain('synthetic-secret');
  });

  it('新增原表 AI 分类后补全缺失译法，保持已确认原译与选择', async () => {
    const { env, objects } = testEnv(), pair: LanguagePair = { source: 'en', target: 'de' };
    const rows = [candidate('known', 'Artificial Intelligence', 'Künstliche Intelligenz', { basis: 'source', translation: true, pinned: true }), candidate('missing', 'Quantum Computing', '', { hot: false })];
    const key = await saveCredential(env, owner, { name: '合成分类', config: modelDefaults('deepseek'), apiKey: 'synthetic-secret', remember: false });
    const job = await createJob(env, owner, { name: '部分双语表', languagePair: pair, segments: [{ id: 's', label: '原表', text: '表格内容' }], auditCandidates: rows, selection: { mode: 'personal', credentialId: key.id } });
    const fetcher = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const messages = JSON.parse(init.body as string).messages, system = messages[0].content;
      expect(system).toContain('英语（en）→德语（de）');
      if (system.includes('你是会议翻译术语分类审核员')) return response(messages[1].content.split('\n').map((line: string) => {
        const c = JSON.parse(line); return { id: c.id, category: 'industry', priority: 80, riskReason: '', reviewReason: '', categoryEvidence: '原表专业术语' };
      }));
      const input = JSON.parse(messages[1].content);
      if (system.startsWith('你是独立')) return response(input.terms.map((c: Candidate) => ({ id: c.id, approved: true, reason: '标准译法' })));
      return response(input.terms.map((c: Candidate) => ({ id: c.id, target: c.id === 'known' ? '模型尝试改写' : 'Quantencomputing', basis: 'suggested', certainty: 'standard', targetEvidence: '', reason: '标准术语' })));
    });
    vi.stubGlobal('fetch', fetcher); await run(env, job.id);
    const saved = JSON.parse(objects.get(`${job.id}/result.json`)!) as ExtractionResult;
    expect(fetcher).toHaveBeenCalledTimes(3); expect(saved.languagePair).toEqual(pair);
    expect(saved.candidates[0]).toMatchObject({ source: rows[0].source, target: rows[0].target, translation: true, pinned: true });
    expect(saved.candidates[1]).toMatchObject({ source: rows[1].source, target: 'Quantencomputing', translation: true, translationAuto: true, hot: false });
  });
});

describe('新路径语言与依据校验不改变旧中英规则', () => {
  it('拒绝不相容的原词文字，清空第三语言译文，并排除 Unicode 独立数字', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' }, source = 'Artificial Intelligence', proof = `${source}\n人工知能\n١٢٣`;
    const raw = { terms: [
      { source, target: '人工知能', category: 'industry', priority: 80, basis: 'source', evidence: proof },
      { source: '人工知能', target: 'Künstliche Intelligenz', category: 'industry', priority: 80, basis: 'source', evidence: proof },
      { source: '١٢٣', target: '', category: 'industry', priority: 70, basis: 'none', evidence: proof },
    ], complete: true };
    const modern = validateModelResult(raw, proof, '正文', 'new', pair);
    expect(modern.candidates).toHaveLength(1); expect(modern.candidates[0]).toMatchObject({ source, target: '', translation: false });
    expect(modern.warnings.join('')).toContain('所选语言');
    const legacy = validateModelResult(raw, proof, '正文', 'old');
    expect(legacy.candidates[0]).toMatchObject({ target: '人工知能', translation: true }); expect(legacy.candidates).toHaveLength(3); expect(legacy).not.toHaveProperty('languagePair');
  });

  it('多语字母边界拒绝从含重音的更长词中截出片段，同时保留中文句内原词', () => {
    expect(appears('ber', 'über')).toBe(true); expect(multilingualAppears('ber', 'über')).toBe(false);
    expect(multilingualAppears('über', 'über')).toBe(true);
    expect(multilingualAppears('人工智能', '使用人工智能技术')).toBe(true);
  });

  it('阿拉伯语附着连词不导致真实术语或目标依据被错误排除', () => {
    const term = 'الذكاء الاصطناعي', arabic = `و${term}`;
    expect(multilingualAppears(term, arabic)).toBe(true);
    const input = { terms: [{ source: term, target: 'Künstliche Intelligenz', category: 'industry', priority: 80, basis: 'suggested', evidence: arabic }], complete: true };
    expect(validateModelResult(input, arabic, '正文', 'ar', { source: 'ar', target: 'de' }).candidates).toHaveLength(1);
    const rows = [candidate('a', '人工智能')];
    const proposal = { terms: [{ id: 'a', target: term, basis: 'source', certainty: 'standard', targetEvidence: arabic, reason: '目标原文带附着连词' }], complete: true };
    expect(prepareTranslations(proposal, rows, `人工智能\n${arabic}`, { source: 'zh', target: 'ar' })[0]).toMatchObject({ target: term, basis: 'source', targetEvidence: arabic });
  });

  it('补全与复核拒绝错误目标文字，即使模型声明 approved=true', () => {
    const pair: LanguagePair = { source: 'ko', target: 'de' }, rows = [candidate('a', '인공지능')];
    const raw = { terms: [{ id: 'a', target: '人工知能', basis: 'suggested', certainty: 'standard', targetEvidence: '', reason: '模型错误建议' }], complete: true };
    const proposed = prepareTranslations(raw, rows, rows[0].source, pair);
    expect(proposed[0].target).toBe(''); expect(proposed[0].translationReview).toContain('德语');
    const forged = [{ ...rows[0], target: '人工知能' }];
    expect(approveTranslations({ terms: [{ id: 'a', approved: true, reason: '模型误批' }], complete: true }, forged, rows, pair)[0]).toMatchObject({ translation: false, translationAuto: false });
  });

  it('原文与目标证据仍需真实出现，未知姓名不自动纳入', () => {
    const pair: LanguagePair = { source: 'en', target: 'ja' }, rows = [candidate('a', 'Artificial Intelligence')];
    const raw = { terms: [{ id: 'a', target: '人工知能', basis: 'source', certainty: 'standard', targetEvidence: 'これは人工知能です', reason: '原文对照' }], complete: true };
    expect(prepareTranslations(raw, rows, 'Artificial Intelligence\nこれは人工知能です', pair)[0].basis).toBe('source');
    expect(prepareTranslations(raw, rows, 'Artificial Intelligence', pair)[0].basis).toBe('suggested');
    const names = [candidate('unknown', 'Unknown Person', '', { category: 'person' })];
    const uncertain = prepareTranslations({ terms: [{ id: 'unknown', target: '', basis: 'none', certainty: 'uncertain', targetEvidence: '', reason: '缺少官方日语姓名对照' }], complete: true }, names, 'Unknown Person', pair);
    expect(approveTranslations({ terms: [{ id: 'unknown', approved: true, reason: '错误批准' }], complete: true }, uncertain, names, pair)[0]).toMatchObject({ target: '', translation: false });
  });

  it('多语机构分类防止被模型猜成人名，并保留所有原字段', () => {
    const pair: LanguagePair = { source: 'en', target: 'de' }, rows = [candidate('a', 'Robert Koch Institute', 'Robert Koch Institut', { category: 'company', basis: 'source', translation: true })];
    const result = validateAuditResult({ terms: [{ id: 'a', category: 'person', priority: 80, riskReason: '', reviewReason: '', categoryEvidence: '错误人名推测' }], complete: true }, rows, pair);
    expect(result.candidates[0]).toMatchObject({ source: rows[0].source, target: rows[0].target, category: 'company', translation: true });
    expect(result.candidates[0].reviewReason).toContain('机构'); expect(result.languagePair).toEqual(pair);
  });

  it('动态提示词计入容量预算，未选择语言仍沿用旧预算', () => {
    const config = modelDefaults('deepseek');
    expect(modelPromptReserve()).toBe(promptTokenReserve); expect(callBudget(config, 'abc')).toEqual({ input: 3 + promptTokenReserve, output: config.maxOutputTokens });
    for (const { pair } of fixtures) {
      const reserve = modelPromptReserve(pair);
      expect(reserve).toBeGreaterThan(multilingualExtractionPrompt(pair).length);
      expect(reserve).toBeGreaterThan(multilingualTranslationPrompt(pair).length);
      expect(reserve).toBeGreaterThan(multilingualVerificationPrompt(pair).length);
      expect(callBudget(config, 'abc', pair).input).toBe(3 + reserve);
    }
  });
});
