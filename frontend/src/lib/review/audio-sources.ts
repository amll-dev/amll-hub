import type { SubmissionAudio } from '@/lib/types';

/** 编辑器可选的音源：上传音频、网易云或 QQ 音乐解析出的直链 */
export interface EditorAudioSource {
  /** 稳定标识：上传音频用 fileName，网易云用 `ncm:<id>`，QQ 音乐用 `qq:<id>` */
  key: string;
  /** 可直接用于 fetch / audio 元素的播放地址 */
  src: string;
  /** 展示给人看的名称 */
  label: string;
}

/** 在线音源候选：平台歌曲 ID + 解析结果（null 表示解析中或失败） */
export interface OnlineAudioCandidate {
  id: string;
  info: { url?: string; name?: string } | null;
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

// 组装编辑器的参考音源列表：上传音频在前，网易云、QQ 音乐按 ID 顺序在后
export function buildEditorAudioSources(
  audios: SubmissionAudio[],
  ncm: OnlineAudioCandidate[],
  qq: OnlineAudioCandidate[],
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

  list.push(...buildOnlineSources(ncm, '网易云', 'ncm'));
  list.push(...buildOnlineSources(qq, 'QQ 音乐', 'qq'));
  return list;
}

/** 一个平台的多个 ID 各自成一条音源；多于一条时在标签里带上 ID 便于区分 */
function buildOnlineSources(
  candidates: OnlineAudioCandidate[],
  platformLabel: string,
  keyPrefix: string
): EditorAudioSource[] {
  const valid = candidates.filter((c) => c.id && c.info?.url?.trim());
  const showId = valid.length > 1;
  return valid.map((c) => {
    const name = c.info?.name?.trim();
    const base = name ? `${platformLabel} · ${name}` : `${platformLabel}音源（${c.id}）`;
    return {
      key: `${keyPrefix}:${c.id}`,
      src: c.info!.url!.trim(),
      label: showId && name ? `${base}（${c.id}）` : base,
    };
  });
}
