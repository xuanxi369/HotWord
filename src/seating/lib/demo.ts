import { columnName } from './roster';
import type { Plan, SheetData, Zone } from './schema';

export function demoData() {
  const sheet: SheetData = { name: '示例座次表', cells: [] };
  let index = 1;
  const add = (row: number, col: number, name?: string) =>
    sheet.cells.push({
      address: `${columnName(col)}${row}`,
      row,
      column: col,
      text: name || `示例嘉宾 ${String(index++).padStart(2, '0')}`,
    });
  for (let c = 5; c <= 8; c++) add(2, c);
  for (let r = 6; r <= 7; r++) for (let c = 1; c <= 3; c++) add(r, c);
  for (let r = 6; r <= 7; r++) for (let c = 5; c <= 8; c++) add(r, c);
  for (let r = 6; r <= 7; r++) for (let c = 10; c <= 12; c++) add(r, c);
  add(8, 5, '示例候选人（或替补嘉宾）');
  sheet.cells.find((c) => c.address === 'E7')!.text = sheet.cells.find(
    (c) => c.address === 'E6',
  )!.text;
  sheet.cells.push({ address: 'A1', row: 1, column: 1, text: '演示数据 · 会场座次表' });
  const zone = (
    id: string,
    label: string,
    position: string,
    rows: number,
    columns: number,
    range: string,
    bbox: Zone['bbox'],
  ): Zone => ({
    id,
    label,
    position,
    rows,
    columns,
    direction: id === 'A' ? 'center-out' : 'left-to-right',
    confidence: 'high',
    bbox,
    sources: [
      {
        sheet: sheet.name,
        range,
        mode: 'grid',
        nameColumn: null,
        phoneColumn: null,
        organizationColumn: null,
        titleColumn: null,
      },
    ],
  });
  const plan: Plan = {
    summary:
      '示例会场包含 A、B、C、D 四个分区。C 区有一条候选人备注和一组重名，人数超过图片容量 1 位，请核对。',
    warnings: ['示例数据用于体验完整流程，不会调用 AI。'],
    ignoredCells: [{ sheet: sheet.name, address: 'A1', reason: '表格标题' }],
    zones: [
      zone('A', 'A区', '舞台前方 · 沙发区', 1, 4, 'E2:H2', {
        x: 0.28,
        y: 0.25,
        width: 0.44,
        height: 0.15,
      }),
      zone('B', 'B区', '会场左侧', 2, 3, 'A6:C7', { x: 0.04, y: 0.53, width: 0.27, height: 0.38 }),
      zone('C', 'C区', '会场中间', 2, 4, 'E6:H8', { x: 0.35, y: 0.53, width: 0.3, height: 0.38 }),
      zone('D', 'D区', '会场右侧', 2, 3, 'J6:L7', { x: 0.69, y: 0.53, width: 0.27, height: 0.38 }),
    ],
  };
  return { sheets: [sheet], plan };
}
