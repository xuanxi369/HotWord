import { z } from 'zod';

export const Category = z.enum(['person', 'place', 'company', 'product', 'industry', 'other']);
export type Category = z.infer<typeof Category>;
export const categoryNames: Record<Category, string> = {
  person: '人名', place: '地名', company: '机构 / 公司', product: '产品 / 牌号', industry: '行业术语', other: '其他',
};
export const CandidateSchema = z.object({
  id: z.string().max(120),
  source: z.string().min(1).max(180),
  target: z.string().max(180),
  category: Category,
  priority: z.number().int().min(0).max(100),
  basis: z.enum(['source', 'suggested', 'none', 'manual']),
  evidence: z.string().max(400),
  location: z.string().max(180),
  hot: z.boolean(),
  translation: z.boolean(),
  pinned: z.boolean(),
});
export type Candidate = z.infer<typeof CandidateSchema>;
export const SegmentSchema = z.object({
  id: z.string().min(1).max(100), label: z.string().max(180), text: z.string().max(120_000),
});
export type Segment = z.infer<typeof SegmentSchema>;
export type ParsedSegment = Segment & { rows?: string[][] };
export type ParsedFile = { name: string; kind: string; segments: ParsedSegment[]; warnings: string[] };
export const JobInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  segments: z.array(SegmentSchema).min(1).max(80),
}).refine(v => v.segments.reduce((n, s) => n + s.text.length, 0) <= 120_000, '解析文本超过 120000 字符，请分批处理');
export type JobInput = z.infer<typeof JobInputSchema>;
export type Job = { id: string; name: string; status: 'queued' | 'running' | 'completed' | 'failed'; progress: number; total: number; error: string | null; created_at: number };
export type ExtractionResult = { candidates: Candidate[]; warnings: string[] };
