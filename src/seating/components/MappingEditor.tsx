import { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { planSchema, type Plan, type SheetData, type SourceRange, type Zone } from '../lib/schema';
import { buildRoster } from '../lib/roster';
import { useDialog } from '../hooks/useDialog';

export function MappingEditor({
  plan,
  sheets,
  onSave,
  onClose,
}: {
  plan: Plan;
  sheets: SheetData[];
  onSave: (plan: Plan) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Plan>(() => structuredClone(plan));
  const [error, setError] = useState('');
  const dialog = useDialog(onClose);
  const changed = JSON.stringify(draft) !== JSON.stringify(plan);
  useEffect(() => {
    if (!changed) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);
  const updateZone = (i: number, change: Partial<Zone>) =>
    setDraft((p) => ({
      ...p,
      zones: p.zones.map((z, j) => (j === i ? { ...z, ...change, confidence: 'high' } : z)),
    }));
  const updateSource = (zi: number, si: number, change: Partial<SourceRange>) =>
    updateZone(zi, {
      sources: draft.zones[zi].sources.map((s, j) => (j === si ? { ...s, ...change } : s)),
    });
  const sourceDefault = (): SourceRange => ({
    sheet: sheets[0].name,
    range: `${sheets[0].cells[0].address}:${sheets[0].cells[0].address}`,
    mode: 'grid',
    nameColumn: null,
    phoneColumn: null,
    organizationColumn: null,
    titleColumn: null,
  });
  function save() {
    try {
      const checked = planSchema.parse(draft);
      const result = buildRoster(checked, sheets);
      if (result.errors.length) throw new Error(result.errors[0]);
      onSave(checked);
    } catch (e) {
      setError(e instanceof Error ? e.message : '请检查分区范围。');
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="modal mapping-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mapping-title"
      >
        <div className="modal-title">
          <div>
            <h2 id="mapping-title">确认分区与数据范围</h2>
            <p>分区名称按会场图填写，人员范围按 Excel 单元格填写。</p>
          </div>
          <button className="icon-btn" aria-label="关闭分区编辑" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="mapping-list">
          {draft.zones.map((zone, zi) => (
            <div className="mapping-zone" key={zone.id}>
              <div className="mapping-fields">
                <label>
                  分区名称
                  <input
                    value={zone.label}
                    onChange={(e) => updateZone(zi, { label: e.target.value })}
                  />
                </label>
                <label>
                  会场位置
                  <input
                    value={zone.position}
                    onChange={(e) => updateZone(zi, { position: e.target.value })}
                  />
                </label>
                <label>
                  排数
                  <input
                    type="number"
                    min="1"
                    value={zone.rows ?? ''}
                    placeholder="未知留空"
                    onChange={(e) =>
                      updateZone(zi, {
                        rows: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </label>
                <label>
                  每排列数
                  <input
                    type="number"
                    min="1"
                    value={zone.columns ?? ''}
                    placeholder="未知留空"
                    onChange={(e) =>
                      updateZone(zi, {
                        columns: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </label>
                <button
                  className="icon-btn danger-text"
                  aria-label={`删除 ${zone.label}`}
                  onClick={() =>
                    setDraft((p) => ({
                      ...p,
                      zones: p.zones.filter((_, j) => j !== zi),
                    }))
                  }
                >
                  <Trash2 size={17} />
                </button>
              </div>
              {zone.sources.map((source, si) => (
                <div className="mapping-source" key={si}>
                  <div className="source-fields">
                    <label>
                      工作表
                      <select
                        value={source.sheet}
                        onChange={(e) => updateSource(zi, si, { sheet: e.target.value })}
                      >
                        {sheets.map((s) => (
                          <option key={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      人员所在范围
                      <input
                        value={source.range}
                        placeholder="I10:W18"
                        onChange={(e) =>
                          updateSource(zi, si, {
                            range: e.target.value.toUpperCase().replace(/\$/g, '').trim(),
                          })
                        }
                      />
                    </label>
                    <label>
                      表格布局
                      <select
                        value={source.mode}
                        onChange={(e) =>
                          updateSource(zi, si, {
                            mode: e.target.value as SourceRange['mode'],
                            nameColumn: e.target.value === 'table' ? 'A' : null,
                            phoneColumn: null,
                            organizationColumn: null,
                            titleColumn: null,
                          })
                        }
                      >
                        <option value="grid">座次网格 · 每格一人</option>
                        <option value="table">人员名单 · 每行一人</option>
                      </select>
                    </label>
                    {zone.sources.length > 1 && (
                      <button
                        className="icon-btn"
                        aria-label="移除这个来源范围"
                        onClick={() =>
                          updateZone(zi, {
                            sources: zone.sources.filter((_, j) => j !== si),
                          })
                        }
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  {source.mode === 'table' && (
                    <div className="column-fields">
                      {(
                        [
                          ['nameColumn', '姓名列'],
                          ['phoneColumn', '手机号列'],
                          ['organizationColumn', '单位列'],
                          ['titleColumn', '职务列'],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            value={source[key] ?? ''}
                            placeholder={key === 'nameColumn' ? '如 A' : '无则留空'}
                            onChange={(e) =>
                              updateSource(zi, si, {
                                [key]: e.target.value.toUpperCase().trim() || null,
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <button
                className="text-btn small"
                onClick={() =>
                  updateZone(zi, {
                    sources: [...zone.sources, sourceDefault()],
                  })
                }
              >
                <Plus size={14} /> 添加一个来源范围
              </button>
            </div>
          ))}
        </div>
        <button
          className="secondary-btn"
          onClick={() =>
            setDraft((p) => ({
              ...p,
              zones: [
                ...p.zones,
                {
                  id: `zone-${Date.now()}`,
                  label: `新分区${p.zones.length + 1}`,
                  position: '',
                  rows: null,
                  columns: null,
                  direction: 'unknown',
                  confidence: 'high',
                  bbox: null,
                  sources: [sourceDefault()],
                },
              ],
            }))
          }
        >
          <Plus size={16} />
          新增分区
        </button>
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <span>
            {changed
              ? '分区修改尚未保存到草稿，点击「应用分区」后会自动保存。'
              : '范围应只包含人员；表头和空白可在名单中核对、排除。'}
          </span>
          <button className="primary-btn" onClick={save}>
            应用分区
          </button>
        </div>
      </section>
    </div>
  );
}
