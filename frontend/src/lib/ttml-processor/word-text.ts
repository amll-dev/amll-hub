import type { Syllable } from './types';

/** 逐字拼回整行文本；行尾不补空格（TTML 里行尾空格无意义） */
export function joinWordsToLineText(words: Syllable[] | undefined): string {
  if (!words || words.length === 0) return '';
  return words
    .map((w, i) => (w.endsWithSpace && i < words.length - 1 ? `${w.text} ` : w.text))
    .join('');
}
export function splitLineTextToWords(text: string): Syllable[] {
  const tokens = text.match(/\S+\s*|\s+/g) ?? [];
  const merged: Array<{ text: string; endsWithSpace: boolean }> = [];
  for (const token of tokens) {
    const trimmed = token.replace(/\s+$/, '');
    const endsWithSpace = /\s$/.test(token);
    if (!trimmed) {
      // 纯空白：并到前一个 token 的空格标记上
      const prev = merged[merged.length - 1];
      if (prev) prev.endsWithSpace = true;
      continue;
    }
    merged.push({ text: trimmed, endsWithSpace });
  }
  // 行尾空白不产生 endsWithSpace：TTML 里行尾空格无意义，
  // 留着会让导出的最后一个 span 带一个空隙，播放时末尾多出一截。
  const last = merged[merged.length - 1];
  if (last) last.endsWithSpace = false;
  return merged.map((m) => {
    const item: Syllable = { text: m.text, startTime: 0, endTime: 0 };
    if (m.endsWithSpace) item.endsWithSpace = true;
    return item;
  });
}
