import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Plan, SourceCell } from '../lib/schema';
import { sourceId } from '../lib/roster';
import { Pagination } from './Pagination';

export function IgnoredPanel({
  cells,
  plan,
  onRestore,
}: {
  cells: Array<SourceCell & { sheet: string; id: string }>;
  plan: Plan;
  onRestore: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 40,
    safePage = Math.min(page, Math.max(0, Math.ceil(cells.length / pageSize) - 1));
  const reasons = new Map(
    plan.ignoredCells.map((cell) => [sourceId(cell.sheet, cell.address), cell.reason]),
  );
  if (!cells.length) return null;
  return (
    <details className="ignored-panel">
      <summary>已忽略 / 排除的数据（{cells.length} 个单元格）</summary>
      <p>AI 判断的标题和你排除的记录仍可恢复。恢复后需要重新核对。</p>
      {cells.slice(safePage * pageSize, (safePage + 1) * pageSize).map((cell) => (
        <div className="ignored-row" key={cell.id}>
          <code>{cell.id}</code>
          <span>{cell.text}</span>
          <small>{reasons.get(cell.id) || '手动排除'}</small>
          <button className="text-btn" onClick={() => onRestore(cell.id)}>
            <RotateCcw size={13} />
            恢复
          </button>
        </div>
      ))}
      <Pagination
        name="已忽略数据"
        total={cells.length}
        page={safePage}
        pageSize={pageSize}
        onPage={setPage}
      />
    </details>
  );
}
