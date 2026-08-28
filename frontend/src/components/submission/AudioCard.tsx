import { Play } from 'lucide-react';
import { UserAvatar } from '@/components/submission/UserAvatar';
import { usePlayer } from '@/hooks/usePlayer';
import type { SubmissionAudio, UserInfo } from '@/lib/types';

/** 构建 MinIO 文件的可访问 URL */
function fileUrl(key?: string): string {
  if (!key) return '';
  return `${import.meta.env.VITE_API_BASE ?? ''}/api/v1/uploads/file/${key}`;
}

/** 投稿者上传的音频卡片 */
export function AudioCard({
  audio,
  ttml,
  submitterInfo,
  submitter,
}: {
  audio: SubmissionAudio;
  ttml?: string;
  submitterInfo?: UserInfo;
  submitter?: string;
}) {
  const { playDirect, openLyricsPage } = usePlayer();
  const audioUrl = fileUrl(audio.fileName);
  const cover = fileUrl(audio.coverUrl);

  const handlePlay = () => {
    playDirect({
      audioUrl,
      title: audio.title || '未知歌曲',
      artists: audio.artist || '未知歌手',
      cover,
      customTtml: ttml,
    });
    openLyricsPage();
  };

  return (
    <div className="relative flex gap-4 rounded-lg border border-line bg-surface-2 p-4">
      {cover && (
        <img
          src={cover}
          alt={audio.title || '封面'}
          className="h-20 w-20 shrink-0 rounded-lg border border-line object-cover"
        />
      )}
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        {audio.title && (
          <div className="truncate text-base font-semibold text-foreground">{audio.title}</div>
        )}
        {audio.artist && (
          <div className="text-ink-2">
            <span className="text-ink-3">艺术家：</span>
            {audio.artist}
          </div>
        )}
        {audio.album && <div className="text-ink-3">专辑：{audio.album}</div>}
        {/* 标注音频上传者 */}
        <div className="flex items-center gap-1.5 pt-1 text-xs text-ink-3">
          <UserAvatar
            avatar={submitterInfo?.avatar || ''}
            name={submitterInfo?.displayName || submitter || audio.uploadedBy}
            size={14}
          />
          <span>由投稿者 {submitterInfo?.displayName || submitter || audio.uploadedBy} 上传</span>
        </div>
      </div>
      {audioUrl && (
        <div className="absolute right-4 top-1/2 flex -translate-y-1/2 shrink-0 gap-2">
          <button
            type="button"
            onClick={handlePlay}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            <Play className="h-4 w-4" />
            播放
          </button>
        </div>
      )}
    </div>
  );
}
