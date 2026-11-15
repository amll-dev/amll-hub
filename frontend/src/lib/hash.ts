/**
 * djb2 变体（`h * 33 ^ c`）的短指纹，输出 `base36:length`。
 *
 * 用途只有一个：给**大字符串**生成 queryKey 的可比较片段。TTML 全文动辄
 * 数百 KB，直接塞进 queryKey 会让 TanStack Query 每次渲染都做一次全量
 * 序列化；指纹只要 O(n) 算一次，且碰撞时还有长度兜底。
 *
 * 不要用它做任何安全用途——这是非加密哈希。
 */
export function contentFingerprint(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}:${input.length.toString(36)}`;
}
