export function extractNcmSongId(input: string): string {
  const value = input.trim();
  if (/^\d+$/.test(value)) return value;
  // 只处理网易云链接，别把普通文本里的 id= 误当成歌曲 ID
  if (!value.includes('music.163.com')) return value;
  const matched = /[?&#]id=(\d+)/.exec(value) ?? /\/song\/(\d+)/.exec(value);
  return matched?.[1] ?? value;
}
