import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { JobInputSchema, type ExtractionResult } from '../shared/schema';
import { bisectText } from '../shared/chunks';
import { callBudget, extractChunk } from './ai';
import { HttpError } from './auth';
import type { Env } from './env';
import { executionConfig, extractionChunks, type ExecutionJob } from './jobs';
import { taskKey } from './credentials';
import { ModelError, OutputLimitError, teamKey } from './providers';
import { deleteObjects, recordUsage, releaseTask, reserveModelCall } from './store';

function failureMessage(reason: string) {
  return `提取失败：${reason.replace(/。+$/, '')}。未生成可下载的完整结果；可重新配置、重试或手动切换服务。`;
}

export class ExtractionWorkflow extends WorkflowEntrypoint<Env, { id: string }> {
  async run(event: WorkflowEvent<{ id: string }>, step: WorkflowStep) {
    const id = event.payload.id;
    try {
      const total = await step.do('start', async () => {
        const object = await this.env.FILES.get(`${id}/input.json`);
        if (!object) throw new NonRetryableError('任务输入已过期');
        const input = JobInputSchema.parse(await object.json());
        const job = await this.env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<ExecutionJob>();
        if (!job || !['queued', 'running'].includes(job.status)) throw new NonRetryableError('任务已取消');
        const count = extractionChunks(input.segments, executionConfig(this.env, job).config).length;
        if (!count) throw new NonRetryableError('没有可提取的文本');
        await this.env.DB.prepare("UPDATE jobs SET status='running', total=? WHERE id=? AND status='queued'").bind(count, id).run();
        return count;
      });
      const resultKeys: string[] = [];
      const extractPart = async (i: number, part?: 0 | 1): Promise<string | null> => {
        const suffix = part === undefined ? `${i}` : `${i}-${part}`;
        return step.do(`extract-${suffix}`, { retries: { limit: 1, delay: '10 seconds', backoff: 'constant' }, timeout: '3 minutes' }, async () => {
          // R2 stores content, while durable Workflow state stores only counts and object keys.
          const key = `${id}/chunk-${suffix}.json`;
          if (!(await this.env.FILES.head(key))) {
            const object = await this.env.FILES.get(`${id}/input.json`);
            if (!object) throw new NonRetryableError('任务输入已过期');
            const job = await this.env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<ExecutionJob>();
            if (!job || !['queued', 'running'].includes(job.status)) throw new NonRetryableError('任务已取消');
            const { config, pricing } = executionConfig(this.env, job);
            let chunk = extractionChunks(JobInputSchema.parse(await object.json()).segments, config)[i];
            if (part !== undefined) {
              const pieces = bisectText(chunk.text);
              if (!pieces) throw new NonRetryableError('片段无法继续拆分，请提高输出上限');
              chunk = { text: pieces[part], label: `${chunk.label} · 子片段 ${part + 1}`.slice(0, 180) };
            }
            let result: ExtractionResult;
            try {
              await reserveModelCall(this.env, job, pricing, callBudget(config, chunk.text));
              const keyValue = job.mode === 'personal' ? await taskKey(this.env, id, job.owner) : teamKey(this.env, config.provider);
              result = await extractChunk(this.env, config, keyValue, chunk.text, chunk.label, `ai-${suffix}`, usage => recordUsage(this.env, job, pricing, usage));
            } catch (e) {
              // Return only a split marker through Workflow state. Each smaller
              // part has its own timeout/retry; truncated content is never saved.
              if (e instanceof OutputLimitError && part === undefined && bisectText(chunk.text)) return null;
              const reason = e instanceof OutputLimitError ? '缩小片段后模型输出仍达到上限，请提高输出上限或减少所选内容'
                : e instanceof HttpError ? e.message : '模型或个人密钥配置不可用，请重新配置后重试';
              // Workflow may serialize the thrown error and lose its class.
              // Persist only our safe message before it crosses that boundary.
              await this.env.DB.prepare('UPDATE jobs SET error=? WHERE id=?').bind(failureMessage(reason), id).run();
              if (e instanceof ModelError && e.retryable) throw e;
              throw new NonRetryableError(reason);
            }
            await this.env.FILES.put(key, JSON.stringify(result));
          }
          return key;
        });
      };
      for (let i = 0; i < total; i++) {
        const key = await extractPart(i);
        if (key !== null) resultKeys.push(key);
        else {
          for (const part of [0, 1] as const) {
            const childKey = await extractPart(i, part);
            if (!childKey) throw new NonRetryableError('子片段结果缺失');
            resultKeys.push(childKey);
          }
        }
        await step.do(`progress-${i}`, async () => {
          await this.env.DB.prepare('UPDATE jobs SET progress=?,error=NULL WHERE id=?').bind(i + 1, id).run();
          return i + 1;
        });
      }
      await step.do('complete', async () => {
        const result: ExtractionResult = { candidates: [], warnings: [] };
        for (const key of resultKeys) {
          const object = await this.env.FILES.get(key);
          if (!object) throw new NonRetryableError('片段结果缺失');
          const chunk = await object.json<ExtractionResult>();
          result.candidates.push(...chunk.candidates); result.warnings.push(...chunk.warnings);
        }
        result.warnings = [...new Set(result.warnings)];
        if (resultKeys.length > total) result.warnings.push(`${resultKeys.length - total} 个片段达到输出预算，已自动拆小并完整处理；请核对候选词。`);
        if (!result.candidates.length) result.warnings.push('没有找到有原文依据的候选词，请检查文本或改用原表导入');
        await this.env.FILES.put(`${id}/result.json`, JSON.stringify(result));
        await this.env.DB.prepare("UPDATE jobs SET status='completed', error=NULL WHERE id=?").bind(id).run();
        await releaseTask(this.env, id);
        // Input is no longer needed once a result has been produced.
        await this.env.FILES.delete([`${id}/input.json`, ...resultKeys]);
        return result.candidates.length;
      });
    } catch (e) {
      await step.do('mark-failed', async () => {
        await releaseTask(this.env, id);
        const reason = e instanceof ModelError || e instanceof NonRetryableError ? e.message : '模型调用或后台处理失败，请检查额度与配置后重试';
        const saved = await this.env.DB.prepare('SELECT error FROM jobs WHERE id=?').bind(id).first<{ error: string | null }>();
        await this.env.DB.prepare("UPDATE jobs SET status='failed', error=? WHERE id=?").bind(saved?.error || failureMessage(reason), id).run();
        await deleteObjects(this.env, id);
        return false;
      });
      throw new NonRetryableError('Extraction failed; see task status');
    }
  }
}
