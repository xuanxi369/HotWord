import { useState } from 'react';
import { columnName } from '../lib/roster';
import type { SheetData } from '../lib/schema';

export function SourcePreview({ sheets }: { sheets: SheetData[] }) {
  const [name, setName] = useState(sheets[0].name);
  const sheet = sheets.find((s) => s.name === name) || sheets[0];
  const minRow = Math.min(...sheet.cells.map((c) => c.row)),
    maxRow = Math.min(minRow + 29, Math.max(...sheet.cells.map((c) => c.row)));
  const minColumn = Math.min(...sheet.cells.map((c) => c.column)),
    maxColumn = Math.min(minColumn + 59, Math.max(...sheet.cells.map((c) => c.column)));
  const rows = Array.from({ length: maxRow - minRow + 1 }, (_, i) => minRow + i),
    columns = Array.from({ length: maxColumn - minColumn + 1 }, (_, i) => minColumn + i);
  const lookup = new Map(sheet.cells.map((c) => [c.address, c.text]));
  return (
    <details className="source-preview">
      <summary>查看原始表格和单元格坐标</summary>
      <div className="source-preview-tools">
        <select
          aria-label="预览工作表"
          value={sheet.name}
          onChange={(e) => setName(e.target.value)}
        >
          {sheets.map((s) => (
            <option key={s.name}>{s.name}</option>
          ))}
        </select>
        <span>预览最多 30 行 × 60 列；分析使用选中的全部非空数据。</span>
      </div>
      <div className="source-grid-scroll">
        <table className="source-grid">
          <thead>
            <tr>
              <th></th>
              {columns.map((c) => (
                <th key={c}>{columnName(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <th>{r}</th>
                {columns.map((c) => (
                  <td key={c} title={`${columnName(c)}${r}`}>
                    {lookup.get(`${columnName(c)}${r}`) || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
