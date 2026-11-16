import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import type { RosterReview } from '../lib/roster';
import type { Person, PersonOverride } from '../lib/schema';
export function RosterTable({
  review,
  filter,
  setFilter,
  editPerson,
  exclude,
}: {
  review: RosterReview;
  filter: string;
  setFilter: (filter: string) => void;
  editPerson: (person: Person, key: keyof PersonOverride, value: string) => void;
  exclude: (id: string) => void;
}) {
  const plan = review;
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(0);
  const [editingIds, setEditingIds] = useState<string[]>();
  useEffect(() => { setPage(0); setEditingIds(undefined); }, [filter]);
  const filtered = useMemo(
    () =>
      review.people.filter(
        (person) =>
          (filter === 'all' || person.zoneId === filter) &&
          (!search ||
            [
              person.name,
              person.phone,
              person.organization,
              person.title,
              person.zone,
              person.sourceAddress,
            ].some((value) => value.toLowerCase().includes(search.toLowerCase()))),
      ),
    [review.people, filter, search],
  );
  const pageSize = 40,
    maxPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1),
    safePage = Math.min(page, maxPage);
  // Hold the visible rows while editing so changing a search match cannot remove focus.
  const shown = editingIds
    ? editingIds.flatMap(id => review.people.filter(person => person.id === id))
    : filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  return (
    <section className="roster-card">
      <div className="roster-toolbar">
        <div>
          <h3>
            人员名单 <span className="count-badge">{review.people.length}</span>
          </h3>
          <p>可直接修改字段，原始单元格位置保留用于核对。</p>
        </div>
        <label className="search-input">
          <input
            aria-label="搜索人员"
            placeholder="搜索姓名、单位或单元格"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
              setEditingIds(undefined);
            }}
          />
        </label>
      </div>
      <div className="filter-tabs">
        <button
          className={filter === 'all' ? 'active' : ''}
          onClick={() => {
            setFilter('all');
            setPage(0);
          }}
        >
          全部 <span>{review.people.length}</span>
        </button>
        {review.zones.map((z) => (
          <button
            key={z.id}
            className={filter === z.id ? 'active' : ''}
            onClick={() => {
              setFilter(z.id);
              setPage(0);
            }}
          >
            {z.label} <span>{z.count}</span>
          </button>
        ))}
      </div>
      <div className="roster-scroll">
        <table className="roster-table" onFocusCapture={event => {
          if (!editingIds && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) setEditingIds(shown.map(person => person.id));
        }} onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditingIds(undefined);
        }}>
          <thead>
            <tr>
              <th className="index-col">序号</th>
              <th>姓名</th>
              <th>手机号</th>
              <th>单位</th>
              <th>职务</th>
              <th>分座区域</th>
              <th>原表位置</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((person, i) => (
              <tr
                key={person.id}
                className={
                  review.duplicates.has(person.name) || /[（(]/.test(person.name)
                    ? 'needs-review'
                    : ''
                }
              >
                <td className="row-index">{safePage * pageSize + i + 1}</td>
                {(['name', 'phone', 'organization', 'title'] as const).map((key) => (
                  <td key={key}>
                    <input
                      aria-label={`${person.sourceAddress} ${key === 'name' ? '姓名' : key === 'phone' ? '手机号' : key === 'organization' ? '单位' : '职务'}`}
                      value={person[key]}
                      maxLength={512}
                      placeholder={key === 'name' ? '姓名' : '—'}
                      title={person[key]}
                      onChange={(e) => editPerson(person, key, e.target.value)}
                    />
                    {key === 'name' && review.duplicates.has(person.name) && (
                      <span className="duplicate-label">重名</span>
                    )}
                  </td>
                ))}
                <td>
                  <select
                    aria-label={`${person.sourceAddress} 分座区域`}
                    value={person.zoneId}
                    onChange={(e) => editPerson(person, 'zoneId', e.target.value)}
                  >
                    {plan.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td
                  className="source-address"
                  title={`${person.sourceSheet}!${person.sourceAddress}`}
                >
                  {person.sourceAddress}
                </td>
                <td>
                  <button
                    className="icon-btn remove-person"
                    aria-label={`排除 ${person.name}`}
                    onClick={() => {
                      exclude(person.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <div className="empty-search">没有匹配的人员记录。</div>}
      </div>
      <div className="table-footer">
        <span>
          显示{' '}
          {filtered.length
            ? `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, filtered.length)}`
            : '0'}{' '}
          条，共 {filtered.length} 条
        </span>
        <div>
          <button
            className="icon-btn"
            aria-label="上一页"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {safePage + 1} / {maxPage + 1}
          </span>
          <button
            className="icon-btn"
            aria-label="下一页"
            disabled={safePage === maxPage}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </section>
  );
}
