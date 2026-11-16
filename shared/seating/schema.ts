import { z } from 'zod';
import { ModelSelectionSchema } from '../models';

export const MAX_CELLS = 4000;
export const MAX_ROWS = 1000;
export const MAX_COLUMNS = 200;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const HEADERS = ['姓名', '手机号', '单位', '职务', '分座区域'] as const;

const column = z.string().regex(/^[A-Z]{1,3}$/);
const address = z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,3}$/);
const cellRange = z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,3}:[A-Z]{1,3}[1-9]\d{0,3}$/);
export const sourceRangeSchema = z
  .object({
    sheet: z.string().min(1).max(64),
    range: cellRange,
    mode: z.enum(['grid', 'table']),
    nameColumn: column.nullable(),
    phoneColumn: column.nullable(),
    organizationColumn: column.nullable(),
    titleColumn: column.nullable(),
  })
  .strict();
export const zoneSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),
    label: z.string().min(1).max(40),
    position: z.string().max(100),
    rows: z.number().int().min(1).max(1000).nullable(),
    columns: z.number().int().min(1).max(200).nullable(),
    direction: z.enum(['left-to-right', 'center-out', 'unknown']),
    confidence: z.enum(['high', 'medium', 'low']),
    bbox: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1),
      })
      .strict()
      .nullable(),
    sources: z.array(sourceRangeSchema).min(1).max(20),
  })
  .strict();
export const planSchema = z
  .object({
    summary: z.string().max(1000),
    zones: z.array(zoneSchema).min(1).max(24),
    ignoredCells: z
      .array(
        z
          .object({ sheet: z.string().min(1).max(64), address, reason: z.string().min(1).max(200) })
          .strict(),
      )
      .max(MAX_CELLS),
    warnings: z.array(z.string().max(500)).max(30),
  })
  .strict();

export const sheetSchema = z
  .object({
    name: z.string().min(1).max(64),
    cells: z
      .array(
        z
          .object({
            address,
            row: z.number().int().min(1).max(MAX_ROWS),
            column: z.number().int().min(1).max(MAX_COLUMNS),
            text: z.string().min(1).max(512),
          })
          .strict(),
      )
      .max(MAX_CELLS),
  })
  .strict();
export const analyzeSchema = z
  .object({
    selection: ModelSelectionSchema,
    image: z
      .string()
      .max(3_000_000)
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
    sheets: z.array(sheetSchema).min(1).max(20),
    notes: z.string().max(1500),
  })
  .strict();

export type SourceRange = z.infer<typeof sourceRangeSchema>;
export type Zone = z.infer<typeof zoneSchema>;
export type Plan = z.infer<typeof planSchema>;
export type SheetData = z.infer<typeof sheetSchema>;
export type SourceCell = SheetData['cells'][number];
export type AnalyzeInput = z.infer<typeof analyzeSchema>;
export interface RosterFields {
  name: string;
  phone: string;
  organization: string;
  title: string;
  zone: string;
}
export type PersonOverride = Partial<Omit<RosterFields, 'zone'>> & { zoneId?: string };
export interface Person extends RosterFields {
  id: string;
  sourceSheet: string;
  sourceAddress: string;
  zoneId: string;
}
export interface AnalysisResult {
  plan: Plan;
  provider: string;
  model: string;
}
