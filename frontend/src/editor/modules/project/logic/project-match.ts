import type { TTMLMetadata, TTMLLyric } from '$/types/ttml';

/**
 * 判断数据库中的项目是否匹配当前的歌词文件
 * @param dbMeta - 历史项目的元数据（`getProjectSummaries()` 返回，不含完整歌词）
 * @param fileLyric - 当前打开或编辑的歌词数据
 * @returns 如果匹配则返回 true，否则返回 false
 */
export function isProjectMatch(dbMeta: TTMLMetadata[], fileLyric: TTMLLyric): boolean {
  // 防止所有新建的空白文件都匹配成功
  if (!dbMeta || dbMeta.length === 0) {
    return false;
  }

  for (const dbItem of dbMeta) {
    const dbKey = dbItem.key.trim().toLowerCase();
    const dbValues = dbItem.value.map((v) => v.trim()).filter((v) => v !== '');

    if (dbValues.length === 0) {
      continue;
    }

    const fileItem = fileLyric.metadata.find((m) => m.key.trim().toLowerCase() === dbKey);

    if (!fileItem) {
      return false;
    }

    const fileValues = fileItem.value.map((v) => v.trim()).filter((v) => v !== '');

    const isSubset = dbValues.every((dbVal) => fileValues.includes(dbVal));

    if (!isSubset) {
      return false;
    }
  }

  return true;
}
