import type { Segment } from './schema';
// Non-overlapping chunks preserve every UTF-16 unit and avoid breaking surrogate pairs.
export function chunkSegments(segments: Segment[], size = 10000): { text: string; label: string }[] {
  const chunks: { text: string; label: string; segmentId: string }[] = [];
  for (const segment of segments) {
    let start = 0;
    while (start < segment.text.length) {
      let end = Math.min(start + size, segment.text.length);
      if (end < segment.text.length) {
        const newline = segment.text.lastIndexOf('\n', end);
        if (newline > start + size / 2) end = newline + 1;
        if (/[\uD800-\uDBFF]/.test(segment.text[end - 1])) end--;
      }
      chunks.push({ text: segment.text.slice(start, end), label: `${segment.label} · 片段 ${chunks.length + 1}`, segmentId: segment.id });
      start = end;
    }
  }
  // Pack short pages together so an 80-page document with little text does not
  // trigger 80 separate model calls. Page boundaries remain separated by newlines.
  const packed: typeof chunks = [];
  for (const chunk of chunks) {
    const last = packed.at(-1);
    const separator = last?.segmentId === chunk.segmentId ? '' : '\n\n';
    if (last && last.text.length + chunk.text.length + separator.length <= size) {
      last.text += separator + chunk.text;
      last.label = `${last.label.split(' 至 ')[0]} 至 ${chunk.label}`.slice(0, 180);
      last.segmentId = chunk.segmentId;
    } else packed.push({ ...chunk });
  }
  return packed.map(({ text, label }) => ({ text, label }));
}
