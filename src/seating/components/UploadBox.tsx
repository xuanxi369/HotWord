import { useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, ImagePlus, Upload } from 'lucide-react';

export function UploadBox({
  kind,
  name,
  image,
  busy,
  disabled = false,
  onFile,
}: {
  kind: 'image' | 'excel';
  name: string;
  image?: string;
  busy: boolean;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const isImage = kind === 'image';
  const locked = busy || disabled;
  return (
    <div
      className={`upload-card ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!locked && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
      }}
    >
      <div className="upload-card-heading">
        <span className="upload-number">{isImage ? '01' : '02'}</span>
        <div>
          <h3>{isImage ? '会场座次图' : 'Excel 座次表'}</h3>
          <p>{isImage ? '让 AI 理解分区与座位布局' : '以表格中的姓名和信息为准'}</p>
        </div>
        {name && <CheckCircle2 className="success-icon" size={20} />}
      </div>
      <input
        ref={input}
        className="sr-only"
        type="file"
        aria-label={isImage ? '上传会场座次图' : '上传 Excel 座次表'}
        accept={isImage ? 'image/png,image/jpeg,image/webp' : '.xlsx'}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
        disabled={locked}
      />
      <button
        className={`drop-area ${name ? 'has-file' : ''}`}
        onClick={() => input.current?.click()}
        disabled={locked}
      >
        {isImage && image ? (
          <img src={image} alt="已上传的会场座次图" className="upload-preview" />
        ) : (
          <>
            <span className={`upload-icon ${isImage ? '' : 'excel-icon'}`}>
              {isImage ? <ImagePlus size={30} /> : <FileSpreadsheet size={30} />}
            </span>
            <strong>{busy ? '正在读取文件…' : name || '点击上传，或拖拽文件到这里'}</strong>
            <span>{isImage ? 'PNG / JPG / WebP，最大 10MB' : 'XLSX 格式，最大 10MB'}</span>
            <span className="browse-label">
              <Upload size={14} />
              {name ? '更换文件' : '选择文件'}
            </span>
          </>
        )}
      </button>
      {name && (
        <div className="file-name">
          <span>{name}</span>
          <button
            className="text-btn small"
            onClick={() => input.current?.click()}
            disabled={locked}
          >
            重新选择
          </button>
        </div>
      )}
    </div>
  );
}
