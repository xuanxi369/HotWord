import type { Segment } from './schema';

// Split at a nearby line boundary when possible, retaining every UTF-16 unit.
export function bisectText(text: string): [string, string] | null {
  if (text.length < 2) return null;
  const middle = Math.floor(text.length / 2);
  const before = text.lastIndexOf('\n', middle - 1) + 1;
  const afterIndex = text.indexOf('\n', middle), after = afterIndex < 0 ? 0 : afterIndex + 1;
  const boundaries = [before, after].filter(n => n >= text.length / 4 && n <= text.length * 3 / 4);
  let end = boundaries.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0] ?? middle;
  if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return end > 0 && end < text.length ? [text.slice(0, end), text.slice(end)] : null;
}

function lineCount(text: string) {
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

// Non-overlapping chunks preserve every UTF-16 unit and avoid breaking surrogate pairs.
export function chunkSegments(segments: Segment[], size = 10000, maxLines = Infinity): { text: string; label: string }[] {
  if (!Number.isSafeInteger(size) || size < 2) throw new RangeError('分片字符上限必须是至少 2 的整数');
  if (maxLines !== Infinity && (!Number.isSafeInteger(maxLines) || maxLines < 1)) throw new RangeError('分片行数上限必须是正整数');
  const chunks: { text: string; label: string; segmentId: string }[] = [];
  for (const segment of segments) {
    let start = 0;
    while (start < segment.text.length) {
      let end = Math.min(start + size, segment.text.length);
      if (end < segment.text.length) {
        const newline = segment.text.lastIndexOf('\n', end - 1);
        if (newline > start + size / 2) end = newline + 1;
        if (/[\uD800-\uDBFF]/.test(segment.text[end - 1])) end--;
      }
      // Short table rows can need much more output than their input length
      // suggests. Keep whole rows within a second, independent output budget.
      let cursor = start;
      for (let lines = 0; lines < maxLines; lines++) {
        const newline = segment.text.indexOf('\n', cursor);
        if (newline < 0 || newline >= end) break;
        cursor = newline + 1;
        if (lines + 1 === maxLines) end = cursor;
      }
      chunks.push({ text: segment.text.slice(start, end), label: `${segment.label} · 片段 ${chunks.length + 1}`.slice(0, 180), segmentId: segment.id });
      start = end;
    }
  }
  // Pack short pages together so an 80-page document with little text does not
  // trigger 80 separate model calls. Page boundaries remain separated by newlines.
  const packed: typeof chunks = [];
  for (const chunk of chunks) {
    const last = packed.at(-1);
    const separator = last?.segmentId === chunk.segmentId ? '' : '\n\n';
    const joined = last ? last.text + separator + chunk.text : chunk.text;
    if (last && joined.length <= size && (maxLines === Infinity || lineCount(joined) <= maxLines)) {
      last.text = joined;
      last.label = `${last.label.split(' 至 ')[0]} 至 ${chunk.label}`.slice(0, 180);
      last.segmentId = chunk.segmentId;
    } else packed.push({ ...chunk });
  }
  return packed.map(({ text, label }) => ({ text, label }));
}
