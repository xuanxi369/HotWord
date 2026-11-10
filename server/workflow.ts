import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { JobInputSchema, type ExtractionResult } from '../shared/schema';
import { chunkSegments } from '../shared/chunks';
import { extractChunk } from './ai';
import type { Env } from './env';
import { chunkSize, executionConfig, type ExecutionJob } from './jobs';
import { taskKey } from './credentials';
import { ModelError, teamKey } from './providers';
import { deleteObjects, recordUsage, releaseTask } from './store';

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
        const count = chunkSegments(input.segments, chunkSize(executionConfig(this.env, job).config)).length;
        if (!count) throw new NonRetryableError('没有可提取的文本');
        await this.env.DB.prepare("UPDATE jobs SET status='running', total=? WHERE id=? AND status='queued'").bind(count, id).run();
        return count;
      });
      for (let i = 0; i < total; i++) {
        await step.do(`extract-${i}`, { retries: { limit: 1, delay: '10 seconds', backoff: 'constant' }, timeout: '3 minutes' }, async () => {
          // R2 stores content, while durable Workflow state stores only counts and object keys.
          const key = `${id}/chunk-${i}.json`;
          if (!(await this.env.FILES.head(key))) {
            const object = await this.env.FILES.get(`${id}/input.json`);
            if (!object) throw new NonRetryableError('任务输入已过期');
            const job = await this.env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<ExecutionJob>();
            if (!job || !['queued', 'running'].includes(job.status)) throw new NonRetryableError('任务已取消');
            const { config, pricing } = executionConfig(this.env, job);
            const chunk = chunkSegments(JobInputSchema.parse(await object.json()).segments, chunkSize(config))[i];
            let result: ExtractionResult;
            try {
              const keyValue = job.mode === 'personal' ? await taskKey(this.env, id, job.owner) : teamKey(this.env, config.provider);
              result = await extractChunk(this.env, config, keyValue, chunk.text, chunk.label, `ai-${i}`, usage => recordUsage(this.env, job, pricing, usage));
            } catch (e) {
              if (e instanceof ModelError && e.retryable) throw e;
              throw new NonRetryableError(e instanceof ModelError ? e.message : '模型或个人密钥配置不可用，请重新配置后重试');
            }
            await this.env.FILES.put(key, JSON.stringify(result));
          }
          await this.env.DB.prepare('UPDATE jobs SET progress=? WHERE id=?').bind(i + 1, id).run();
          return key;
        });
      }
      await step.do('complete', async () => {
        const result: ExtractionResult = { candidates: [], warnings: [] };
        for (let i = 0; i < total; i++) {
          const object = await this.env.FILES.get(`${id}/chunk-${i}.json`);
          if (!object) throw new NonRetryableError('片段结果缺失');
          const chunk = await object.json<ExtractionResult>();
          result.candidates.push(...chunk.candidates); result.warnings.push(...chunk.warnings);
        }
        result.warnings = [...new Set(result.warnings)];
        if (!result.candidates.length) result.warnings.push('没有找到有原文依据的候选词，请检查文本或改用原表导入');
        await this.env.FILES.put(`${id}/result.json`, JSON.stringify(result));
        await this.env.DB.prepare("UPDATE jobs SET status='completed', error=NULL WHERE id=?").bind(id).run();
        await releaseTask(this.env, id);
        // Input is no longer needed once a result has been produced.
        await this.env.FILES.delete([`${id}/input.json`, ...Array.from({ length: total }, (_, i) => `${id}/chunk-${i}.json`)]);
        return result.candidates.length;
      });
    } catch (e) {
      await step.do('mark-failed', async () => {
        await releaseTask(this.env, id);
        const reason = e instanceof ModelError || e instanceof NonRetryableError ? e.message : '模型调用或后台处理失败，请检查额度与配置后重试';
        await this.env.DB.prepare("UPDATE jobs SET status='failed', error=? WHERE id=?").bind(`提取失败：${reason}。未生成可下载的完整结果；可重新配置、重试或手动切换服务。`, id).run();
        await deleteObjects(this.env, id);
        return false;
      });
      throw new NonRetryableError('Extraction failed; see task status');
    }
  }
}
