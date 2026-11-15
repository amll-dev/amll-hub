import { uid } from 'uid';
import type { LyricLine } from '$/types/ttml.ts';

/**
 * 深拷贝一行歌词（含新 id）。
 *
 * 不能只做浅拷贝：`endTimeLink`、`vocal`、`translatedLyricByLang`、
 * `romanLyricByLang`、`wordRomanizationByLang` 都是引用类型，共享的话
 * 改副本会同时改到原行（典型表现：取消时间链接时两行一起变）。
 */
const cloneLyricLine = (line: LyricLine): LyricLine => {
  const cloned = structuredClone(line);
  cloned.id = uid();
  cloned.words = cloned.words.map((w) => ({ ...w, id: uid() }));
  return cloned;
};

/**
 * 重新排序拖拽的歌词行或复制拖拽的歌词行
 * @param originalLines 原始歌词列表
 * @param draggedIds 被拖拽的行的 ID 集合
 * @param dropIndex 目标插入位置（相对于剔除拖拽行后的 remaining 数组）
 * @param isCopy 是否为拖拽模式
 * @returns 返回一个全新的、重排后的歌词列表数组
 */
export const reorderOrCopyLyricLines = (
  originalLines: LyricLine[],
  draggedIds: Set<string>,
  dropIndex: number,
  isCopy: boolean
): { nextLines: LyricLine[]; newlyCreatedIds: Set<string> } => {
  const toMove = originalLines.filter((line) => draggedIds.has(line.id));
  let remaining = originalLines;
  const newlyCreatedIds = new Set<string>();
  let finalToInsert = toMove;

  let adjustedDropIndex = dropIndex;

  if (isCopy) {
    finalToInsert = toMove.map((line) => {
      const cloned = cloneLyricLine(line);
      newlyCreatedIds.add(cloned.id);
      return cloned;
    });
  } else {
    remaining = originalLines.filter((line) => !draggedIds.has(line.id));
    let adjustCount = 0;
    for (let i = 0; i < dropIndex && i < originalLines.length; i++) {
      if (draggedIds.has(originalLines[i]?.id ?? '')) {
        adjustCount++;
      }
    }
    adjustedDropIndex -= adjustCount;
  }

  const safeIndex = Math.max(0, Math.min(adjustedDropIndex, remaining.length));

  const nextLines = [...remaining];
  nextLines.splice(safeIndex, 0, ...finalToInsert);

  return { nextLines, newlyCreatedIds };
};
