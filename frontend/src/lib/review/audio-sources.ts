import type { NcmMusicInfo, SubmissionAudio } from '@/lib/types';

/** 编辑器可选的音源：上传音频或网易云解析出的直链 */
export interface EditorAudioSource {
  /** 稳定标识：上传音频用 fileName，网易云用 `ncm:<id>` */
  key: string;
  /** 可直接用于 fetch / audio 元素的播放地址 */
  src: string;
  /** 展示给人看的名称 */
  label: string;
}

/** 上传音频的播放地址 */
export function buildAudioUrl(
  audio: { fileName?: string },
  apiBase = import.meta.env.VITE_API_BASE ?? ''
): string {
  const key = audio.fileName;
  if (!key) return '';
  return `${apiBase}/api/v1/uploads/file/${key}`;
}

// 组装编辑器的参考音源列表
export function buildEditorAudioSources(
  audios: SubmissionAudio[],
  ncmId: string,
  ncm: Pick<NcmMusicInfo, 'url' | 'name'> | null,
  apiBase = import.meta.env.VITE_API_BASE ?? ''
): EditorAudioSource[] {
  const list: EditorAudioSource[] = audios
    .map((a) => ({
      key: a.fileName || String(a.id ?? ''),
      src: buildAudioUrl(a, apiBase),
      label: a.title || a.artist || a.fileName || '音频',
    }))
    // 没有可播放地址的条目（缺 fileName）直接丢弃，避免选中后加载必然失败
    .filter((s) => s.src !== '');

  const ncmUrl = ncm?.url?.trim();
  if (ncmId && ncmUrl) {
    list.push({
      key: `ncm:${ncmId}`,
      src: ncmUrl,
      label: ncm?.name ? `网易云 · ${ncm.name}` : `网易云音源（${ncmId}）`,
    });
  }

  return list;
}
