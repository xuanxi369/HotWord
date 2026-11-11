import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { JobInputSchema, type ExtractionResult } from '../shared/schema';
import { bisectText } from '../shared/chunks';
import { auditRows, bisectAudit } from '../shared/table-audit';
import { auditChunk } from './table-audit';
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
        const count = extractionChunks(input.segments, executionConfig(this.env, job).config, input.auditCandidates).length;
        if (!count) throw new NonRetryableError('没有可提取的文本');
        await this.env.DB.prepare("UPDATE jobs SET status='running', total=? WHERE id=? AND status='queued'").bind(count, id).run();
        return count;
      });
      const resultKeys: string[] = [];
      let splits = 0;
      const extractPart = async (i: number, path = ''): Promise<string | null> => {
        const suffix = path ? `${i}-${path}` : `${i}`;
        return step.do(`extract-${suffix}`, { retries: { limit: 1, delay: '10 seconds', backoff: 'constant' }, timeout: '3 minutes' }, async () => {
          // R2 stores content, while durable Workflow state stores only counts and object keys.
          const key = `${id}/chunk-${suffix}.json`;
          if (!(await this.env.FILES.head(key))) {
            const object = await this.env.FILES.get(`${id}/input.json`);
            if (!object) throw new NonRetryableError('任务输入已过期');
            const job = await this.env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<ExecutionJob>();
            if (!job || !['queued', 'running'].includes(job.status)) throw new NonRetryableError('任务已取消');
            const { config, pricing } = executionConfig(this.env, job);
            const input = JobInputSchema.parse(await object.json());
            const split = input.auditCandidates ? bisectAudit : bisectText;
            let chunk = extractionChunks(input.segments, config, input.auditCandidates)[i];
            for (const part of path) {
              const pieces = split(chunk.text);
              if (!pieces) throw new NonRetryableError('片段无法继续拆分，请提高输出上限');
              chunk = { ...chunk, text: pieces[part === '0' ? 0 : 1] };
            }
            if (path) chunk.label = `${chunk.label} · 子片段 ${path}`.slice(0, 180);
            let result: ExtractionResult;
            try {
              await reserveModelCall(this.env, job, pricing, callBudget(config, chunk.text));
              const keyValue = job.mode === 'personal' ? await taskKey(this.env, id, job.owner) : teamKey(this.env, config.provider);
              const record = (usage: Parameters<typeof recordUsage>[3]) => recordUsage(this.env, job, pricing, usage);
              result = input.auditCandidates ? await auditChunk(this.env, config, keyValue, chunk.text, auditRows(chunk.text, input.auditCandidates), record)
                : await extractChunk(this.env, config, keyValue, chunk.text, chunk.label, `ai-${suffix}`, record);
            } catch (e) {
              // Return only a split marker through Workflow state. Each smaller
              // part has its own timeout/retry; truncated content is never saved.
              if (e instanceof OutputLimitError && split(chunk.text)) return null;
              const reason = e instanceof OutputLimitError ? '最小片段仍无法完整输出，请提高模型单次输出容量或更换模型'
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
      const extractAll = async (i: number, path = ''): Promise<void> => {
        const key = await extractPart(i, path);
        if (key !== null) resultKeys.push(key);
        else {
          // Every split strictly shortens the text, so recovery is finite.
          splits++;
          await extractAll(i, `${path}0`); await extractAll(i, `${path}1`);
        }
      };
      for (let i = 0; i < total; i++) {
        await extractAll(i);
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
        if (splits) result.warnings.push(`已自动拆小 ${splits} 次并完成全部子片段提取；请核对候选词。`);
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
