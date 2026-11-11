/** Content checks shared by AI validation, table import and the final exporter.
 * Keep names, abbreviations and complete technical phrases; reject only clear
 * document metadata, placeholders and prose. Evidence is never itself a term.
 */
const metadata = new Set([
  '序号', '编号', '页码', '项目', '内容', '子类', '类别', '分类', '名称', '词条', '原词', '原文', '译文', '译法', '英文', '中文',
  '缩写', '别称', '现场提示', '备注', '说明', '用途', '收录规模', '适用会议', '更新日期', '版本日期', '工作表',
  '专有名词', '待确认', '待确认项', '待提供', '待定', '会前建议动作', '口径红线', '译法优先级', '字幕简化原则',
  '会议名称', '会议地点', '会议时间', '公司名', '公司主体',
  'source', 'source term', 'target', 'target term', 'translation', 'english', 'chinese', 'category', 'notes', 'remarks',
  'conference name', 'conference dates', 'venue', 'tbd', 'n/a', 'not provided', 'to be confirmed',
]);

export function termIssue(raw: string): string | undefined {
  const text = raw.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '空词条';
  if (!/[\p{L}\p{N}]/u.test(text)) return '仅有标点或符号，不是术语';
  if (/^[\d\s.,，/\\:年月日号第页%+\-–—()]+$/u.test(text)
    || /^(?:第\s*)?\d+(?:\s*[/／-]\s*\d+)?\s*(?:页|行|条|项|章|节|号)?$/u.test(text)) return '独立数字、序号、页码或日期';
  const header = text.replace(/\s*[(（].*?[)）]\s*/gu, '').trim().toLowerCase();
  if (metadata.has(header) || /^(?:中文|英文|原词|译文|现场提示|缩写)\s*(?:[/／|｜].*)?$/u.test(text)) return '表头、分类或说明标签';
  if (/(?:术语表|使用说明|双列表|速查表|译法红线)$/u.test(text)) return '文档标题或说明标签';
  if (/待(?:确认|提供|补充|定)|暂无|未提供|姓名待|\b(?:TBD|to be confirmed|to be provided)\b/iu.test(text)) return '尚未提供的占位内容';
  if (/[→⇒]/u.test(text) || /[①②③④⑤⑥⑦⑧⑨⑩]/u.test(raw)) return '操作流程或编号说明';
  if (/^\d+[)）.、]\s*(?:请|把|收齐|打印|向|导入|另存|确认|检查|索取)/u.test(text)
    || /^(?:请(?=[\s:：]|把|将|按|用|先|勿|遵|核|确认|检查|提供|填写|选择|导入|另存|打印|收齐|你|您)|需要|应该|应当|务必|不要|不得|不应|避免|勿|禁止|注意[:：]|建议[:：])/u.test(text)
    || /(?:公司名|译法|译文|英文名|物料|字幕|词条)(?:只能|必须|应当|优先用|不(?:自行)?拼译|冲突时)/u.test(text)
    || /(?:本表属|详见\s*\d|会前建议|原样保留不覆盖|表内术语预置|已(?:均)?标注.*不自行)/u.test(text)) return '操作指令、译法说明或注意事项';
  if ((text.match(/[｜|]/gu)?.length ?? 0) >= 2 && /\d{2}\s*\p{L}/u.test(text)) return '工作表目录或多项说明';
  if (/[。！？；;]/u.test(raw) && /\p{L}/u.test(text)) return '完整句子或说明段落';
  if (/即将|拉开帷幕|敬请|欢迎(?:您|各位)|感谢(?:您|各位)|^(?:尊敬的|Dear Distinguished|Ladies and Gentlemen)/iu.test(text)) return '宣传、致辞或礼貌句，不是术语';
  if (/携手.*(?:共赢|未来)|共谋.*新篇|引领.*(?:未来|新时代)|品质为先[，,\s]|^实现.{8,}|^诚信[，,\s]+务实[，,\s]+创新[，,\s]+协作$/u.test(text)) return '宣传口号或叙述句，不是术语';
  const words = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? [];
  if ((words.length >= 8 && /\b(?:is|are|was|were|will|shall|should|must|please|has|have)\b/iu.test(text))
    || (words.length >= 6 && /\b(?:[Oo]ur|[Yy]our|[Yy]ou|[Ww]e|[Uu]s)\b/u.test(text))) return '英文完整句子，不是术语';
  return undefined;
}
