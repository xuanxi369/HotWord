import { useMemo, useState } from 'react';
import type { RosterReview } from '../lib/roster';
import { Pagination } from './Pagination';

export function UnassignedPanel({
  review,
  onAssign,
  onIgnore,
}: {
  review: RosterReview;
  onAssign: (id: string, zoneId: string) => void;
  onIgnore: (id: string) => void;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(0);
  const cells = useMemo(
    () =>
      review.unassigned.filter(
        (cell) =>
          !search || (cell.text + ' ' + cell.id).toLowerCase().includes(search.toLowerCase()),
      ),
    [review.unassigned, search],
  );
  const pageSize = 40,
    safePage = Math.min(page, Math.max(0, Math.ceil(cells.length / pageSize) - 1));
  if (!review.unassigned.length) return null;
  return (
    <section className="unassigned-panel">
      <h3>这些单元格还没有归属（{review.unassigned.length}）</h3>
      <p>将人员分入对应区域，或将标题、说明等忽略。未处理完之前不能导出。</p>
      <label className="search-input pending-search">
        <input
          aria-label="搜索未归档数据"
          placeholder="搜索内容或单元格位置"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      </label>
      <div className="unassigned-list">
        {cells.slice(safePage * pageSize, (safePage + 1) * pageSize).map((cell) => (
          <div className="unassigned-row" key={cell.id}>
            <code>{cell.id}</code>
            <strong>
              {cell.text}
              {!cell.assignable && (
                <small>这项信息位于名单的非姓名列，请修正来源范围或忽略。</small>
              )}
            </strong>
            <select
              aria-label={'为 ' + cell.text + ' 指定分区'}
              value=""
              disabled={!cell.assignable}
              onChange={(event) => onAssign(cell.id, event.target.value)}
            >
              <option value="">选择分区</option>
              {review.zones.map((zone) => (
                <option value={zone.id} key={zone.id}>
                  {zone.label}
                </option>
              ))}
            </select>
            <button className="text-btn" onClick={() => onIgnore(cell.id)}>
              忽略
            </button>
          </div>
        ))}
        {!cells.length && <div className="empty-search">没有匹配的未归档数据。</div>}
      </div>
      <Pagination
        name="未归档"
        total={cells.length}
        page={safePage}
        pageSize={pageSize}
        onPage={setPage}
      />
    </section>
  );
}
