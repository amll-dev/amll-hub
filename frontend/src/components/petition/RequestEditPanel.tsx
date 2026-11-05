import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useAuth } from '@/hooks/useAuth';
import { EmptyState } from '@/components/ui/EmptyState';
import { CardDetailSkeleton } from '@/components/ui/Skeleton';
import { RequestForm } from './RequestForm';
import type { LyricRequestPayload } from '@/lib/types';

/** 编辑请愿 */
export function RequestEditPanel({ id }: { id: number }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const detailQuery = useQuery({
    queryKey: queryKeys.lyricRequest(id),
    queryFn: () => api.getLyricRequest(id),
    enabled: Number.isFinite(id) && id > 0,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: LyricRequestPayload) => api.updateLyricRequest(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lyric-requests'] });
      toast.success('已保存');
      navigate(`/creator/requests/${id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '保存失败'),
  });

  if (detailQuery.isLoading) return <CardDetailSkeleton />;

  const req = detailQuery.data;
  if (!req) {
    return (
      <EmptyState
        title="请愿不存在或已被撤回"
        description={detailQuery.error instanceof Error ? detailQuery.error.message : undefined}
      />
    );
  }
  if (!user || req.requesterName !== user.name) {
    return <EmptyState title="只能编辑自己发起的请愿" description="这条请愿不属于当前账号" />;
  }
  if (req.status !== 'pending') {
    return <EmptyState title="请愿已完成，无法再编辑" description="如需修改请联系管理员" />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">编辑歌词请愿</h2>
        <p className="mt-1 text-sm text-ink-3">
          #{req.id} · {req.songName} - {req.artist}
        </p>
      </div>

      <RequestForm
        initial={{
          songName: req.songName,
          artist: req.artist,
          album: req.album,
          ncmId: req.ncmId === '0' ? '' : req.ncmId,
          qqId: req.qqId === '0' ? '' : req.qqId,
          spotifyId: req.spotifyId === '0' ? '' : req.spotifyId,
          appleMusicId: req.appleMusicId === '0' ? '' : req.appleMusicId,
          hasAppleTtml: req.hasAppleTtml,
          note: req.note,
        }}
        submitLabel="保存修改"
        submitting={updateMutation.isPending}
        onSubmit={(payload) => updateMutation.mutate(payload)}
      />
    </div>
  );
}
