import type { Plan, SheetData } from '../../src/seating/lib/schema';
import { columnName } from '../../src/seating/lib/roster';
export const tinyImage =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
export function forumFixture() {
  const sheet: SheetData = { name: '测试座次表', cells: [] };
  let number = 1;
  const add = (row: number, col: number) =>
    sheet.cells.push({
      address: `${columnName(col)}${row}`,
      row,
      column: col,
      text: `测试嘉宾${number++}`,
    });
  for (let c = 24; c <= 45; c++) add(6, c);
  for (const row of [10, 12, 14, 16]) for (let c = 9; c <= 23; c++) add(row, c);
  for (let c = 17; c <= 23; c++) add(18, c);
  for (const row of [10, 12, 14, 16, 18]) for (let c = 26; c <= 43; c++) add(row, c);
  for (const row of [10, 12, 14, 16]) for (let c = 48; c <= 62; c++) add(row, c);
  for (let c = 48; c <= 50; c++) add(18, c);
  sheet.cells.find((c) => c.address === 'AO18')!.text = sheet.cells.find(
    (c) => c.address === 'AE18',
  )!.text;
  sheet.cells.find((c) => c.address === 'I12')!.text = '测试嘉宾（可能不到）';
  const plan: Plan = {
    summary: '测试分区',
    ignoredCells: [],
    warnings: [],
    zones: [
      { id: 'A', label: 'A区', position: '上方', rows: 1, columns: 20, range: 'X6:AS6' },
      { id: 'B', label: 'B区', position: '左侧', rows: 6, columns: 10, range: 'I10:W20' },
      { id: 'C', label: 'C区', position: '中间', rows: 6, columns: 12, range: 'Z10:AQ20' },
      { id: 'D', label: 'D区', position: '右侧', rows: 6, columns: 10, range: 'AV10:BJ20' },
    ].map((z) => ({
      id: z.id,
      label: z.label,
      position: z.position,
      rows: z.rows,
      columns: z.columns,
      direction: 'left-to-right',
      confidence: 'high',
      bbox: null,
      sources: [
        {
          sheet: sheet.name,
          range: z.range,
          mode: 'grid',
          nameColumn: null,
          phoneColumn: null,
          organizationColumn: null,
          titleColumn: null,
        },
      ],
    })),
  };
  return { sheets: [sheet], plan };
}
