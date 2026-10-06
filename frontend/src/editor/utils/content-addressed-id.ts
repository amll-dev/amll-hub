/**
 * 基于 contentHash + 路径/作用域 的确定性短 ID。
 * 同一 hash 文件、同一 path → 任意端重算结果一致，无需持久化映射表。
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

const fnv1a64Hex = (input: string): string => {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * FNV_PRIME);
  }
  return hash.toString(16).padStart(16, '0');
};

/** 规范化 path，保证派生 ID 与 JSON 往返一致。 */
export const pathKey = (path: Array<string | number>): string => JSON.stringify(path);

/**
 * 元素身份：contentHash + path。
 * 新增内容（原稿无此节点）也对「目标 path」派生，便于跨端对齐「插到哪里」。
 */
export const deriveElementId = (contentHash: string, path: Array<string | number>): string =>
  `e:${fnv1a64Hex(`${contentHash}\0${pathKey(path)}`)}`;

/**
 * 行身份：contentHash + lineIndex（冻结原稿坐标系）。
 */
export const deriveLineId = (contentHash: string, lineIndex: number): string =>
  `l:${fnv1a64Hex(`${contentHash}\0lyricLines:${lineIndex}`)}`;
