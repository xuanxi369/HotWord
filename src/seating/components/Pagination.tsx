import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({
  name,
  total,
  page,
  pageSize,
  onPage,
}: {
  name: string;
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const last = Math.max(0, Math.ceil(total / pageSize) - 1),
    current = Math.min(page, last);
  return (
    <div className="table-footer">
      <span>
        {total
          ? '显示 ' + (current * pageSize + 1) + '–' + Math.min((current + 1) * pageSize, total)
          : '显示 0'}{' '}
        条，共 {total} 条
      </span>
      <div>
        <button
          className="icon-btn"
          aria-label={name + '上一页'}
          disabled={current === 0}
          onClick={() => onPage(current - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span>
          {current + 1} / {last + 1}
        </span>
        <button
          className="icon-btn"
          aria-label={name + '下一页'}
          disabled={current === last}
          onClick={() => onPage(current + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
