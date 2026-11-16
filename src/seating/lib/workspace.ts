import { z } from 'zod';
import { planSchema, sheetSchema, type Plan, type SheetData } from './schema';
import { buildRoster, columnName, parseAddress } from './roster';

const text = z.string().max(512);
export const workspaceSchema = z
  .object({
    sheets: z.array(sheetSchema).max(20),
    selectedSheets: z.array(z.string().min(1).max(64)).max(20),
    excelName: z.string().max(255),
    imageName: z.string().max(255),
    image: z
      .string()
      .max(3_000_000)
      .refine(
        (value) =>
          !value ||
          value === '/seating-demo-venue.svg' ||
          /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value),
      ),
    plan: planSchema.nullable(),
    overrides: z.record(
      z.string(),
      z
        .object({
          name: text.optional(),
          phone: text.optional(),
          organization: text.optional(),
          title: text.optional(),
          zoneId: z.string().max(32).optional(),
        })
        .strict(),
    ),
    excluded: z.array(z.string()).max(4000),
    manualAssignments: z.record(z.string(), z.string().max(32)),
    notes: z.string().max(1500),
    demo: z.boolean(),
    resultModel: z.string().max(256),
  })
  .strict();
export type Workspace = z.infer<typeof workspaceSchema>;

export function emptyWorkspace(): Workspace {
  return {
    sheets: [],
    selectedSheets: [],
    excelName: '',
    imageName: '',
    image: '',
    plan: null,
    overrides: {},
    excluded: [],
    manualAssignments: {},
    notes: '',
    demo: false,
    resultModel: '',
  };
}
export const hasWorkspace = (workspace: Workspace) =>
  !!(workspace.sheets.length || workspace.image || workspace.notes);

export function validateWorkspace(value: unknown): Workspace {
  const workspace = workspaceSchema.parse(value);
  const names = new Set<string>();
  for (const sheet of workspace.sheets) {
    if (names.has(sheet.name)) throw new Error('草稿的工作表名称重复。');
    names.add(sheet.name);
    const addresses = new Set<string>();
    for (const cell of sheet.cells) {
      const position = parseAddress(cell.address);
      if (
        addresses.has(cell.address) ||
        position.row !== cell.row ||
        position.column !== cell.column
      )
        throw new Error('草稿的单元格坐标无效。');
      addresses.add(cell.address);
    }
  }
  if (
    new Set(workspace.selectedSheets).size !== workspace.selectedSheets.length ||
    workspace.selectedSheets.some((name) => !names.has(name))
  )
    throw new Error('草稿的工作表选择无效。');
  if (workspace.plan)
    buildRoster(
      workspace.plan,
      workspace.sheets.filter((sheet) => workspace.selectedSheets.includes(sheet.name)),
      workspace,
    );
  return workspace;
}

export function createManualPlan(sheets: SheetData[]): Plan {
  const first = sheets[0];
  const rows = first.cells.map((cell) => cell.row),
    columns = first.cells.map((cell) => cell.column);
  return {
    summary: '手动整理：请根据会场图设置各分区和人员来源范围。',
    warnings: [],
    ignoredCells: [],
    zones: [
      {
        id: 'A',
        label: 'A区',
        position: '',
        rows: null,
        columns: null,
        direction: 'unknown',
        confidence: 'high',
        bbox: null,
        sources: [
          {
            sheet: first.name,
            range:
              columnName(Math.min(...columns)) +
              Math.min(...rows) +
              ':' +
              columnName(Math.max(...columns)) +
              Math.max(...rows),
            mode: 'grid',
            nameColumn: null,
            phoneColumn: null,
            organizationColumn: null,
            titleColumn: null,
          },
        ],
      },
    ],
  };
}
