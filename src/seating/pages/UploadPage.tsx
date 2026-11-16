import { ArrowRight, FileSpreadsheet, Loader2, LockKeyhole, Sparkles } from 'lucide-react';
import { UploadBox } from '../components/UploadBox';
import type { RosterWorkspace } from '../hooks/useRosterWorkspace';
import type { WorkspaceSession } from '../../useWorkspaceSession';
import { Settings2 } from 'lucide-react';
import { visionUnavailable } from '../../../shared/vision';
export function UploadPage({
  work,
  session,
  onSettings,
  onAnalyze,
  onManual,
  disabled,
}: {
  work: RosterWorkspace;
  session: WorkspaceSession;
  onSettings: () => void;
  onAnalyze: () => void;
  onManual: () => void;
  disabled: boolean;
}) {
  const { sheets, selectedSheets, imageName, image, excelName, notes } = work.workspace;
  const { activeSheets, reading, uploadImage, uploadExcel, setNotes, toggleSheet } = work;
  const busy = work.busy;
  const locked = busy || disabled;
  const selection = session.selection;
  const chosen = selection?.mode === 'team'
    ? session.modelSettings?.services.find(item => item.id === selection.serviceId)
    : selection?.mode === 'personal' ? session.modelSettings?.credentials.find(item => item.id === selection.credentialId) : undefined;
  const unavailable = chosen && visionUnavailable(chosen.config);
  const analyze = onAnalyze,
    startManual = onManual;
  return (
    <>
      <div className="upload-grid">
        <UploadBox
          kind="image"
          name={imageName}
          image={image}
          busy={busy || reading}
          disabled={disabled}
          onFile={uploadImage}
        />
        <UploadBox
          kind="excel"
          name={excelName}
          busy={busy || reading}
          disabled={disabled}
          onFile={uploadExcel}
        />
      </div>
      {sheets.length > 0 && (
        <div className="sheet-selection">
          <span>参与分析的工作表</span>
          {sheets.map((sheet) => (
            <label key={sheet.name}>
              <input
                type="checkbox"
                checked={selectedSheets.includes(sheet.name)}
                disabled={locked || reading}
                onChange={(e) => {
                  toggleSheet(sheet.name, e.target.checked);
                }}
              />
              {sheet.name}
              <small>{sheet.cells.length} 个非空格</small>
            </label>
          ))}
        </div>
      )}
      <section className="analysis-card">
        <div className="analysis-card-title">
          <span className="analysis-spark">
            <Sparkles size={20} />
          </span>
          <div>
            <h3>AI 理解布局，原表保留姓名</h3>
            <p>识别会场分区，匹配表格范围，再由你核对导出。</p>
          </div>

        </div>
        <div className="analysis-controls">
          <div className="model-select">
            <span>本次识别服务</span>
            <button type="button" className="secondary-btn seating-model-button" onClick={onSettings} disabled={locked || reading}>
              <Settings2 size={15}/><span>{chosen ? chosen.name : session.modelsLoading ? '读取配置中…' : '选择模型与密钥'}<small>{chosen?.config.model}</small></span>
            </button>
          </div>
          <label className="notes-input">
            补充说明 <span>（可选）</span>
            <input
              maxLength={1500}
              value={notes}
              disabled={locked || reading}
              placeholder="例如：舞台下方是 A 区，左侧是 B 区"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <button
            className="primary-btn analyze-btn"
            disabled={locked || reading || !image || !activeSheets.length}
            onClick={analyze}
          >
            {busy ? (
              <>
                <Loader2 className="spin" size={18} />
                正在识别分区…
              </>
            ) : (
              <>
                <Sparkles size={17} />
                开始 AI 识别
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </div>
        <div className="analysis-footer">
          <span>
            <LockKeyhole size={13} />
            开始识别时，图片与所选表格文字会发送至你选择的 AI 服务。
          </span>
          <button
            className="text-btn"
            disabled={!activeSheets.length || locked || reading}
            onClick={startManual}
          >
            手动分区
            <ArrowRight size={14} />
          </button>
        </div>
        {session.modelsError && <p className="model-warning" role="alert">{session.modelsError}</p>}
        {unavailable && <p className="model-warning">{unavailable}</p>}
        {chosen && !unavailable && <p className="model-hint">此处需要模型支持图片输入；配置已读取不代表视觉识别已验证。</p>}
        {busy && (
          <p className="loading-note" role="status">
            正在对照图片和表格，通常需要几十秒。完成后你可以修改分区和人员信息。
          </p>
        )}
      </section>
      <div className="output-explainer">
        <span className="output-icon">
          <FileSpreadsheet size={22} />
        </span>
        <div>
          <strong>导出与你的人员库模板一致的字段</strong>
          <div className="field-chips">
            {['姓名', '手机号', '单位', '职务', '分座区域'].map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        </div>
        <p>
          表格中没有的信息保留为空。
          <br />
          重名与姓名备注会保留并提醒核对。
        </p>
      </div>
    </>
  );
}
