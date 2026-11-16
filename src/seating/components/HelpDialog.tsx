import { ArrowRight, FileSpreadsheet, X } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const dialog = useDialog(onClose);
  const setShowHelp = (_open: boolean) => onClose();
  return (
    <div className="modal-backdrop">
      <section
        ref={dialog}
        className="modal help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <div className="modal-title">
          <h2 id="help-title">三步整理人员库</h2>
          <button className="icon-btn" aria-label="关闭使用说明" onClick={() => setShowHelp(false)}>
            <X size={20} />
          </button>
        </div>
        <ol className="help-steps">
          <li>
            <strong>上传会场座次图和 .xlsx 座次表</strong>
            <p>
              图片应能清楚看到分区名称。表格可以是座次网格，也可以是一行一人的名单。多张工作表可选择参与分析。
            </p>
          </li>
          <li>
            <strong>让 AI 识别，再确认分区</strong>
            <p>
              AI
              只判断分区和数据范围；姓名等字段从原表读取。可修改分区范围、调整姓名和区域，排除标题。未归档的单元格必须先处理。
            </p>
          </li>
          <li>
            <strong>核对后导出五字段人员库</strong>
            <p>
              重名和括号备注保留。源表缺失的手机号、单位、职务留空。人数多于或少于容量都会提醒，不会自动删人。导出包含当前完整名单，不受搜索筛选影响。
            </p>
          </li>
        </ol>
        <p className="modal-tip">
          草稿自动保存在此浏览器。刷新后可恢复图片、原表和人工修改；模型与密钥沿用 HotWord 的共享配置。分区编辑需点击「应用分区」才会保存。
        </p>
        <div className="help-note">
          <FileSpreadsheet size={20} />
          <p>如果只需要填写区域，无需增加排号和座号。当前导出严格遵循既有五字段模板。</p>
        </div>
        <button className="primary-btn full-width" onClick={() => setShowHelp(false)}>
          开始整理
          <ArrowRight size={16} />
        </button>
      </section>
    </div>
  );
}
