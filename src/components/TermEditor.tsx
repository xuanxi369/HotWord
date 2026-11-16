import { useMemo, useRef, useState, type RefObject } from 'react';
import { AlertTriangle, Check, Trash2 } from 'lucide-react';
import { categoryNames, type Candidate, type Category } from '../../shared/schema';
import { applyCandidatePatch } from '../../shared/review';
import { translationSelectionStatus } from '../../shared/translation-review';
import { languageDirection, type LanguagePair } from '../../shared/languages';
import { OverlayPanel, PrioritySlider, Switch } from './ui';

type Props = {
  candidate?: Candidate; candidates: Candidate[]; pair?: LanguagePair; bidirectional: boolean; busy: boolean;
  initialField: 'source' | 'target'; onClose: () => void; onSave: (candidate: Candidate, joined: boolean) => void; onRemove: (candidate: Candidate) => void;
};

export function TermEditor(props: Props) {
  const initialFocus = useRef<HTMLInputElement>(null);
  return <OverlayPanel open={!!props.candidate} onOpenChange={open => { if (!open) props.onClose(); }} title="编辑词条" description="核对原词和译文，保存后更新词库。" className="term-dialog" initialFocus={() => initialFocus.current}>
    {props.candidate && <TermEditorForm key={props.candidate.id} {...props} candidate={props.candidate} initialFocus={initialFocus}/>}
  </OverlayPanel>;
}

function TermEditorForm({ candidate, candidates, pair, bidirectional, busy, initialField, initialFocus, onClose, onSave, onRemove }: Props & { candidate: Candidate; initialFocus: RefObject<HTMLInputElement | null> }) {
  const [draft, setDraft] = useState(candidate);
  const [categoryReviewed, setCategoryReviewed] = useState(false);
  const textChanged = draft.source !== candidate.source || draft.target !== candidate.target;
  const edited = useMemo(() => applyCandidatePatch(candidate, {
    source: draft.source, target: draft.target, priority: draft.priority, pinned: draft.pinned, translationForced: !!draft.translationForced,
    ...(draft.category !== candidate.category ? { category: draft.category } : {}),
    ...(categoryReviewed && draft.category === candidate.category ? { reviewReason: undefined, categoryEvidence: '已手动核对类别' } : {}),
    ...(textChanged ? { basis: 'manual' } : {}),
  }), [candidate, draft, categoryReviewed, textChanged]);
  const proposed = useMemo(() => candidates.map(c => c.id === edited.id ? edited : c), [candidates, edited]);
  const normalSelection = useMemo(() => translationSelectionStatus(proposed, edited.id, bidirectional, pair, false), [proposed, edited.id, bidirectional, pair]);
  const forcedSelection = useMemo(() => normalSelection?.attention ? translationSelectionStatus(proposed, edited.id, bidirectional, pair, true) : normalSelection, [proposed, edited.id, bidirectional, pair, normalSelection]);
  const selection = draft.translationForced ? forcedSelection : normalSelection;
  const canForce = Boolean(draft.target.trim() && normalSelection?.attention && forcedSelection && !forcedSelection.attention);
  const canJoin = Boolean(draft.target.trim() && selection && !selection.attention);
  const shouldJoin = canJoin && (!edited.translation || (!!edited.translationForced && !candidate.translationForced));
  const action = shouldJoin ? draft.translationForced ? '保存并强制加入' : '保存并加入指定翻译' : '保存修改';
  function save() {
    if (busy || !draft.source.trim()) return;
    const next = shouldJoin ? applyCandidatePatch(edited, { translation: true }) : candidate.translationForced && !edited.translationForced && !canJoin ? applyCandidatePatch(edited, { translation: false }) : edited;
    onSave(next, shouldJoin);
  }
  return <form className="term-editor-form" onSubmit={event => { event.preventDefault(); save(); }} onKeyDown={event => {
    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
  }}>
    <div className="term-edit-fields">
      <label>原词<input ref={initialField === 'source' ? initialFocus : undefined} required dir={pair ? languageDirection(pair.source) : undefined} lang={pair?.source} aria-label={`详细原词 ${candidate.source}`} maxLength={180} value={draft.source} onChange={event => setDraft(current => ({ ...current, source: event.target.value, translationForced: false }))}/></label>
      <label>译文<input ref={initialField === 'target' ? initialFocus : undefined} dir={pair ? languageDirection(pair.target) : undefined} lang={pair?.target} aria-label={`详细译文 ${candidate.source}`} maxLength={180} value={draft.target} onChange={event => setDraft(current => ({ ...current, target: event.target.value, translationForced: false }))} placeholder="填写对应译名"/></label>
      <label>类别<select aria-label={`类别 ${candidate.source}`} value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value as Category }))}>{Object.entries(categoryNames).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
    </div>
    {draft.target.trim() && normalSelection?.attention && <div className="term-editor-issue"><AlertTriangle size={14}/><div><p>此译法暂不能加入：{normalSelection.reasons.join('；')}。可以先保存修改。</p>{(canForce || draft.translationForced) && <div className="term-force-choice"><Switch checked={!!draft.translationForced} onChange={translationForced => setDraft(current => ({ ...current, translationForced }))} label="强制加入指定翻译" disabled={busy}/><p>已知以上原因，仍按客户要求加入。</p></div>}{draft.translationForced && selection?.attention && <p>强制项仍未纳入：{selection.reasons.join('；')}。</p>}</div></div>}
    <details className="term-editor-details"><summary>原文与核对依据</summary>
      <div className="evidence-card"><span className="small-kicker">{candidate.location || '手动录入'}</span><p>{candidate.evidence || '这个词条由你手动添加。'}</p></div>
      <div className="classification-note"><p>类别依据：{edited.categoryEvidence || '原表与规则识别'}</p>{candidate.riskReason && <p>易误译：{candidate.riskReason}</p>}{candidate.targetEvidence && <p>译名依据：{candidate.targetEvidence}</p>}{candidate.translationReview && <p>译法待核对：{candidate.translationReview}</p>}{edited.reviewReason && <><p>类别待核对：{edited.reviewReason}</p><button type="button" className="text-button" onClick={() => setCategoryReviewed(true)}>类别已核对<Check size={13}/></button></>}</div>
    </details>
    <details className="term-editor-details"><summary>导出设置</summary>
      <label className="term-editor-priority">导出优先级<PrioritySlider label={`导出优先级 ${candidate.source}`} value={draft.priority} onChange={priority => setDraft(current => ({ ...current, priority }))}/></label>
      <Switch checked={draft.pinned} onChange={pinned => setDraft(current => ({ ...current, pinned }))} label="字数不足时必须保留"/>
      <p className="term-editor-help">对已选择导出的条目生效，优先分配字数；仍无法纳入时，会暂停相关文件下载。</p>
      <button type="button" className="text-button remove-term" aria-label={`删除词条 ${candidate.source}`} onClick={() => onRemove(candidate)}><Trash2 size={14}/>删除词条</button>
    </details>
    <div className="dialog-actions term-editor-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy || !draft.source.trim()}>{action}<Check size={15}/></button></div>
  </form>;
}
