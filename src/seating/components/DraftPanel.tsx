import { CheckCircle2, Loader2, Save } from 'lucide-react';
import type { useDraft } from '../hooks/useDraft';

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
export function DraftPanel({
  draft,
  hasWork,
  onClear,
}: {
  draft: ReturnType<typeof useDraft>;
  hasWork: boolean;
  onClear: () => void;
}) {
  if (!draft.ready)
    return (
      <div className="draft-panel" role="status">
        <Loader2 className="spin" size={16} />
        正在检查本机草稿…
      </div>
    );
  if (draft.pending)
    return (
      <section className="draft-panel draft-recovery">
        <div>
          <strong>发现上次整理的草稿</strong>
          <p>
            {draft.pending.workspace.excelName || '未命名工作'} ·{' '}
            {formatDate(draft.pending.savedAt)}
            <br />
            可恢复图片、原表、分区和人工修改；恢复后请重新核对。
          </p>
        </div>
        <div className="draft-actions">
          <button className="primary-btn" onClick={draft.restore}>
            恢复草稿
          </button>
          <button
            className="text-btn"
            onClick={() => {
              void draft.discard();
            }}
          >
            丢弃旧草稿
          </button>
        </div>
        {draft.error && (
          <p className="danger-text" role="alert">
            {draft.error}
          </p>
        )}
      </section>
    );
  if (!hasWork && !draft.error) return null;
  return (
    <section className="draft-panel">
      <div className="draft-status" role="status">
        {draft.status === 'saving' ? (
          <Loader2 className="spin" size={16} />
        ) : draft.status === 'saved' ? (
          <CheckCircle2 className="success-icon" size={16} />
        ) : (
          <Save size={16} />
        )}
        <div>
          <strong>
            {draft.status === 'saving'
              ? '正在保存本机草稿…'
              : draft.status === 'saved'
                ? '本机草稿已自动保存 · ' + formatDate(draft.savedAt)
                : draft.error
                  ? '本机草稿未保存'
                  : '等待保存草稿'}
          </strong>
          <p>图片和名单保存在此浏览器。模型与密钥不保存在草稿中。</p>
        </div>
      </div>
      <div className="draft-actions">
        {hasWork && (
          <button
            className="text-btn"
            onClick={() => {
              void draft.saveNow();
            }}
          >
            立即保存
          </button>
        )}
        <button className="text-btn danger-text" onClick={onClear}>
          清空工作与草稿
        </button>
      </div>
      {draft.error && (
        <p className="danger-text" role="alert">
          {draft.error} 保存失败时离开页面会提醒。
        </p>
      )}
    </section>
  );
}
